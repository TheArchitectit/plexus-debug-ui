# Provider Report — Design

**Date:** 2026-08-27
**Status:** Approved (design agreed in session)

## Problem

When an upstream provider serves broken output (e.g. the 2026-08-27 neuralwatt /
`deepseek-v4-pro` incident where the model emitted ~100k tokens of tokenizer
garbage while returning HTTP 200 + `finish_reason: stop`), we need to send that
provider an **evidence packet**: the exact request/response payloads, model
self-reported names, timestamps, and response ids they can match against their
own logs. Today the only artifact is the debug ZIP bundle, which is structured
for *us* (manifest, per-request JSON, HTML overview) not for a ticket/email to
a provider.

The provider report must be:
- downloadable from the UI on demand, and
- re-generatable / re-downloadable later (a history, like Export History).

## Goals

1. Select N requests → produce **one** ZIP evidence packet for the provider(s).
2. Each packet contains a human-readable `report.md` (provider-facing) plus the
   raw SSE streams, byte-exact, so a provider can inspect what they actually
   sent.
3. Free-text notes entered at create-time become the report intro (the "here's
   what went wrong" you'd paste into the email).
4. Reports are listed in a **Reports** view and re-downloadable, like exports.
5. Robust to plexus not storing every field: for these incidents plexus stored
   `raw_request = null` and only kept the response stream. Missing pieces are
   stated explicitly in the report, never silently dropped, so the provider can
   match on request-id / `chatcmpl` response id / timestamp.

## Non-goals (YAGNI)

- Per-provider templates / branding.
- Automatic "degenerate output" detection in the report (noted as a possible
  future feature, out of scope here).
- Redaction/secret-scrubbing of payloads.
- Sending the report anywhere automatically (email/Discord) — we only produce a
  downloadable file.
- Streaming/progress UI for large batches (batch is human-scale, seconds).

## Architecture

Follows the existing **export** path exactly (new service + route + DB table + a
view in `App.jsx`). No new frameworks. Reuse `zipExporter`'s ZIP writing and the
`exportsDir`/`requireAuth` conventions.

```
Dashboard rows (selected)   Reports view create-form (pasted request IDs)
             \                     /
              \                   /
               POST /api/reports  { requestIds[], notes }
                       |
              routes/reports.js
                       |
        for each id: plexusApi.listUsage({requestId,limit:1})   (metadata)
                     plexusApi.getDebugLog(id)                   (payloads)
                       |
              services/providerReport.js   (pure: build report.md + raw files)
                       |
              services/zipExporter (existing ZIP writer, reused)
                       |
                 provider_reports  DB row -> {id, file_path, ...}
                       |
                 201 { reportId, downloadUrl }
                       |
        GET /api/reports/:id  -> res.download(file_path)  (guarded to exportsDir)
        GET /api/reports      -> history list (last 50)
```

### Components

**`services/providerReport.js`** (new, pure, fully unit-testable)
- `buildReportDoc(requests, notes)` → markdown string. `requests` is an array of
  assembled objects `{ usage, debug, analysis }`.
- `analyzeResponse(debug)` → `{ model, responseId, created, chunks, finishReason,
  assistantText, reasoningText, toolCalls, rawSse, hasRequest }`. Reassembles an
  OpenAI SSE stream (`delta.content` + `delta.reasoning`/`reasoning_content`) or
  an Anthropic snapshot (`content[].text` / `content[].thinking`). This mirrors
  the logic already proven in `toolParser.js` for SSE reassembly.
- `rawFilesForRequest(request)` → `{ "raw/<id>_response.sse": fullStream,
  "raw/<id>_request.json": requestJson }` (request omitted when plexus stored
  none).

**`routes/reports.js`** (new)
- `router.use(requireAuth)` like the other API routers.
- `POST /` `{ requestIds, notes }` → fetch usage+debug per id (best-effort,
  matching export.js's `.catch(()=>null)` pattern), build doc + raw files, write
  ZIP via `createDebugBundle`-style helper (new `createProviderReportBundle` in
  zipExporter.js, or a small local writer — see "ZIP writing" below), insert DB
  row, respond `{ reportId, downloadUrl, fileSize }`.
- `GET /:id` → download, path-guarded to `config.exportsDir` (same anti-traversal
  check as export.js:104-108).
- `GET /` → history (last 50), join nothing needed (own table).
- Validation: reject non-array / empty `requestIds` (400), cap at 100 like
  exports (matching the client-side cap on the IDs field, below); if **zero**
  ids resolve to any usage row → 400 "no matching requests". `notes` capped at
  4000 chars server-side (matches the textarea `maxLength`).

**`db/migrate.js`** — add:
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
CREATE INDEX IF NOT EXISTS idx_provider_reports_created_at
    ON provider_reports(created_at);
```
`migrate.js` uses `CREATE TABLE IF NOT EXISTS`, so re-running on AI01 is safe and
idempotent (the deploy command already runs it).

**Frontend**
- `src/lib/api.js`: add `reportsApi = { create, download(url), list }`.
- `src/components/ReportsView.jsx` (new): create form (request-ID textarea +
  notes textarea + Create button → triggers download on success) and a history
  table (provider, #requests, created, download link). Mirrors `ExportHistory.jsx`.
- **Input caps with guidance tooltips (client-enforced, server re-validates):**
  shared constants `MAX_REPORT_REQUESTS = 100`, `MAX_NOTES_CHARS = 4000`,
  exported from `services/providerReport.js` and imported by both the frontend
  and `routes/reports.js` (single source of truth).
  - Request-IDs textarea: accepts newline/comma/space-separated ids; counts
    ids client-side, blocks Create and shows an inline hint when over
    `MAX_REPORT_REQUESTS`. `title` tooltip:
    "One request ID per line (or comma-separated). Up to 100 requests per
    report — split larger incidents into multiple reports. Each request adds
    its full raw SSE stream to the ZIP."
  - Notes textarea: `maxLength={MAX_NOTES_CHARS}`, live `n / 4000` counter
    below the field. `title` tooltip:
    "Shown as the Summary section at the top of report.md — what went wrong,
    what you're asking the provider to check. Plain markdown, up to 4000
    characters."
  - Dashboard "Provider Report" button: notes prompt enforces the same 4000
    cap and refuses when selection exceeds 100 rows (button disabled with
    tooltip "Select at most 100 requests").
- `src/App.jsx`: add a `Reports` nav button + `{view === 'reports' && <ReportsView/>}`.
- `src/components/Dashboard.jsx`: add a "Provider Report" button next to the
  existing Export button that opens a small prompt for notes, then POSTs the
  current selection to `/api/reports` and downloads the result. (Reuses selected
  rows already tracked there.)

Single source of truth: `services/providerReport.js` is dependency-free (pure
functions), so both `routes/reports.js` (server) and the frontend components
import `MAX_REPORT_REQUESTS` / `MAX_NOTES_CHARS` from it directly (Vite bundles
it fine). `src/lib/reportLimits.js` is dropped — no duplicated literals to drift.

### report.md layout

```
# Provider Debug Report
Generated <ISO> · <N> requests · Provider(s): <distinct usage.provider>

## Summary
<notes, verbatim, markdown>

## Requests
| # | request_id | time | requested → served model | provider | tokens in/out | finish | response id |
|---|-----------|------|--------------------------|----------|---------------|--------|-------------|
...(one row per request from usage)

## Request <n>: <request_id>
- Time / alias / canonical / selected / provider / status / finish_reason
- Tokens in/out, duration, streamed
- Response id (chatcmpl…), model self-reported in stream
- Assistant output: <len> chars (~<est> tokens)
- Reasoning output: <len> chars (~<est> tokens)     [if present]

### Assistant text
```
<full or truncated-to-100k assistant text>
```
### Reasoning
```
<...>
```
### Raw SSE — first 500 lines
```
<...>
```
(full stream in raw/<id>_response.sse)
```

For a request where plexus stored no response payload (e.g. debug not captured),
emit `> Response payload not stored for this request — match on request_id and
timestamp above.` in its section, keep the metadata rows, and continue. This is a
first-class case, not an error.

### ZIP writing

`zipExporter.js` already depends on `archiver` and writes a bundle. Add a focused
`createProviderReportBundle({ reportMd, rawFiles }, outPath)` export alongside the
existing `createDebugBundle` — it just writes `report.md` + each entry in
`rawFiles`. Keeps ZIP concerns in one module; providerReport.js stays pure
(strings + object maps) and testable without touching the filesystem/archiver.

### Filename

`provider-report-<provider-slug>-<yyyymmdd-HHMMSS>.zip` in `config.exportsDir`.
`<provider-slug>` from the first resolvable usage row's provider, lowercased and
non-alphanumerics collapsed to `-` (fallback `mixed`). The `Date` used is the
server's — this is server code, not a workflow sandbox, so `Date.now()` is fine.

### Error handling

- Per-id fetch failures (network/404) are caught → that id contributes a
  metadata-only / not-stored section, never aborts the whole report.
- All ids unresolvable → 400, nothing written.
- Disk/archiver error → 500 via asyncHandler; no DB row inserted (insert only
  after successful write).
- Download of a missing/gone file → 404 (same as export.js).
- Path traversal on download → guarded to `exportsDir`.

## Testing (TDD — red first for each)

1. **providerReport.analyzeResponse** — fixtures: OpenAI SSE with
   `delta.content`, SSE with `delta.reasoning` + `content`, Anthropic snapshot
   object, SSE string that also needs snapshot fallback, and a null-debug
   (not-stored) case. Assert model, responseId, finishReason, assistantText,
   reasoningText, chunkCount, hasRequest.
2. **providerReport.buildReportDoc** — given assembled requests + notes:
   contains the notes verbatim, one summary-table row per request, a section per
   request, the "not stored" marker for the missing case, and truncates assistant
   text over the limit. Assert on substring / structural markers, not exact bytes.
3. **routes/reports** (vitest, mock `plexusApi`, real tmp `exportsDir` like
   zipExporter.test.js) — POST creates a ZIP + DB row and returns a downloadUrl;
   GET `/:id` serves it; GET `/` lists; zero-resolvable ids → 400; empty
   requestIds → 400. The DB uses the app Postgres; to keep backend tests hermetic
   and match the existing suite (which does not spin up pg), the route tests mock
   `queryApp` from `db/app.js` and only assert the ZIP is produced with the right
   entries + the insert is called with the expected args. Also: >100 ids → 400,
   oversized notes → 400.
4. **zipExporter.createProviderReportBundle** — writes the given entries; unzip
   and assert `report.md` and `raw/*` present (extend the existing unzipper test
   file).

Frontend components (ReportsView, Dashboard button) follow the existing repo's
light-touch frontend testing (only FilterPanel is tested today); they will be
verified by the build + a manual click-through, consistent with how Export
History is currently validated.

## Deploy

- `git commit` + `git push` to GitHub.
- On AI01: `cd ~/plexus-debug-ui && git pull`, then
  `sudo -n podman-compose -f podman-compose.ai01.yml up -d --build --force-recreate`
  (the container `command` runs `node db/migrate.js && node server.js`, so the new
  table is created on restart). Verify inside the container that `routes/reports.js`
  and the new `dist` bundle are present (README podman-staleness gotcha).

## Open questions for implementer

None blocking. (Whether to auto-flag degenerate output is a follow-up, deferred.)
