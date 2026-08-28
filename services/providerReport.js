// Provider-facing report builder. Pure functions only — no fs, pg, or network —
// so it is fully unit-testable and importable by both server and frontend.
export const MAX_REPORT_REQUESTS = 100;
export const MAX_NOTES_CHARS = 4000;

// Cap for how much assistant/reasoning text is inlined in report.md. The full
// raw stream is always shipped separately in raw/<id>_response.sse, so this only
// bounds the human-readable doc.
export const MAX_INLINE_TEXT = 100_000;

function asObject(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return null;
}

// Reassemble the model's response from whatever plexus stored. Tries an OpenAI
// SSE stream first (delta.content / delta.reasoning / delta.tool_calls), then an
// Anthropic *_response_snapshot (content[] blocks). Returns a normalized view.
export function analyzeResponse(debug) {
  const out = {
    present: false, model: null, responseId: null, created: null,
    finishReason: null, assistantText: '', reasoningText: '',
    toolCalls: [], rawSse: '', chunks: 0,
  };
  if (!debug) return out;

  const rawSse = typeof debug.raw_response === 'string' ? debug.raw_response
    : typeof debug.transformed_response === 'string' ? debug.transformed_response : '';

  if (rawSse && /(^|\n)\s*(event|data):\s*\S/.test(rawSse)) {
    const events = parseSseEvents(rawSse);
    const isAnthropic = events.some((e) => e.obj?.type === 'message_start' || e.obj?.type === 'content_block_delta')
      || events.some((e) => e.event === 'content_block_delta')
      || (/deepseek|claude/i.test(rawSse) && !/"object"\s*:\s*"chat.completion.chunk"/.test(rawSse) && /"type"\s*:\s*"content_block/.test(rawSse));
    return isAnthropic ? consumeAnthropicEvents(out, events, rawSse) : consumeOpenAIChunks(out, events, rawSse);
  }

  const snap = asObject(debug.raw_response_snapshot) || asObject(debug.transformed_response_snapshot);
  if (snap && Array.isArray(snap.content)) {
    out.present = true;
    out.model = snap.model || null;
    out.responseId = snap.id || null;
    out.finishReason = snap.stop_reason || null;
    for (const b of snap.content) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'text') out.assistantText += b.text || '';
      else if (b.type === 'thinking') out.reasoningText += b.thinking || '';
      else if (b.type === 'tool_use') out.toolCalls.push({ id: b.id, name: b.name, args: b.input });
    }
    return out;
  }

  // A JSON (non-SSE) response object could still be present.
  const json = asObject(debug.raw_response);
  if (json) {
    out.present = true;
    out.model = json.model || null;
    out.responseId = json.id || null;
    out.rawSse = JSON.stringify(json);
    const choice = (json.choices || [])[0];
    if (choice?.message?.content) out.assistantText = choice.message.content;
    if (choice?.finish_reason) out.finishReason = choice.finish_reason;
  }
  return out;
}

function parseSseEvents(rawSse) {
  const events = [];
  let cur = null;
  for (const line of rawSse.split('\n')) {
    const t = line.trim();
    if (t.startsWith('event:')) {
      if (cur && cur.obj) events.push(cur);
      cur = { event: t.slice(6).trim(), obj: null };
    } else if (t.startsWith('data:')) {
      const p = t.slice(5).trim();
      if (p === '[DONE]') break;
      let o = null; try { o = JSON.parse(p); } catch { /* skip */ }
      if (!cur) cur = { event: null, obj: o };
      else cur.obj = cur.obj || o;
      if (cur.obj) { events.push(cur); cur = null; }
    }
  }
  if (cur && cur.obj) events.push(cur);
  return events;
}

function consumeOpenAIChunks(out, events, rawSse) {
  out.present = true;
  out.rawSse = rawSse;
  const toolAcc = new Map();
  for (const { obj: c } of events) {
    out.chunks++;
    out.model = out.model || c.model || null;
    if (out.responseId == null && c.id) out.responseId = c.id;
    if (out.created == null && c.created) out.created = c.created;
    const ch = (Array.isArray(c.choices) ? c.choices : [])[0] || {};
    const dl = ch.delta || {};
    out.assistantText += dl.content || dl.text || '';
    out.reasoningText += dl.reasoning || dl.reasoning_content || '';
    for (const tc of dl.tool_calls || []) {
      const idx = tc.index ?? 0;
      const acc = toolAcc.get(idx) || { id: null, name: '', args: '' };
      if (tc.id) acc.id = tc.id;
      if (tc.function?.name) acc.name += tc.function.name;
      if (tc.function?.arguments) acc.args += tc.function.arguments;
      toolAcc.set(idx, acc);
    }
    if (ch.finish_reason) out.finishReason = ch.finish_reason;
  }
  out.toolCalls = [...toolAcc.values()].map((t) => ({ id: t.id, name: t.name, args: t.args }));
  return out;
}

function parseMaybeJson(s) {
  if (!s) return s;
  try { return JSON.parse(s); } catch { return s; }
}

function consumeAnthropicEvents(out, events, rawSse) {
  out.present = true;
  out.rawSse = rawSse;
  const blocks = new Map(); // index -> {kind, id, name, text, json}
  for (const { obj: c } of events) {
    if (!c || !c.type) continue;
    out.chunks++;
    if (c.type === 'message_start') {
      out.model = c.message?.model || out.model;
      if (out.responseId == null && c.message?.id) out.responseId = c.message.id;
    } else if (c.type === 'content_block_start') {
      const b = c.content_block || {};
      blocks.set(c.index ?? 0, { kind: b.type, id: b.id || null, name: b.name || '', text: b.text || b.thinking || '', json: '' });
    } else if (c.type === 'content_block_delta') {
      let blk = blocks.get(c.index ?? 0);
      if (!blk) { blk = { kind: null, id: null, name: '', text: '', json: '' }; blocks.set(c.index ?? 0, blk); }
      const d = c.delta || {};
      if (d.type === 'text_delta') blk.text += d.text || '';
      else if (d.type === 'thinking_delta') blk.text += d.thinking || '';
      else if (d.type === 'input_json_delta') blk.json += d.partial_json || '';
    } else if (c.type === 'message_delta') {
      if (c.delta?.stop_reason) out.finishReason = c.delta.stop_reason;
    } else if (c.type === 'message_stop') {
      /* done */
    }
  }
  for (const blk of blocks.values()) {
    if (blk.kind === 'tool_use') {
      out.toolCalls.push({ id: blk.id, name: blk.name, args: parseMaybeJson(blk.json) });
    } else if (blk.kind === 'thinking') {
      out.reasoningText += blk.text;
    } else if (blk.kind === 'text') {
      out.assistantText += blk.text;
    } else {
      out.assistantText += blk.text;
    }
  }
  return out;
}

function approxTokens(chars) {
  return chars ? Math.round(chars.length / 4) : 0;
}

function escapeCell(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function providerSlug(provider) {
  const base = (provider || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base || 'mixed';
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export function formatReportFilename(provider, date = new Date()) {
  return `provider-report-${providerSlug(provider)}-${stamp(date)}.zip`;
}

function sanitizeId(id) {
  return String(id).replace(/[/\\]/g, '_').replace(/\.\./g, '_');
}

// Truncate text to a hard char budget, appending an ellipsis marker when cut.
function clip(text, max) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n\n…[truncated ${s.length - max} chars — full text in raw file]`;
}

export function buildReportDoc(requests, notes = '') {
  const providers = [...new Set(requests.map((r) => r.usage?.provider).filter(Boolean))];
  const L = [];
  L.push('# Provider Debug Report');
  L.push('');
  L.push(`Generated ${new Date().toISOString()} · ${requests.length} request(s) · Provider(s): ${providers.join(', ') || 'unknown'}`);
  L.push('');
  L.push('## Summary');
  L.push('');
  L.push(notes ? clip(notes, MAX_NOTES_CHARS) : '_No notes provided._');
  L.push('');
  L.push('## Requests');
  L.push('');
  L.push('| # | request_id | time (UTC) | requested → served | provider | tokens in/out | finish | response id |');
  L.push('|---|-----------|------------|--------------------|----------|---------------|--------|-------------|');
  requests.forEach((r, i) => {
    const u = r.usage || {};
    const a = r.analysis || {};
    const routed = `${u.incoming_model_alias || '?'} → ${u.selected_model_name || a.model || '?'}`;
    L.push(`| ${i + 1} | ${escapeCell(r.request_id)} | ${escapeCell(u.date)} | ${escapeCell(routed)} | ${escapeCell(u.provider)} | ${escapeCell(u.tokens_input ?? '?')}/${escapeCell(u.tokens_output ?? '?')} | ${escapeCell(u.finish_reason || a.finishReason)} | ${escapeCell(a.responseId)} |`);
  });
  L.push('');

  requests.forEach((r, i) => {
    const u = r.usage || {};
    const a = r.analysis || {};
    const safeId = sanitizeId(r.request_id);
    L.push('---');
    L.push('');
    L.push(`## Request ${i + 1}: ${r.request_id}`);
    L.push('');
    L.push(`- **Time:** ${u.date ?? '?'}`);
    L.push(`- **Requested (alias):** ${u.incoming_model_alias ?? '?'}`);
    L.push(`- **Canonical:** ${u.canonical_model_name ?? '?'}`);
    L.push(`- **Served (selected):** ${u.selected_model_name ?? a.model ?? '?'}`);
    L.push(`- **Provider:** ${u.provider ?? '?'}`);
    L.push(`- **Status / finish_reason:** ${u.response_status ?? '?'} / ${u.finish_reason || a.finishReason || '?'}`);
    L.push(`- **Tokens in/out:** ${u.tokens_input ?? '?'} / ${u.tokens_output ?? '?'}`);
    L.push(`- **Duration:** ${u.duration_ms ?? '?'} ms · **Streamed:** ${u.is_streamed ?? '?'}`);
    if (a.responseId) L.push(`- **Response id (chatcmpl):** ${a.responseId}`);
    if (a.created) L.push(`- **Response created (unix):** ${a.created}`);
    if (a.model) L.push(`- **Model self-reported in stream:** ${a.model}`);
    L.push('');

    if (!a.present) {
      L.push('> Response payload not stored for this request — match on request_id and timestamp above.');
      L.push('');
      return;
    }

    L.push(`### Assistant text (${a.assistantText.length} chars, ~${approxTokens(a.assistantText)} tokens)`);
    L.push('');
    L.push('```');
    L.push(clip(a.assistantText, MAX_INLINE_TEXT));
    L.push('```');
    L.push('');

    if (a.reasoningText) {
      L.push(`### Reasoning (${a.reasoningText.length} chars, ~${approxTokens(a.reasoningText)} tokens)`);
      L.push('');
      L.push('```');
      L.push(clip(a.reasoningText, MAX_INLINE_TEXT));
      L.push('```');
      L.push('');
    }

    if (a.toolCalls?.length) {
      L.push('### Tool calls');
      L.push('');
      L.push('```json');
      L.push(JSON.stringify(a.toolCalls, null, 2));
      L.push('```');
      L.push('');
    }

    L.push(`### Raw SSE — first 500 lines (full stream: \`raw/${safeId}_response.sse\`)`);
    L.push('');
    L.push('```');
    L.push(String(a.rawSse).split('\n').slice(0, 500).join('\n'));
    L.push('```');
    L.push('');
  });

  return L.join('\n');
}

// Which usage-API params we can send server-side vs. post-filter client-side
// (the management API ignores hasError/hasRetry entirely).
const SERVER_FILTER_KEYS = ['provider', 'model', 'apiKey', 'status', 'dateFrom', 'dateTo', 'finishReason'];

export class TooManyMatchesError extends Error {
  constructor(max) {
    super(`Criteria match too many requests (${max}+ of a max ${max} per report) — narrow the filters`);
    this.name = 'TooManyMatchesError';
    this.code = 'TOO_MANY_MATCHES';
  }
}

function serverFilters(filters) {
  const out = {};
  for (const k of SERVER_FILTER_KEYS) {
    if (filters[k]) out[k] = filters[k];
  }
  return out;
}

function postFilter(rows, filters) {
  let r = rows;
  if (filters.hasError === 'true') r = r.filter((x) => x.has_error);
  else if (filters.hasError === 'false') r = r.filter((x) => !x.has_error);
  if (filters.hasRetry === 'true') r = r.filter((x) => Number(x.attempt_count) > 1);
  else if (filters.hasRetry === 'false') r = r.filter((x) => Number(x.attempt_count) <= 1);
  return r;
}

// Resolve report criteria to concrete request IDs. Fetches one page capped at
// MAX_REPORT_REQUESTS+1 — a full page means the criteria are too broad.
// listUsage is injected so this module stays side-effect-free.
// countOnly (preview mode): never throws on the cap; returns {count, overLimit, ids}.
export async function resolveRequestIds(filters = {}, { listUsage, countOnly = false }) {
  if (!Object.values(filters).some((v) => v !== '' && v != null)) {
    throw new Error('At least one filter criterion is required — reports are built from criteria, not an empty filter set');
  }
  const res = await listUsage({ ...serverFilters(filters), limit: MAX_REPORT_REQUESTS + 1 });
  const rows = postFilter(res.data || [], filters);
  // The live management API returns total as a string — normalize before comparing.
  const total = Number(res.total ?? rows.length) || 0;
  const overLimit = total > MAX_REPORT_REQUESTS || rows.length > MAX_REPORT_REQUESTS;
  if (overLimit && !countOnly) throw new TooManyMatchesError(MAX_REPORT_REQUESTS);
  if (countOnly) {
    return { count: total, overLimit, ids: rows.map((r) => r.request_id) };
  }
  return rows.map((r) => r.request_id);
}

export function rawFilesForRequest(request) {
  const safeId = sanitizeId(request.request_id);
  const files = {};
  const sse = request.analysis?.rawSse || '';
  if (sse) files[`raw/${safeId}_response.sse`] = sse;
  const rawReq = request.debug?.raw_request ?? request.debug?.transformed_request;
  if (rawReq) files[`raw/${safeId}_request.json`] =
    typeof rawReq === 'string' ? rawReq : JSON.stringify(rawReq);
  return files;
}
