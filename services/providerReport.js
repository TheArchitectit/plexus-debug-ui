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

  if (rawSse && /(^|\n)\s*data:\s*\{/.test(rawSse)) {
    out.present = true;
    out.rawSse = rawSse;
    const toolAcc = new Map();
    for (const line of rawSse.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const p = t.slice(5).trim();
      if (p === '[DONE]') break;
      let c; try { c = JSON.parse(p); } catch { continue; }
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
    out.toolCalls = [...toolAcc.values()].map((t) => ({
      id: t.id, name: t.name, args: t.args,
    }));
    return out;
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
