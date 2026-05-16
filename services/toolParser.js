export function extractToolCalls(rawRequest, rawResponse) {
  const calls = [];
  let req, resp;
  try {
    req = JSON.parse(rawRequest || '{}');
  } catch (err) {
    console.error('Failed to parse raw request:', err);
    return calls;
  }
  try {
    resp = JSON.parse(rawResponse || '{}');
  } catch (err) {
    console.error('Failed to parse raw response:', err);
    return calls;
  }
  if (!req || typeof req !== 'object') return calls;
  if (!resp || typeof resp !== 'object') return calls;

  // --- OpenAI Chat Completion format ---
  const respChoices = resp.choices || [];
  // Collect tool call id -> call mapping so we can match results later
  const callById = new Map();

  for (const choice of respChoices) {
    const message = choice.message || {};
    const toolCalls = message.tool_calls || [];
    for (const tc of toolCalls) {
      const call = {
        id: tc.id || null,
        tool_name: tc.function?.name || 'unknown',
        arguments: safeParse(tc.function?.arguments),
        result: null,
        error: null,
      };
      calls.push(call);
      if (call.id) callById.set(call.id, call);
    }
  }

  // Match tool role messages (OpenAI Chat Completion results)
  // Tool results can appear in request messages or in response choices with role='tool'
  const allMessages = [
    ...(req.messages || []),
    ...respChoices.map((c) => c.message).filter(Boolean),
  ];
  for (const msg of allMessages) {
    if (msg.role === 'tool' && msg.tool_call_id) {
      const match = callById.get(msg.tool_call_id);
      if (match) {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        // Check if content looks like an error
        const parsed = safeParse(content);
        if (parsed && parsed.error && typeof parsed.error === 'string') {
          match.error = parsed.error;
        } else if (parsed && parsed.isError === true) {
          match.error = content;
        } else {
          match.result = parsed && Object.keys(parsed).length ? parsed : content;
        }
      }
    }
  }

  // --- Responses API format ---
  for (const item of resp.output || []) {
    if (item.type === 'function_call') {
      const call = {
        id: item.id || item.call_id || null,
        tool_name: item.name || 'unknown',
        arguments: safeParse(item.arguments),
        result: null,
        error: null,
      };
      calls.push(call);
      if (call.id) callById.set(call.id, call);
    }
  }

  // Match function_call_output items (Responses API results)
  for (const item of resp.output || []) {
    if (item.type === 'function_call_output' && item.call_id) {
      const match = callById.get(item.call_id);
      if (match) {
        const content = typeof item.output === 'string' ? item.output : JSON.stringify(item.output);
        const parsed = safeParse(content);
        // Check for error indicators
        if (item.is_error) {
          match.error = content;
        } else if (parsed && parsed.error && typeof parsed.error === 'string') {
          match.error = parsed.error;
        } else if (parsed && parsed.isError === true) {
          match.error = content;
        } else if (parsed && Object.keys(parsed).length > 0 && !parsed.raw) {
          // Successfully parsed as a real JSON object
          match.result = parsed;
        } else {
          // Plain string or unparseable content — store as-is
          match.result = content;
        }
      }
    }
  }

  // --- Second pass: annotate retry metadata ---
  const nameCount = new Map();
  const nameSeen = new Map();

  // Count total occurrences of each tool_name
  for (const call of calls) {
    const name = call.tool_name;
    nameCount.set(name, (nameCount.get(name) || 0) + 1);
  }

  // Assign attempt numbers and retry flags
  for (const call of calls) {
    const name = call.tool_name;
    const seen = (nameSeen.get(name) || 0) + 1;
    nameSeen.set(name, seen);
    call.attempt = seen;
    call.retry_count = nameCount.get(name);
    call.is_retry = seen > 1;
  }

  return calls;
}

function safeParse(str) {
  if (!str) return {};
  if (typeof str !== 'string') return {};
  try {
    const parsed = JSON.parse(str);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : { raw: str };
  } catch {
    return { raw: str };
  }
}
