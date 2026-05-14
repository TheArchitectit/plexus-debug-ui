export function extractToolCalls(rawRequest, rawResponse) {
  const calls = [];
  try {
    const req = JSON.parse(rawRequest || '{}');
    const resp = JSON.parse(rawResponse || '{}');

    const reqTools = req.tools || [];
    const respChoices = resp.choices || [];

    for (const choice of respChoices) {
      const message = choice.message || {};
      const toolCalls = message.tool_calls || [];
      for (const tc of toolCalls) {
        calls.push({
          tool_name: tc.function?.name || 'unknown',
          arguments: safeParse(tc.function?.arguments),
          result: null,
          error: null,
        });
      }
    }

    for (const item of resp.output || []) {
      if (item.type === 'function_call') {
        calls.push({
          tool_name: item.name || 'unknown',
          arguments: item.arguments || {},
          result: null,
          error: null,
        });
      }
    }
  } catch {
    return calls;
  }
  return calls;
}

function safeParse(str) {
  if (!str) return {};
  try {
    return JSON.parse(str);
  } catch {
    return { raw: str };
  }
}
