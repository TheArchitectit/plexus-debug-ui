import { describe, it, expect } from 'vitest';
import {
  MAX_REPORT_REQUESTS,
  MAX_NOTES_CHARS,
  analyzeResponse,
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
