// Extracts tool calls out of a Plexus request trace.
//
// Plexus stores each request as four related pieces:
//   raw_request / transformed_request      — what was sent to the upstream
//   raw_response / transformed_response    — what came back (often an SSE stream)
//   raw/transformed_response_snapshot      — the *reassembled* final message
//
// For streamed requests, raw_response/transformed_response are SSE text (not
// JSON), so a naive `JSON.parse` + `message.tool_calls` read returns nothing.
// The `*_snapshot` fields carry the fully-assembled final message in Anthropic
// `tool_use` form, which is the most reliable source.
//
// Priority order:
//   1. Anthropic `tool_use` blocks in the snapshot / transformed_response
//   2. OpenAI SSE chat.completion.chunk streams (delta tool_calls reassembly)
//   3. Plain-JSON OpenAI Chat Completions (`message.tool_calls`) — legacy path
//   4. Plain-JSON Responses API (`output[].function_call`) — legacy path
//
// A tool call's RESULT arrives on the *next* request's `tool_result` block
// (Claude-Code turns are one request per turn). Within a single request we can
// only surface its own arguments; cross-request result joins are out of scope.

export function extractToolCalls(rawRequest, rawResponse, opts = {}) {
  // Support the modern single-object form: extractToolCalls({ rawRequest, ... })
  if (rawRequest && typeof rawRequest === 'object' && !looksLikeJsonString(rawRequest)) {
    opts = rawRequest;
    rawRequest = opts.rawRequest;
    rawResponse = opts.rawResponse;
  }

  const req = safeParseObject(rawRequest);
  const resp = safeParseObject(rawResponse);
  const xReq = safeParseObject(opts.transformedRequest ?? opts.transformed_request);
  const xResp = safeParseObject(opts.transformedResponse ?? opts.transformed_response);
  const snapshot = safeParseObject(
    opts.transformedResponseSnapshot ??
    opts.transformed_response_snapshot ??
    opts.rawResponseSnapshot ??
    opts.raw_response_snapshot,
  );

  const calls = [];

  // 1. Anthropic snapshot / transformed_response tool_use blocks
  const content = snapshot?.content ?? (Array.isArray(xResp?.content) ? xResp.content : []);
  extractAnthropicContent(content, calls);

  // 2. Results from Anthropic tool_result blocks found on the request side
  //    (only joins against calls already found from this request's response).
  extractAnthropicResults(xReq ?? req, calls);

  // 3. OpenAI SSE stream (reassemble delta tool_calls)
  if (calls.length === 0 && isSseStream(rawResponse)) {
    extractOpenAiSse(rawResponse, calls);
  }

  // 4. Plain-JSON OpenAI Chat Completions — legacy path
  if (calls.length === 0) {
    extractOpenAiPlain(resp, req, calls);
  }

  // 5. Plain-JSON Responses API — legacy path
  if (calls.length === 0) {
    extractResponsesApi(resp, calls);
  }

  annotateRetries(calls);
  return calls;
}

// ---------------------------------------------------------------------------
// Helpers

function asObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// Objects pass through; strings parse; anything else -> null.
function safeParseObject(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return asObject(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return asObject(value);
}

function looksLikeJsonString(value) {
  return typeof value === 'string' && value.trim().startsWith('{');
}

function isSseStream(value) {
  return typeof value === 'string'
    && /(^|\n)\s*data:\s*\{/.test(value)
    && /chat\.completion\.chunk/.test(value);
}

function parseArguments(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return asObject(parsed) ?? { raw: String(raw) };
  } catch {
    return { raw: String(raw) };
  }
}

function pushCall(calls, { id, tool_name, args, result = null, error = null }) {
  const call = {
    id: id ?? null,
    tool_name: tool_name ?? 'unknown',
    arguments: args ?? {},
    result,
    error,
  };
  calls.push(call);
  return call;
}

function idToCall(calls) {
  const map = new Map();
  for (const call of calls) {
    if (call.id) map.set(call.id, call);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Anthropic-format extraction

function extractAnthropicContent(content, calls) {
  for (const block of asArray(content)) {
    if (block?.type !== 'tool_use') continue;
    pushCall(calls, {
      id: block.id,
      tool_name: block.name,
      args: parseArguments(block.input),
    });
  }
}

// Join `tool_result` blocks (from this request's messages) against the calls
// this request produced. In Claude-Code style these usually belong to the
// *previous* request's calls, so this is defensive — it only populates
// result/error when an id happens to match.
function extractAnthropicResults(req, calls) {
  const map = idToCall(calls);
  const messages = asArray(req?.messages);
  for (const msg of messages) {
    for (const block of asArray(msg?.content)) {
      if (block?.type !== 'tool_result') continue;
      const match = block.tool_use_id ? map.get(block.tool_use_id) : null;
      if (!match) continue;
      if (block.is_error) {
        match.error = typeof block.content === 'string'
          ? block.content
          : JSON.stringify(block.content);
      } else {
        match.result = block.content ?? null;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// OpenAI SSE stream — reconstruct tool calls from incremental delta chunks

function extractOpenAiSse(sseText, calls) {
  const partial = new Map(); // choice index -> accumulator

  for (const line of sseText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') break;

    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;
    }

    for (const choice of asArray(chunk?.choices)) {
      for (const tc of asArray(choice?.delta?.tool_calls)) {
        const idx = tc.index ?? 0;
        let acc = partial.get(idx);
        if (!acc) {
          acc = { id: null, name: null, args: '' };
          partial.set(idx, acc);
        }
        if (tc.id) acc.id = tc.id;
        const fn = tc.function || {};
        if (fn.name) acc.name = fn.name;
        if (fn.arguments) acc.args += fn.arguments;
      }
    }
  }

  for (const acc of partial.values()) {
    pushCall(calls, {
      id: acc.id,
      tool_name: acc.name,
      args: acc.args ? parseArguments(acc.args) : {},
    });
  }
}

// ---------------------------------------------------------------------------
// Plain-JSON OpenAI Chat Completions — legacy behaviour, preserved

function extractOpenAiPlain(resp, req, calls) {
  if (!resp) return;

  const respChoices = asArray(resp.choices);
  for (const choice of respChoices) {
    for (const tc of asArray(choice?.message?.tool_calls)) {
      pushCall(calls, {
        id: tc.id ?? null,
        tool_name: tc.function?.name || 'unknown',
        args: parseArguments(tc.function?.arguments),
      });
    }
  }

  // Tool result messages (role:'tool') on either side.
  const map = idToCall(calls);
  const allMessages = [
    ...asArray(req?.messages),
    ...respChoices.map((c) => c?.message).filter(Boolean),
  ];
  for (const msg of allMessages) {
    if (msg?.role !== 'tool' || !msg.tool_call_id) continue;
    const match = map.get(msg.tool_call_id);
    if (!match) continue;
    const content = typeof msg.content === 'string'
      ? msg.content
      : JSON.stringify(msg.content);
    const parsed = parseResultLegacy(content);
    if (parsed?.error && typeof parsed.error === 'string') match.error = parsed.error;
    else if (parsed?.isError === true) match.error = content;
    else match.result = parsed && Object.keys(parsed).length ? parsed : content;
  }
}

// ---------------------------------------------------------------------------
// Plain-JSON Responses API — legacy behaviour, preserved

function extractResponsesApi(resp, calls) {
  if (!resp || !Array.isArray(resp.output)) return;

  for (const item of resp.output) {
    if (item?.type === 'function_call') {
      pushCall(calls, {
        id: item.id ?? item.call_id ?? null,
        tool_name: item.name || 'unknown',
        args: parseArguments(item.arguments),
      });
    }
  }

  const map = idToCall(calls);
  for (const item of resp.output) {
    if (item?.type !== 'function_call_output' || !item.call_id) continue;
    const match = map.get(item.call_id);
    if (!match) continue;
    const content = typeof item.output === 'string'
      ? item.output
      : JSON.stringify(item.output);
    const parsed = parseResultLegacy(content);
    if (item.is_error) match.error = content;
    else if (parsed?.error && typeof parsed.error === 'string') match.error = parsed.error;
    else if (parsed?.isError === true) match.error = content;
    else match.result = parsed && Object.keys(parsed).length > 0 && !parsed.raw ? parsed : content;
  }
}

// ---------------------------------------------------------------------------
// Retry annotation — legacy behaviour, preserved shape

function annotateRetries(calls) {
  const nameCount = new Map();
  for (const call of calls) {
    nameCount.set(call.tool_name, (nameCount.get(call.tool_name) || 0) + 1);
  }
  const nameSeen = new Map();
  for (const call of calls) {
    const seen = (nameSeen.get(call.tool_name) || 0) + 1;
    nameSeen.set(call.tool_name, seen);
    call.attempt = seen;
    call.retry_count = nameCount.get(call.tool_name);
    call.is_retry = seen > 1;
  }
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

// Legacy result semantics: objects parse through; unparseable/array strings
// wrap as { raw: str }. Mirrors the pre-refactor safeParse() behaviour.
function parseResultLegacy(str) {
  const parsed = safeJsonParse(str);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  return { raw: str };
}
