import { describe, it, expect } from 'vitest';
import { extractToolCalls } from '../../services/toolParser.js';

describe('extractToolCalls', () => {
  it('returns empty array for empty inputs', () => {
    expect(extractToolCalls(null, null)).toEqual([]);
    expect(extractToolCalls('', '')).toEqual([]);
  });

  it('returns empty array for invalid JSON', () => {
    expect(extractToolCalls('not json', 'not json')).toEqual([]);
  });

  it('extracts OpenAI Chat Completion tool calls with null result/error', () => {
    const rawReq = JSON.stringify({ messages: [] });
    const rawRes = JSON.stringify({
      choices: [{
        message: {
          tool_calls: [{
            id: 'call_abc',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"SF"}' },
          }],
        },
      }],
    });

    const calls = extractToolCalls(rawReq, rawRes);
    expect(calls).toHaveLength(1);
    expect(calls[0].tool_name).toBe('get_weather');
    expect(calls[0].arguments).toEqual({ city: 'SF' });
    expect(calls[0].result).toBeNull();
    expect(calls[0].error).toBeNull();
  });

  it('matches OpenAI tool role messages as results', () => {
    const rawReq = JSON.stringify({
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', tool_calls: [{ id: 'call_1', function: { name: 'search', arguments: '{"q":"test"}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: '{"results":["a","b"]}' },
      ],
    });
    const rawRes = JSON.stringify({
      choices: [{
        message: {
          tool_calls: [{
            id: 'call_1',
            function: { name: 'search', arguments: '{"q":"test"}' },
          }],
        },
      }],
    });

    const calls = extractToolCalls(rawReq, rawRes);
    expect(calls).toHaveLength(1);
    expect(calls[0].tool_name).toBe('search');
    expect(calls[0].result).toEqual({ results: ['a', 'b'] });
    expect(calls[0].error).toBeNull();
  });

  it('matches OpenAI tool role messages as errors', () => {
    const rawReq = JSON.stringify({
      messages: [
        { role: 'assistant', tool_calls: [{ id: 'call_err', function: { name: 'fail', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'call_err', content: '{"error":"timeout"}' },
      ],
    });
    const rawRes = JSON.stringify({
      choices: [{ message: { tool_calls: [{ id: 'call_err', function: { name: 'fail', arguments: '{}' } }] } }],
    });

    const calls = extractToolCalls(rawReq, rawRes);
    expect(calls).toHaveLength(1);
    expect(calls[0].error).toBe('timeout');
  });

  it('extracts Responses API function_call items', () => {
    const rawReq = JSON.stringify({ input: 'hello' });
    const rawRes = JSON.stringify({
      output: [
        { type: 'function_call', id: 'fc_1', name: 'read_file', arguments: '{"path":"/tmp/x"}' },
      ],
    });

    const calls = extractToolCalls(rawReq, rawRes);
    expect(calls).toHaveLength(1);
    expect(calls[0].tool_name).toBe('read_file');
    expect(calls[0].arguments).toEqual({ path: '/tmp/x' });
  });

  it('matches Responses API function_call_output items', () => {
    const rawReq = JSON.stringify({ input: 'read file' });
    const rawRes = JSON.stringify({
      output: [
        { type: 'function_call', id: 'fc_2', name: 'read_file', arguments: '{"path":"/etc/hosts"}' },
        { type: 'function_call_output', call_id: 'fc_2', output: '127.0.0.1 localhost' },
      ],
    });

    const calls = extractToolCalls(rawReq, rawRes);
    expect(calls).toHaveLength(1);
    expect(calls[0].tool_name).toBe('read_file');
    expect(calls[0].result).toBe('127.0.0.1 localhost');
    expect(calls[0].error).toBeNull();
  });

  it('matches Responses API function_call_output as error when is_error is true', () => {
    const rawReq = JSON.stringify({ input: 'do thing' });
    const rawRes = JSON.stringify({
      output: [
        { type: 'function_call', id: 'fc_3', name: 'risky_op', arguments: '{}' },
        { type: 'function_call_output', call_id: 'fc_3', output: 'Permission denied', is_error: true },
      ],
    });

    const calls = extractToolCalls(rawReq, rawRes);
    expect(calls).toHaveLength(1);
    expect(calls[0].result).toBeNull();
    expect(calls[0].error).toBe('Permission denied');
  });

  it('handles multiple tool calls with mixed results', () => {
    const rawReq = JSON.stringify({
      messages: [
        { role: 'tool', tool_call_id: 'c1', content: 'result1' },
        { role: 'tool', tool_call_id: 'c2', content: '{"error":"bad"}' },
      ],
    });
    const rawRes = JSON.stringify({
      choices: [{
        message: {
          tool_calls: [
            { id: 'c1', function: { name: 'fn1', arguments: '{}' } },
            { id: 'c2', function: { name: 'fn2', arguments: '{}' } },
            { id: 'c3', function: { name: 'fn3', arguments: '{}' } },
          ],
        },
      }],
    });

    const calls = extractToolCalls(rawReq, rawRes);
    expect(calls).toHaveLength(3);
    expect(calls[0].result).toEqual({ raw: 'result1' });
    expect(calls[0].error).toBeNull();
    expect(calls[1].result).toBeNull();
    expect(calls[1].error).toBe('bad');
    expect(calls[2].result).toBeNull();
    expect(calls[2].error).toBeNull();
  });

  // --- New: Anthropic snapshot format (the production plexus stream shape) ---

  it('extracts tool_use blocks from transformed_response_snapshot', () => {
    const snapshot = JSON.stringify({
      id: 'gen-1',
      type: 'message',
      role: 'assistant',
      model: 'stealth/ox-alpha',
      content: [{
        type: 'tool_use',
        id: 'call_xyz',
        name: 'Bash',
        input: { command: 'cargo test', timeout: 1800000 },
      }],
      stop_reason: 'tool_use',
    });

    const sseResp = ': OPENROUTER PROCESSING\n\ndata: {"object":"chat.completion.chunk"}';
    const calls = extractToolCalls(null, sseResp, {
      transformed_response_snapshot: snapshot,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].tool_name).toBe('Bash');
    expect(calls[0].arguments).toEqual({ command: 'cargo test', timeout: 1800000 });
  });

  it('reassembles incremental delta tool_calls from an SSE stream', () => {
    // Fragments concatenated verbatim match the real plexus behaviour where the
    // provider streams the JSON arguments string piece by piece.
    const sseResp = [
      ': OPENROUTER PROCESSING',
      '',
      'data: {"object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_ss1","type":"function","function":{"name":"Bash","arguments":""}}]}}]}',
      '',
      'data: {"object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"command\\":\\"cargo "}}]}}]}',
      '',
      'data: {"object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"test --workspace\\"}"}}]},"finish_reason":"tool_calls"}]}',
      '',
      'data: [DONE]',
    ].join('\n');

    const calls = extractToolCalls(null, sseResp, {});
    expect(calls).toHaveLength(1);
    expect(calls[0].tool_name).toBe('Bash');
    expect(calls[0].id).toBe('call_ss1');
    expect(calls[0].arguments).toEqual({ command: 'cargo test --workspace' });
  });

  it('prefers snapshot over SSE when both are present', () => {
    const snapshot = JSON.stringify({
      content: [{ type: 'tool_use', id: 'snap_1', name: 'Read', input: { path: '/a' } }],
    });
    const sseResp = 'data: {"object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"name":"Wrong","arguments":""}}]}}]}';
    const calls = extractToolCalls(null, sseResp, { transformed_response_snapshot: snapshot });
    expect(calls).toHaveLength(1);
    expect(calls[0].tool_name).toBe('Read');
  });

  it('accepts the single-object opts form', () => {
    const snapshot = JSON.stringify({
      content: [{ type: 'tool_use', id: 'snap_2', name: 'Edit', input: {} }],
    });
    const calls = extractToolCalls({
      rawRequest: null,
      rawResponse: ': OPENROUTER PROCESSING\ndata: {"object":"chat.completion.chunk"}',
      transformedResponseSnapshot: snapshot,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].tool_name).toBe('Edit');
  });
});
