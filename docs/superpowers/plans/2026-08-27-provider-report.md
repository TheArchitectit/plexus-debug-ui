# Provider Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user select N requests and download a provider-facing evidence ZIP (`report.md` + raw SSE streams), stored in a re-downloadable Reports history.

**Architecture:** A dependency-free `services/providerReport.js` (SSE reassembly + markdown builder + shared cap constants), a thin `routes/reports.js` that fetches usage+debug via `plexusApi` and writes a ZIP through a new `createProviderReportBundle` in `zipExporter.js`, a `provider_reports` DB table, and a frontend Reports view + Dashboard button mirroring the existing export flow.

**Tech Stack:** Node/Express (ESM), `pg`, `archiver`, React 18, Vite, vitest (jsdom + node), @testing-library/react.

Spec: `docs/superpowers/specs/2026-08-27-provider-report-design.md`

---

## File Structure

- Create `services/providerReport.js` — pure: constants, `analyzeResponse`, `buildReportDoc`, `rawFilesForRequest`. No fs/pg/network imports (fully unit-testable).
- Modify `services/zipExporter.js` — add `createProviderReportBundle({ reportMd, rawFiles }, outPath)`.
- Create `routes/reports.js` — POST create, GET `/:id` download, GET `/` list.
- Modify `db/migrate.js` — add `provider_reports` table (+index).
- Modify `server.js` — mount `/api/reports`.
- Modify `src/lib/api.js` — add `reportsApi`, `downloadReport`.
- Create `src/components/ReportsView.jsx` — create form + history.
- Modify `src/App.jsx` — Reports nav + view.
- Modify `src/components/Dashboard.jsx` — "Provider Report" button.
- Tests: `tests/backend/providerReport.test.js`, `tests/backend/zipProviderReport.test.js`, `tests/backend/reports.test.js` (extend `zipExporter.test.js` pattern).

Vitest runs all tests in a `jsdom` environment (see `vite.config.js` → `test.environment: 'jsdom'`); the backend tests here don't touch DOM APIs so they work as-is. No `.env` exists in the repo and the committed suite runs bare, so run tests with plain `npx vitest run <file>` (no env prefix).

---

## Task 1: Shared constants + SSE/response analyzer

**Files:**
- Create: `services/providerReport.js`
- Test: `tests/backend/providerReport.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/backend/providerReport.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/backend/providerReport.test.js`
Expected: FAIL — "Failed to resolve import ... providerReport.js" / module not found.

- [ ] **Step 3: Write minimal implementation**

Create `services/providerReport.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/backend/providerReport.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add services/providerReport.js tests/backend/providerReport.test.js
git commit -m "feat: provider-report response analyzer + shared caps"
```

---

## Task 2: report.md builder + raw file map

**Files:**
- Modify: `services/providerReport.js` (append functions)
- Test: `tests/backend/providerReport.test.js` (append)

- [ ] **Step 1: Write the failing test**

Extend `tests/backend/providerReport.test.js` — replace the top import with:

```js
import {
  MAX_REPORT_REQUESTS,
  MAX_NOTES_CHARS,
  MAX_INLINE_TEXT,
  analyzeResponse,
  buildReportDoc,
  rawFilesForRequest,
  formatReportFilename,
} from '../../services/providerReport.js';
```

Then append the describes below (Task 2 will make them fail→pass):

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
    expect(Object.keys(files)).toEqual(['raw/.._etc_passwd_response.sse']);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/backend/providerReport.test.js`
Expected: FAIL — "does not provide an export named 'buildReportDoc'" (or the raw import error if combined into a not-yet-created symbol).

- [ ] **Step 3: Write minimal implementation**

Append to `services/providerReport.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/backend/providerReport.test.js`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/providerReport.js tests/backend/providerReport.test.js
git commit -m "feat: provider-report markdown builder, raw-file map, filename"
```

---

## Task 3: ZIP bundle writer

**Files:**
- Modify: `services/zipExporter.js`
- Test: `tests/backend/zipProviderReport.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/backend/zipProviderReport.test.js`:

```js
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import unzipper from 'unzipper';
import { createProviderReportBundle } from '../../services/zipExporter.js';

async function listEntries(zipPath) {
  const dir = await unzipper.Open.file(zipPath);
  return Object.fromEntries(
    await Promise.all(dir.files.map(async (f) => [
      f.path, (await f.buffer()).toString('utf8'),
    ])),
  );
}

describe('createProviderReportBundle', () => {
  it('writes report.md plus each raw file', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-'));
    const out = path.join(tmp, 'r.zip');
    const res = await createProviderReportBundle(
      { reportMd: '# hi\n', rawFiles: { 'raw/a_response.sse': 'data: x\n', 'raw/a_request.json': '{}' } },
      out,
    );
    expect(res.filePath).toBe(out);
    expect(res.fileSize).toBeGreaterThan(0);
    const entries = await listEntries(out);
    expect(entries['report.md']).toBe('# hi\n');
    expect(entries['raw/a_response.sse']).toBe('data: x\n');
    expect(entries['raw/a_request.json']).toBe('{}');
    fs.rmSync(tmp, { recursive: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/backend/zipProviderReport.test.js`
Expected: FAIL — "does not provide an export named 'createProviderReportBundle'".

- [ ] **Step 3: Write minimal implementation**

In `services/zipExporter.js`, after `sanitizeId` (line ~9), add:

```js
export async function createProviderReportBundle({ reportMd, rawFiles = {} }, outPath) {
	const dir = path.dirname(outPath);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

	const output = fs.createWriteStream(outPath);
	const archive = archiver("zip", { zlib: { level: 6 } });

	await new Promise((resolve, reject) => {
		output.on("close", resolve);
		output.on("error", reject);
		archive.on("error", reject);
		archive.on("warning", (err) => { if (err.code !== "ENOENT") reject(err); });
		archive.pipe(output);

		archive.append(reportMd, { name: "report.md" });
		for (const [name, content] of Object.entries(rawFiles)) {
			if (content == null) continue;
			archive.append(content, { name });
		}
		archive.finalize();
	});

	const stats = fs.statSync(outPath);
	return { filePath: outPath, fileSize: stats.size };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/backend/zipProviderReport.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add services/zipExporter.js tests/backend/zipProviderReport.test.js
git commit -m "feat: createProviderReportBundle zip writer"
```

---

## Task 4: DB table

**Files:**
- Modify: `db/migrate.js`

- [ ] **Step 1: Add the table to the schema SQL**

In `db/migrate.js`, inside the `schemaSQL` template literal, just after the `parsed_tool_calls` index lines (before the closing backtick), add:

```sql
CREATE TABLE IF NOT EXISTS provider_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider TEXT,
    notes TEXT,
    request_ids TEXT[] NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_provider_reports_created_at ON provider_reports(created_at);
```

- [ ] **Step 2: Verify migration is syntactically valid**

Run: `node --check db/migrate.js && echo PARSE_OK`
Expected: prints `PARSE_OK`. (No DB is touched; actual table creation is verified on AI01 deploy in Task 9, where the container runs `node db/migrate.js` against real Postgres.)

- [ ] **Step 3: Commit**

```bash
git add db/migrate.js
git commit -m "feat: provider_reports table"
```

---

## Task 5: Reports route

**Files:**
- Create: `routes/reports.js`
- Test: `tests/backend/reports.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/backend/reports.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import unzipper from 'unzipper';

vi.mock('../../middleware/auth.js', () => ({ requireAuth: (_r, _s, n) => n() }));
vi.mock('../../config.js', () => ({ config: { exportsDir: '' } }));
vi.mock('../../db/app.js', () => ({ queryApp: vi.fn().mockResolvedValue([{ id: 'rep-1' }]) }));
vi.mock('../../services/plexusApi.js', () => ({ plexusApi: { listUsage: vi.fn(), getDebugLog: vi.fn() } }));

import { config } from '../../config.js';
import { plexusApi } from '../../services/plexusApi.js';
import { queryApp } from '../../db/app.js';
import reportsRouter from '../../routes/reports.js';

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/reports', reportsRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}/api/reports` }));
  });
}
async function readZip(p) {
  const dir = await unzipper.Open.file(p);
  return dir.files.map((f) => f.path);
}

describe('POST /api/reports', () => {
  beforeEach(() => {
    config.exportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-'));
    queryApp.mockResolvedValue([{ id: 'rep-1' }]);
    plexusApi.listUsage.mockResolvedValue({ data: [{
      request_id: 'a', provider: 'neuralwatt', incoming_model_alias: 'openclaw',
      selected_model_name: 'deepseek-v4-pro', tokens_output: 653, date: '2026-08-27T15:00:00Z',
    }], total: 1 });
    plexusApi.getDebugLog.mockResolvedValue({ request_id: 'a', raw_response: 'data: {"id":"chatcmpl-1","model":"deepseek-v4-pro","choices":[{"index":0,"delta":{"content":"bad"},"finish_reason":"stop"}]}\n\n', raw_request: null });
  });

  it('rejects empty requestIds', async () => {
    const { server, base } = await startApp();
    try {
      const r = await fetch(base + '/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestIds: [] }) });
      expect(r.status).toBe(400);
    } finally { server.close(); }
  });

  it('rejects over the request cap', async () => {
    const { server, base } = await startApp();
    try {
      const ids = Array.from({ length: 101 }, (_, i) => 'id' + i);
      const r = await fetch(base + '/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestIds: ids }) });
      expect(r.status).toBe(400);
    } finally { server.close(); }
  });

  it('rejects oversized notes', async () => {
    const { server, base } = await startApp();
    try {
      const r = await fetch(base + '/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestIds: ['a'], notes: 'Z'.repeat(5000) }) });
      expect(r.status).toBe(400);
    } finally { server.close(); }
  });

  it('400s when no id resolves to a usage row or debug payload', async () => {
    plexusApi.listUsage.mockResolvedValue({ data: [], total: 0 });
    plexusApi.getDebugLog.mockRejectedValue(new Error('404'));
    const { server, base } = await startApp();
    try {
      const r = await fetch(base + '/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestIds: ['nope'] }) });
      expect(r.status).toBe(400);
    } finally { server.close(); }
  });

  it('writes a ZIP with report.md + raw sse and returns a downloadUrl', async () => {
    const { server, base } = await startApp();
    try {
      const r = await fetch(base + '/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestIds: ['a'], notes: 'garbage' }) });
      expect(r.status).toBe(201);
      const body = await r.json();
      expect(body.downloadUrl).toBe('/api/reports/rep-1');
      expect(body.fileSize).toBeGreaterThan(0);
      expect(queryApp).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO provider_reports'), expect.any(Array));
      const inserted = queryApp.mock.calls.find((c) => /INSERT INTO provider_reports/.test(c[0]))[1];
      expect(Array.isArray(inserted[2])).toBe(true); // request_ids array param
      // a real zip exists on disk with report.md + raw sse
      const created = fs.readdirSync(config.exportsDir).filter((f) => f.endsWith('.zip'));
      expect(created.length).toBe(1);
      expect(await readZip(path.join(config.exportsDir, created[0]))).toEqual(
        expect.arrayContaining(['report.md', 'raw/a_response.sse']));
    } finally { server.close(); }
  });
});

describe('GET /api/reports/:id + /', () => {
  it('downloads when the file exists', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rptdl-'));
    config.exportsDir = dir;
    const zip = path.join(dir, 'x.zip');
    fs.writeFileSync(zip, 'dummy');
    queryApp.mockResolvedValueOnce([{ file_path: zip }]);
    const { server, base } = await startApp();
    try {
      const r = await fetch(base + '/rep-1');
      expect(r.status).toBe(200);
    } finally { server.close(); }
  });

  it('404s when the record is missing', async () => {
    queryApp.mockResolvedValueOnce([]);
    const { server, base } = await startApp();
    try {
      const r = await fetch(base + '/missing');
      expect(r.status).toBe(404);
    } finally { server.close(); }
  });

  it('lists history', async () => {
    queryApp.mockResolvedValueOnce([{ id: 'rep-1', provider: 'neuralwatt', request_ids: ['a'] }]);
    const { server, base } = await startApp();
    try {
      const body = await (await fetch(base + '/')).json();
      expect(body.data).toEqual([{ id: 'rep-1', provider: 'neuralwatt', request_ids: ['a'] }]);
    } finally { server.close(); }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/backend/reports.test.js`
Expected: FAIL — "Failed to resolve import ... routes/reports.js".

- [ ] **Step 3: Write implementation**

Create `routes/reports.js`:

```js
import { Router } from "express";
import path from "path";
import fs from "fs";
import { queryApp } from "../db/app.js";
import { plexusApi } from "../services/plexusApi.js";
import { createProviderReportBundle } from "../services/zipExporter.js";
import {
  analyzeResponse, buildReportDoc, rawFilesForRequest, formatReportFilename,
  MAX_REPORT_REQUESTS, MAX_NOTES_CHARS,
} from "../services/providerReport.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { config } from "../config.js";

const DEFAULT_USER = "admin";
const router = Router();
router.use(requireAuth);

async function assemble(requestId) {
  const [usage, debug] = await Promise.all([
    plexusApi.listUsage({ requestId, limit: "1" }).then((r) => r.data?.[0] || null).catch(() => null),
    plexusApi.getDebugLog(requestId).catch(() => null),
  ]);
  return {
    request_id: requestId,
    usage,
    debug,
    analysis: analyzeResponse(debug),
    resolved: !!usage || !!debug,
  };
}

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { requestIds, notes = "" } = req.body || {};
    if (!Array.isArray(requestIds) || requestIds.length === 0) {
      return res.status(400).json({ error: "requestIds array required" });
    }
    if (requestIds.length > MAX_REPORT_REQUESTS) {
      return res.status(400).json({ error: `Maximum ${MAX_REPORT_REQUESTS} requests per report` });
    }
    if (typeof notes !== "string" || notes.length > MAX_NOTES_CHARS) {
      return res.status(400).json({ error: `Notes must be under ${MAX_NOTES_CHARS} characters` });
    }

    const assembled = await Promise.all(requestIds.map(assemble));
    const usable = assembled.filter((r) => r.resolved);
    if (usable.length === 0) {
      return res.status(400).json({ error: "No matching requests (no usage or debug found)" });
    }

    const reportMd = buildReportDoc(usable, notes);
    const rawFiles = Object.assign({}, ...usable.map(rawFilesForRequest));
    const provider = usable.map((r) => r.usage?.provider).find(Boolean) || null;

    const fileName = formatReportFilename(provider);
    const outPath = path.join(config.exportsDir, fileName);
    const bundle = await createProviderReportBundle({ reportMd, rawFiles }, outPath);

    const [row] = await queryApp(
      `INSERT INTO provider_reports (provider, notes, request_ids, file_path, file_size, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [provider, notes, usable.map((r) => r.request_id), outPath, bundle.fileSize, DEFAULT_USER],
    );

    res.status(201).json({
      reportId: row.id,
      downloadUrl: `/api/reports/${row.id}`,
      fileSize: bundle.fileSize,
    });
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [record] = await queryApp(`SELECT file_path FROM provider_reports WHERE id = $1`, [req.params.id]);
    if (!record || !fs.existsSync(record.file_path)) {
      return res.status(404).json({ error: "Report not found" });
    }
    const resolved = path.resolve(record.file_path);
    if (!resolved.startsWith(path.resolve(config.exportsDir))) {
      return res.status(403).json({ error: "Invalid file path" });
    }
    res.download(resolved);
  }),
);

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const rows = await queryApp(
      `SELECT id, provider, notes, request_ids, file_size, created_at
       FROM provider_reports ORDER BY created_at DESC LIMIT 50`,
    );
    res.json({ data: rows });
  }),
);

export default router;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/backend/reports.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add routes/reports.js tests/backend/reports.test.js
git commit -m "feat: /api/reports create + download + history route"
```

---

## Task 6: Mount route + frontend API client

**Files:**
- Modify: `server.js`
- Modify: `src/lib/api.js`

- [ ] **Step 1: Mount the router in server.js**

After `import healthRouter from './routes/health.js';` add:
```js
import reportsRouter from './routes/reports.js';
```
Then after `app.use('/api/annotations', annotationsRouter);` add:
```js
app.use('/api/reports', reportsRouter);
```

- [ ] **Step 2: Add reportsApi + downloadReport to src/lib/api.js**

After `export const exportApi = { ... }` (before `downloadExport`) add:
```js
export const reportsApi = {
  create: (requestIds, notes) => api('/reports', {
    method: 'POST',
    body: JSON.stringify({ requestIds, notes }),
  }),
  history: () => api('/reports'),
};
```
After the existing `downloadExport` function add:
```js
export async function downloadReport(reportId) {
  const res = await fetch(`/api/reports/${reportId}`, {
    headers: { 'Authorization': `Bearer ${getAdminKey()}` },
  });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `provider-report-${reportId}.zip`;
  a.click();
  window.URL.revokeObjectURL(url);
}
```

- [ ] **Step 3: Verify all server modules resolve**

Run: `npx esbuild server.js routes/reports.js services/providerReport.js services/zipExporter.js db/migrate.js --bundle --platform=node --format=esm --outdir=/tmp/rpt-bundle-check && echo RESOLVE_OK`
Expected: prints `RESOLVE_OK` — every import graph (including `./routes/reports.js`) resolves and parses. (No server boot needed; end-to-end verification happens in Task 9 Step 5.)

- [ ] **Step 4: Frontend build still compiles**

Run: `npm run build 2>&1 | tail -4`
Expected: `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add server.js src/lib/api.js
git commit -m "feat: mount reports route + frontend reportsApi/downloadReport"
```

---

## Task 7: Reports view component

**Files:**
- Create: `src/components/ReportsView.jsx`
- Modify: `src/App.jsx`
- Test: `tests/frontend/ReportsView.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/frontend/ReportsView.test.jsx`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReportsView from '../../src/components/ReportsView.jsx';
import { reportsApi, downloadReport } from '../../src/lib/api.js';
import { MAX_REPORT_REQUESTS } from '../../services/providerReport.js';

vi.mock('../../src/lib/api.js', () => ({
  reportsApi: { create: vi.fn(), history: vi.fn() },
  downloadReport: vi.fn(),
}));

describe('ReportsView', () => {
  beforeEach(() => {
    reportsApi.history.mockResolvedValue({
      data: [{ id: 'r1', provider: 'neuralwatt', request_ids: ['a'], file_size: 1000, created_at: '2026-08-27T15:00:00Z' }],
    });
    reportsApi.create.mockResolvedValue({ reportId: 'r2', downloadUrl: '/api/reports/r2', fileSize: 10 });
    downloadReport.mockResolvedValue(undefined);
  });

  it('renders the create form and history', async () => {
    render(<ReportsView />);
    expect(screen.getByLabelText(/request ids/i)).toBeTruthy();
    expect(screen.getByLabelText(/notes|summary/i)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('neuralwatt')).toBeTruthy());
  });

  it('creates a report from pasted ids and triggers download', async () => {
    render(<ReportsView />);
    fireEvent.change(screen.getByLabelText(/request ids/i), { target: { value: 'id-a\nid-b, id-c' } });
    fireEvent.change(screen.getByLabelText(/notes|summary/i), { target: { value: 'broken output' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(reportsApi.create).toHaveBeenCalledWith(['id-a', 'id-b', 'id-c'], 'broken output'));
    expect(downloadReport).toHaveBeenCalledWith('r2');
  });

  it('blocks create and warns when over the request cap', async () => {
    render(<ReportsView />);
    const ids = Array.from({ length: MAX_REPORT_REQUESTS + 1 }, (_, i) => 'id' + i).join('\n');
    fireEvent.change(screen.getByLabelText(/request ids/i), { target: { value: ids } });
    const btn = screen.getByRole('button', { name: /create/i });
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/at most 100/i)).toBeTruthy();
  });

  it('re-downloads from history', async () => {
    render(<ReportsView />);
    await waitFor(() => screen.getByText('neuralwatt'));
    fireEvent.click(screen.getByRole('button', { name: /download/i }));
    expect(downloadReport).toHaveBeenCalledWith('r1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/frontend/ReportsView.test.jsx`
Expected: FAIL — module `ReportsView.jsx` not found.

- [ ] **Step 3: Write the component**

Create `src/components/ReportsView.jsx`:

```jsx
import React, { useState, useEffect, useMemo } from 'react';
import { reportsApi, downloadReport } from '../lib/api.js';
import { MAX_REPORT_REQUESTS, MAX_NOTES_CHARS } from '../../services/providerReport.js';

function parseIds(text) {
  return text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

function formatBytes(b) {
  return b ? `${(b / 1024).toFixed(1)} KB` : '-';
}

const IDS_TIP = 'One request ID per line (or comma-separated). Up to '
  + MAX_REPORT_REQUESTS + ' requests per report — split larger incidents. '
  + 'Each request adds its full raw SSE stream to the ZIP.';
const NOTES_TIP = 'Shown as the Summary section at the top of report.md — what went '
  + 'wrong and what you want the provider to check. Plain markdown, up to '
  + MAX_NOTES_CHARS + ' characters.';

export default function ReportsView() {
  const [idsText, setIdsText] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let ignore = false;
    reportsApi.history().then((r) => { if (!ignore) setRows(r.data || []); }).catch(() => {});
    return () => { ignore = true; };
  }, []);

  const ids = useMemo(() => parseIds(idsText), [idsText]);
  const tooMany = ids.length > MAX_REPORT_REQUESTS;
  const canCreate = ids.length > 0 && !tooMany && !busy;

  async function create() {
    if (!canCreate) return;
    setBusy(true); setError(null);
    try {
      const res = await reportsApi.create(ids, notes);
      await downloadReport(res.reportId);
      const list = await reportsApi.history();
      setRows(list.data || []);
      setIdsText(''); setNotes('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-bold mb-3">Create Provider Report</h2>
        <label className="block text-sm font-medium mb-1" htmlFor="report-ids">Request IDs</label>
        <textarea
          id="report-ids" rows={5} title={IDS_TIP}
          className="border rounded px-2 py-1 w-full font-mono text-xs"
          placeholder={'e9e55488-...\n6024fec2-...'}
          value={idsText} onChange={(e) => setIdsText(e.target.value)}
        />
        <div className="text-xs text-slate-500 mb-2">
          {ids.length} request(s)
          {tooMany && <span className="text-red-600"> · at most {MAX_REPORT_REQUESTS} allowed — remove some or split into another report</span>}
        </div>

        <label className="block text-sm font-medium mb-1" htmlFor="report-notes">Summary notes</label>
        <textarea
          id="report-notes" rows={4} title={NOTES_TIP} maxLength={MAX_NOTES_CHARS}
          className="border rounded px-2 py-1 w-full"
          placeholder="Describe the problem for the provider…"
          value={notes} onChange={(e) => setNotes(e.target.value)}
        />
        <div className="text-xs text-slate-500 mt-1">{notes.length} / {MAX_NOTES_CHARS}</div>

        {error && <div role="alert" className="bg-red-100 text-red-800 p-2 rounded text-sm my-2">{error}</div>}

        <div className="mt-3 flex gap-2">
          <button
            className="bg-slate-900 text-white px-3 py-1 rounded text-sm hover:bg-slate-800 disabled:opacity-50"
            disabled={!canCreate} onClick={create} title={tooMany ? `At most ${MAX_REPORT_REQUESTS} requests` : 'Build evidence ZIP'}
          >
            {busy ? 'Creating…' : 'Create Report'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-bold mb-3">Report History</h2>
        {rows.length === 0 && <div className="text-slate-500">No reports yet.</div>}
        <table className="w-full text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-3 py-2 text-left">Provider</th>
              <th className="px-3 py-2 text-left">Requests</th>
              <th className="px-3 py-2 text-left">Size</th>
              <th className="px-3 py-2 text-left">Created</th>
              <th className="px-3 py-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2">{row.provider || 'mixed'}</td>
                <td className="px-3 py-2">{row.request_ids?.length || 0}</td>
                <td className="px-3 py-2">{formatBytes(row.file_size)}</td>
                <td className="px-3 py-2">{new Date(row.created_at).toLocaleString()}</td>
                <td className="px-3 py-2">
                  <button className="text-blue-600 hover:underline" onClick={() => downloadReport(row.id)}>Download</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add Reports nav to src/App.jsx**

Add import: `import ReportsView from './components/ReportsView.jsx';`
Add a nav button after the Export History button:
```jsx
        <button
          className={`px-3 py-1 rounded ${view === 'reports' ? 'bg-slate-700' : 'hover:bg-slate-800'}`}
          onClick={() => setView('reports')}
        >
          Reports
        </button>
```
Add the view render after the history line:
```jsx
        {view === 'reports' && <ReportsView />}
```

- [ ] **Step 5: Run test + build to verify it passes**

Run: `npx vitest run tests/frontend/ReportsView.test.jsx && npm run build 2>&1 | tail -3`
Expected: PASS (4 tests) and `✓ built`.

- [ ] **Step 6: Commit**

```bash
git add src/components/ReportsView.jsx src/App.jsx tests/frontend/ReportsView.test.jsx
git commit -m "feat: Reports view with capped inputs + tooltips, wired into nav"
```

---

## Task 8: Dashboard "Provider Report" button

**Files:**
- Modify: `src/components/Dashboard.jsx`
- Test: `tests/frontend/DashboardReportButton.test.jsx`

The Dashboard already tracks `selected` (a Set). Add a button beside Export that opens a minimal inline notes modal (overlay div, same pattern as `ExportModal`'s fixed container) and POSTs the selection. `window.prompt` is deliberately not used — it can't enforce the notes cap or show a counter.

- [ ] **Step 1: Write the failing test**

Create `tests/frontend/DashboardReportButton.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Dashboard from '../../src/components/Dashboard.jsx';

// Dashboard's data surface is the useRequests hook + FilterPanel's filtersApi.
vi.mock('../../src/hooks/useRequests.js', () => ({
  useRequests: () => ({
    rows: [{ request_id: 'a', provider: 'neuralwatt' }, { request_id: 'b', provider: 'gmi' }],
    loading: false, error: null, loadMore: () => {}, hasMore: false,
  }),
}));
vi.mock('../../src/lib/api.js', () => ({
  filtersApi: { list: () => Promise.resolve({ providers: [], models: [], apiKeys: [], finishReasons: [] }) },
}));

describe('Dashboard provider-report button', () => {
  it('exists, is disabled with no selection, enabled after select-all', () => {
    render(<Dashboard />);
    const btn = screen.getByRole('button', { name: /provider report/i });
    expect(btn.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Select all rows'));
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain('2');
  });

  it('opening the modal shows a notes field with the 4000-char counter', () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByLabelText('Select all rows'));
    fireEvent.click(screen.getByRole('button', { name: /provider report/i }));
    expect(screen.getByLabelText(/summary notes/i)).toBeTruthy();
    expect(screen.getByText(/^0 \/ 4000$/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/frontend/DashboardReportButton.test.jsx`
Expected: FAIL — no button named "provider report".

- [ ] **Step 3: Implement the button + notes modal in Dashboard**

In `src/components/Dashboard.jsx`, add imports near the top:
```js
import { reportsApi, downloadReport } from "../lib/api.js";
import { MAX_REPORT_REQUESTS, MAX_NOTES_CHARS } from "../../services/providerReport.js";
```
Add state alongside the others:
```js
const [showReport, setShowReport] = useState(false);
const [reportNotes, setReportNotes] = useState("");
const [reportBusy, setReportBusy] = useState(false);
const [reportError, setReportError] = useState(null);
```
Add a handler after `onSelectAll`:
```js
const overCap = selected.size > MAX_REPORT_REQUESTS;

async function createReport() {
  setReportBusy(true); setReportError(null);
  try {
    const res = await reportsApi.create(Array.from(selected), reportNotes);
    await downloadReport(res.reportId);
    setShowReport(false); setReportNotes("");
  } catch (err) {
    setReportError(err.message);
  } finally {
    setReportBusy(false);
  }
}
```
In the button row (inside the `flex gap-2` div next to Export), add:
```jsx
<button
  className="bg-indigo-700 text-white px-3 py-1 rounded text-sm hover:bg-indigo-800 disabled:opacity-50"
  disabled={selected.size === 0 || overCap}
  onClick={() => { setShowReport(true); setReportError(null); }}
  title={overCap ? `Select at most ${MAX_REPORT_REQUESTS} requests` : `Build a provider evidence report from ${selected.size} selected request(s)`}
>
  Provider report ({selected.size})
</button>
```
After the `{showExport && ...}` modal block, add the notes modal:
```jsx
{showReport && (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
    <div className="bg-white rounded-lg shadow p-4 w-[520px] max-w-[92vw]">
      <h3 className="font-bold mb-2">Provider report — {selected.size} request(s)</h3>
      <label className="block text-sm font-medium mb-1" htmlFor="dash-report-notes">
        Summary notes
      </label>
      <textarea
        id="dash-report-notes" rows={5} maxLength={MAX_NOTES_CHARS}
        className="border rounded px-2 py-1 w-full"
        placeholder="What went wrong; what you want the provider to check."
        value={reportNotes} onChange={(e) => setReportNotes(e.target.value)}
      />
      <div className="text-xs text-slate-500 mt-1">{reportNotes.length} / {MAX_NOTES_CHARS}</div>
      {reportError && <div role="alert" className="bg-red-100 text-red-800 p-2 rounded text-sm mt-2">{reportError}</div>}
      <div className="flex justify-end gap-2 mt-3">
        <button className="px-3 py-1 rounded border text-sm" onClick={() => setShowReport(false)}>Cancel</button>
        <button
          className="bg-indigo-700 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
          disabled={reportBusy || selected.size === 0 || selected.size > MAX_REPORT_REQUESTS}
          onClick={createReport}
        >
          {reportBusy ? "Creating…" : "Create & Download"}
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Run test + full suite + build**

Run: `npx vitest run 2>&1 | tail -6 && npm run build 2>&1 | tail -3`
Expected: all tests PASS, `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add src/components/Dashboard.jsx tests/frontend/DashboardReportButton.test.jsx
git commit -m "feat: Dashboard provider-report button with notes modal + cap"
```

---

## Task 9: Deploy to AI01 + live verification

**Files:** none (operational)

- [ ] **Step 1: Push to GitHub**

```bash
git push
```

- [ ] **Step 2: Pull + rebuild on AI01**

```bash
ssh ai01 'cd ~/plexus-debug-ui && git pull'
ssh ai01 'cd ~/plexus-debug-ui && sudo -n env PATH="/usr/local/bin:$PATH" podman-compose -f podman-compose.ai01.yml up -d --build --force-recreate 2>&1 | tail -6'
```

- [ ] **Step 3: Confirm new code is live in the container (staleness gotcha)**

```bash
ssh ai01 'sudo -n podman exec plexus-debug-ui sh -c "ls routes/reports.js services/providerReport.js && md5sum dist/assets/*.js"'
```
Expected: files listed; the `dist/assets/*.js` hash matches the local `md5sum dist/assets/*.js` (proves the fresh bundle shipped, not a stale one).

- [ ] **Step 4: Confirm migration created the table**

```bash
ssh ai01 'sudo -n podman exec plexus-debug-ui-db psql -U app -d debug_ui -c "\dt provider_reports"'
```
Expected: the `provider_reports` table listed (confirms `node db/migrate.js` ran on startup).

- [ ] **Step 5: Live end-to-end report for the neuralwatt incident**

```bash
ssh ai01 'curl -s -m 90 -X POST -H "Authorization: Bearer plexus_admin_key_2024" -H "content-type: application/json" \
  -d "{\"requestIds\":[\"e9e55488-4043-4e35-8550-a40bbda0bf9e\",\"6024fec2-b073-4927-bf4f-3a12740eb17f\"],\"notes\":\"neuralwatt deepseek-v4-pro returned ~100k tokens of tokenizer garbage on 3 requests, HTTP 200 finish_reason stop.\"}" \
  http://localhost:4003/api/reports'
```
Expected: JSON `{"reportId":"…","downloadUrl":"/api/reports/…","fileSize":N>0}`.

Then download and sanity-check:
```bash
ssh ai01 'id=<reportId from above>; curl -s -H "Authorization: Bearer plexus_admin_key_2024" "http://localhost:4003/api/reports/$id" -o /tmp/rep.zip && unzip -l /tmp/rep.zip && unzip -p /tmp/rep.zip report.md | head -40'
```
Expected: `report.md` + two `raw/…_response.sse` entries; the md summary + a "Request 1" section naming neuralwatt / deepseek-v4-pro.

- [ ] **Step 6: Report done**

Provide the on-disk ZIP path (or `scp` it down) so the user can attach it to the neuralwatt ticket.

---

## Notes / risks

- `config.exportsDir` must be writable in the container — it already is (the ZIP export feature writes there), so reports reuse the same volume.
- The two historical incident requests have `raw_request = null` in plexus, so their report will correctly show the "not stored / match on id" marker. New incidents where plexus does store the request will include `raw/<id>_request.json` automatically.
- Frontend tests import from `../../services/providerReport.js`; Vite bundles server+client ESM fine (verified `analyzeResponse`/`buildReportDoc` are dependency-free), so no server code (fs/pg) leaks into the browser.
- If a future change adds imports of fs/pg into `providerReport.js`, it would break the frontend build — keep it pure.
