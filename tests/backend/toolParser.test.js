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
});
