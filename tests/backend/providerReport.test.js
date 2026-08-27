import { describe, it, expect } from 'vitest';
import {
  MAX_REPORT_REQUESTS,
  MAX_NOTES_CHARS,
  MAX_INLINE_TEXT,
  analyzeResponse,
  buildReportDoc,
  rawFilesForRequest,
  formatReportFilename,
  resolveRequestIds,
  TooManyMatchesError,
} from '../../services/providerReport.js';

// Build an OpenAI-style SSE body from a list of delta objects.
function sse(model, deltas, finish = 'stop', id = 'chatcmpl-xyz') {
  const lines = deltas.map((d) =>
    'data: ' + JSON.stringify({
      id, created: 1787843834, model, object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: d, finish_reason: null }],
    }),
  );
  lines.push('data: ' + JSON.stringify({
    id, created: 1787843834, model, object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: {}, finish_reason: finish }],
  }));
  lines.push('data: [DONE]');
  return lines.join('\n\n') + '\n\n';
}

describe('providerReport constants', () => {
  it('exposes caps', () => {
    expect(MAX_REPORT_REQUESTS).toBe(100);
    expect(MAX_NOTES_CHARS).toBe(4000);
  });
});

describe('analyzeResponse', () => {
  it('reassembles OpenAI delta.content into assistantText', () => {
    const debug = { raw_response: sse('deepseek-v4-pro', [
      { content: 'Hello ' }, { content: 'world' },
    ]) };
    const a = analyzeResponse(debug);
    expect(a.assistantText).toBe('Hello world');
    expect(a.model).toBe('deepseek-v4-pro');
    expect(a.responseId).toBe('chatcmpl-xyz');
    expect(a.finishReason).toBe('stop');
    expect(a.rawSse).toContain('data:');
  });

  it('separates reasoning from content', () => {
    const debug = { raw_response: sse('m', [
      { reasoning: 'thinking hard' }, { content: 'answer' },
    ]) };
    const a = analyzeResponse(debug);
    expect(a.reasoningText).toBe('thinking hard');
    expect(a.assistantText).toBe('answer');
  });

  it('reassembles tool call deltas', () => {
    const debug = { raw_response: sse('m', [
      { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '' } }] },
      { tool_calls: [{ index: 0, function: { arguments: '{"q":"x"}' } }] },
    ], 'tool_calls') };
    const a = analyzeResponse(debug);
    expect(a.toolCalls).toHaveLength(1);
    expect(a.toolCalls[0].name).toBe('search');
    expect(a.toolCalls[0].args).toBe('{"q":"x"}');
    expect(a.finishReason).toBe('tool_calls');
  });

  it('reads Anthropic snapshot content when raw_response is absent', () => {
    const snap = {
      model: 'claude-opus-4-6', stop_reason: 'tool_use',
      content: [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: 'hi there' },
        { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { cmd: 'ls' } },
      ],
    };
    const a = analyzeResponse({ raw_response_snapshot: JSON.stringify(snap) });
    expect(a.assistantText).toBe('hi there');
    expect(a.reasoningText).toBe('hmm');
    expect(a.model).toBe('claude-opus-4-6');
    expect(a.finishReason).toBe('tool_use');
    expect(a.toolCalls).toEqual([{ id: 'tu_1', name: 'Bash', args: { cmd: 'ls' } }]);
  });

  it('flags not-stored payloads', () => {
    const a = analyzeResponse(null);
    expect(a.present).toBe(false);
    const b = analyzeResponse({ raw_response: null, raw_response_snapshot: null });
    expect(b.present).toBe(false);
  });
});

describe('buildReportDoc', () => {
  const reqA = {
    request_id: 'aaa-111',
    usage: {
      request_id: 'aaa-111', date: '2026-08-27T15:17:13Z',
      provider: 'neuralwatt', incoming_model_alias: 'openclaw',
      canonical_model_name: 'openclaw_3750', selected_model_name: 'deepseek-v4-pro',
      response_status: 'success', finish_reason: 'stop',
      tokens_input: 3733, tokens_output: 653, duration_ms: 7814, is_streamed: true,
    },
    analysis: {
      present: true, model: 'deepseek-v4-pro', responseId: 'chatcmpl-cc94', created: 1787843834,
      finishReason: 'stop', assistantText: 'garbage output here', reasoningText: 'bad thinking',
      toolCalls: [], rawSse: 'data: {...}\n\n', chunks: 381,
    },
    debug: { raw_request: null },
  };

  it('includes notes verbatim as the summary', () => {
    const md = buildReportDoc([reqA], 'These 3 responses were pure garbage.');
    expect(md).toContain('These 3 responses were pure garbage.');
  });

  it('renders a summary table row per request', () => {
    const md = buildReportDoc([reqA], '');
    expect(md).toContain('aaa-111');
    expect(md).toContain('neuralwatt');
    expect(md).toContain('openclaw');
    expect(md).toContain('deepseek-v4-pro');
  });

  it('renders a per-request section with model self-report and response id', () => {
    const md = buildReportDoc([reqA], 'x');
    expect(md).toContain('## Request 1: aaa-111');
    expect(md).toContain('chatcmpl-cc94');
    expect(md).toContain('deepseek-v4-pro');
    expect(md).toContain('garbage output here');
    expect(md).toContain('bad thinking');
  });

  it('marks not-stored payloads explicitly', () => {
    const missing = {
      request_id: 'bbb-222',
      usage: { request_id: 'bbb-222', provider: 'gmi', date: '2026-08-27T15:00:00Z' },
      analysis: { present: false, model: null, responseId: null, finishReason: null,
        assistantText: '', reasoningText: '', toolCalls: [], rawSse: '', chunks: 0 },
      debug: null,
    };
    const md = buildReportDoc([missing], '');
    expect(md).toMatch(/not stored/i);
    expect(md).toContain('bbb-222');
  });

  it('truncates oversized assistant text in the doc but points at the raw file', () => {
    const big = { ...reqA, analysis: { ...reqA.analysis, assistantText: 'A'.repeat(MAX_INLINE_TEXT + 1) } };
    const md = buildReportDoc([big], '');
    const asst = md.split('### Assistant text')[1].split('```')[1];
    expect(asst).toContain('[truncated');
    expect((asst.match(/A/g) || []).length).toBe(MAX_INLINE_TEXT);
    expect(md).toContain('raw/aaa-111_response.sse');
  });

  it('truncates oversized notes to MAX_NOTES_CHARS', () => {
    const long = 'Z'.repeat(5000);
    const md = buildReportDoc([reqA], long);
    expect(md).toContain('Z'.repeat(4000));
    expect(md).not.toContain('Z'.repeat(4001));
  });
});

describe('rawFilesForRequest', () => {
  it('returns the full sse stream keyed by id', () => {
    const files = rawFilesForRequest({ request_id: 'aaa-111', debug: {}, analysis:
      { rawSse: 'data: x\n\n' } });
    expect(files['raw/aaa-111_response.sse']).toBe('data: x\n\n');
  });

  it('includes request json when plexus stored one', () => {
    const files = rawFilesForRequest({ request_id: 'a', analysis: { rawSse: 's' },
      debug: { raw_request: '{"model":"m"}' } });
    expect(files['raw/a_request.json']).toBe('{"model":"m"}');
  });

  it('omits request json when null', () => {
    const files = rawFilesForRequest({ request_id: 'a', analysis: { rawSse: 's' },
      debug: { raw_request: null } });
    expect(files['raw/a_request.json']).toBeUndefined();
  });

  it('sanitizes path separators in ids', () => {
    const files = rawFilesForRequest({ request_id: '../etc/passwd', analysis: { rawSse: 's' }, debug: {} });
    expect(Object.keys(files)).toEqual(['raw/__etc_passwd_response.sse']);
  });
});

describe('resolveRequestIds', () => {
  const usageRow = (id, extra) => ({ request_id: id, provider: 'neuralwatt', has_error: false, attempt_count: 1, ...extra });

  it('maps UI filters to listUsage params and returns ids', async () => {
    const calls = [];
    const rows = [usageRow('x1', { has_error: true }), usageRow('x2', { has_error: true })];
    const listUsage = async (f) => { calls.push(f); return { data: rows, total: 2 }; };
    const ids = await resolveRequestIds(
      { provider: 'neuralwatt', model: 'openclaw', dateFrom: '2026-08-27', dateTo: '2026-08-28', status: 'success', apiKey: 'k1', finishReason: 'stop', hasError: 'true', hasRetry: 'false' },
      { listUsage },
    );
    expect(ids).toEqual(['x1', 'x2']);
    expect(calls[0]).toMatchObject({
      provider: 'neuralwatt', model: 'openclaw', dateFrom: '2026-08-27', dateTo: '2026-08-28',
      status: 'success', apiKey: 'k1', finishReason: 'stop', limit: 101,
    });
    // hasError/hasRetry are client-side post-filters (API ignores them)
    expect(calls[0].hasError).toBeUndefined();
    expect(calls[0].hasRetry).toBeUndefined();
  });

  it('applies hasError/hasRetry post-filters to returned rows', async () => {
    const rows = [
      { request_id: 'e1', has_error: true, attempt_count: 3 },
      { request_id: 'n1', has_error: false, attempt_count: 1 },
    ];
    const listUsage = async () => ({ data: rows, total: rows.length });
    expect(await resolveRequestIds({ hasError: 'true' }, { listUsage })).toEqual(['e1']);
    expect(await resolveRequestIds({ hasRetry: 'false' }, { listUsage })).toEqual(['n1']);
    expect(await resolveRequestIds({ provider: 'p' }, { listUsage })).toEqual(['e1', 'n1']);
  });

  it('throws TooManyMatchesError when matches exceed the cap', async () => {
    const rows = Array.from({ length: MAX_REPORT_REQUESTS + 1 }, (_, i) => usageRow('id' + i));
    // total larger than cap: fails even before page contents matter
    const listUsage = async () => ({ data: rows.slice(0, 100), total: 5000 });
    await expect(resolveRequestIds({ provider: 'p' }, { listUsage }))
      .rejects.toBeInstanceOf(TooManyMatchesError);
    // fallback when total is absent: page length over cap also fails
    const noTotal = async () => ({ data: rows });
    await expect(resolveRequestIds({ provider: 'p' }, { listUsage: noTotal }))
      .rejects.toBeInstanceOf(TooManyMatchesError);
  });

  it('throws when criteria are empty', async () => {
    await expect(resolveRequestIds({}, { listUsage: async () => ({ data: [], total: 0 }) }))
      .rejects.toThrow(/criteria/i);
    await expect(resolveRequestIds({ provider: '' }, { listUsage: async () => ({ data: [], total: 0 }) }))
      .rejects.toThrow(/criteria/i);
  });
});

describe('formatReportFilename', () => {
  it('slugs the provider and stamps the date', () => {
    const name = formatReportFilename('Charm lundrog', new Date('2026-08-27T16:04:05Z'));
    expect(name).toBe('provider-report-charm-lundrog-20260827-160405.zip');
  });

  it('falls back to mixed for empty/missing provider', () => {
    expect(formatReportFilename(null, new Date('2026-01-01T00:00:00Z')))
      .toBe('provider-report-mixed-20260101-000000.zip');
  });
});
