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

  return calls;
}

function safeParse(str) {
  if (!str) return {};
  try {
    const parsed = JSON.parse(str);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : { raw: str };
  } catch {
    return { raw: str };
  }
}
