# Plexus Debug UI

A containerized web application for inspecting and exporting debug bundles from Plexus request logs. Connects to the Plexus management API and provides a web UI to filter, inspect, and export debug data.

## Features

- **Live request filtering** — filter requests by provider, model, API key, status, date range, error presence, retries, and finish reason
- **Keyword search** — free-text search across request ID, provider, model, API key, and finish reason fields
- **Searchable dropdowns** — keyword-searchable selects populated with live distinct values from the Plexus API
- **Context size and tools** — columns showing token context (`input → output`) and tool call counts (`calls/defined`)
- **Retry detection** — amber-highlighted rows for retried requests with attempt count badges; filter by retry status
- **Bad finish reasons** — red-highlighted rows for `error`, `length`, `max_tokens` finish reasons
- **Request inspection** — click any row to open a detail drawer with tabs: Summary, Retries, Raw Request, Raw Response, Errors, Annotations
- **Retry chain visualization** — the Retries tab shows each attempt's provider, model, status code, reason, and whether it was retryable
- **Debug bundle export** — select multiple requests and generate a ZIP bundle with metadata, raw payloads, and an HTML overview report
- **Annotations** — tag and note requests for later reference
- **Export history** — track previously generated bundles

## Architecture

```
Browser (React + Vite)  ←→  Node.js/Express Backend  ←→  Plexus Management API (x-admin-key)
                              ↓
                         Local PostgreSQL (annotations, export history)
```

## Tech Stack

- **Backend:** Node.js 20, Express 4, Plexus Management API client, `archiver` for ZIP streaming
- **Frontend:** React 18, Vite 5, Tailwind CSS 3
- **Database:** PostgreSQL 16 (local DB for annotations and export history)
- **Auth:** Admin key from mounted `plexus.yaml` (passed as `x-admin-key` to Plexus API). `PLEXUS_API_ADMIN_KEY` can override it when the key used to log into this UI differs from the Plexus management key.

## Quick Start

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env:
#   PLEXUS_API_URL=http://host.docker.internal:4000
#   APP_DB_PASSWORD=your_app_db_password
#   PLEXUS_CONFIG_PATH=/path/to/plexus.yaml
#   PLEXUS_API_ADMIN_KEY=   # optional: only if the Plexus management key differs from the UI admin key
```

### 2. Ensure Plexus config is available

Create or point to a `plexus.yaml` with an `adminKey`:

```yaml
adminKey: your-secure-admin-key-here
```

### 3. Run with Docker

```bash
docker compose up -d
```

The app will be available at `http://localhost:4002`.

### 4. First login

The UI will prompt for the admin key from `plexus.yaml`. It is stored in `localStorage` for subsequent requests.

## Plexus API Integration

The debug UI uses the Plexus management API instead of direct database queries. This ensures schema migrations in Plexus never break the debug UI.

| Debug UI Feature | Plexus API Endpoint | Auth |
|---|---|---|
| Request list + filters | `GET /v0/management/usage` | `x-admin-key` |
| Debug details (raw payloads) | `GET /v0/management/debug/logs/:requestId` | `x-admin-key` |
| Error records | `GET /v0/management/errors` | `x-admin-key` |
| Provider performance | `GET /v0/management/performance` | `x-admin-key` |

The Plexus API returns camelCase field names (`requestId`, `toolCallsCount`, etc.). The `plexusApi.js` client normalizes these to snake_case for frontend compatibility.

### Management API quirks (worked around in code)

Discovered against Plexus v1.x management routes:

- **No single-usage endpoint.** `GET /v0/management/usage/:id` does not exist. To resolve one request's usage row, use the list endpoint with the exact-match filter: `GET /v0/management/usage?requestId=<id>&limit=1`.
- **`/v0/management/errors` silently ignores `?requestId=`.** It only supports `limit`/`offset` and returns the global latest-N errors. `plexusApi.listErrors(requestId)` fetches the recent 500-error window and filters client-side, so errors that aged out of the window are unavailable.
- **Debug payloads are large.** A single `GET /v0/management/debug/logs/:requestId` response can be 1.5+ MB (a full LLM `rawRequest`); code handling it must tolerate large strings.
- **Summary/Retries in the drawer come from the usage row the user clicked**, not from a detail fetch, because of the missing single-usage endpoint.

### Client-side filtering

Some filters that the Plexus API does not support natively are applied client-side after fetching:

| Filter | Implementation |
|---|---|
| `hasError` | Post-filter on `has_error` boolean field |
| `hasRetry` | Post-filter on `attempt_count > 1` |
| `search` | Free-text search across request_id, provider, model, api_key, finish_reason |

## UI Views

### Dashboard

The main view with a search bar, filter panel, and paginated request table.

**Table columns:** Request ID, Provider, Model, API Key, Status, Context (tokens in → out), Tools (calls/defined), Finish Reason, Duration, Time

**Row highlights:**

- Amber background — request was retried (attempt count badge shown)
- Red background — bad finish reason (`error`, `length`, `max_tokens`)
- Blue finish badge — tool call finish (`tool_calls`, `tool_use`)
- Red finish badge — error/overflow finish (`error`, `length`, `max_tokens`)

### Detail Drawer

Slide-out panel opened by clicking a request row. The header has an **Export** button that immediately downloads a ZIP debug bundle for exactly this request — the fastest path to sharing one broken request. Tabs:

| Tab | Content |
|-----|---------|
| Summary | Provider, model, tokens, duration, attempt count, finish reason, tools, message count |
| Retries | Full retry chain — each attempt's provider, model, status, status code, reason, retryable flag |
| Raw Request | Pretty-printed raw request JSON |
| Raw Response | Pretty-printed raw response JSON |
| Errors | Error message, stack trace, and details from `inference_errors` |
| Annotations | Tags and notes (stored in local DB) |

### Export

Select rows via checkboxes, then click "Export N selected" to generate a ZIP bundle. Export history tracks all past bundles with re-download links.

## Database Schema (Local)

The app creates these tables on startup via `db/migrate.js`:

- `debug_sessions` — named filter sessions
- `request_annotations` — tags and notes per request
- `export_history` — generated ZIP bundles
- `parsed_tool_calls` — extracted tool call summaries

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/health` | Health check (Plexus API + local DB) |
| GET | `/api/filters` | Distinct provider/model/apiKey/finishReason values |
| GET | `/api/requests` | Filterable, paginated request list |
| GET | `/api/debug/:requestId` | Full debug view (usage + debug logs + errors + performance) |
| POST | `/api/export` | Generate ZIP bundle from request IDs |
| GET | `/api/export/:exportId` | Download bundle |
| GET | `/api/export` | Export history list |
| GET/POST | `/api/annotations` | CRUD annotations |

## ZIP Bundle Format

```
plexus-debug-{timestamp}.zip
├── manifest.json          # Metadata: export date, request count, hasError per request, warnings
├── report.html            # Overview with provider breakdown, error stats
├── requests/{id}.json     # Self-contained full record: usage fields, toolCalls, errors.
│                          # Used for single-request debugging exports.
├── raw/{id}_request.json  # Raw request payload (split out; can be MB-sized)
├── raw/{id}_response.json # Raw response payload
└── errors/{id}_error.json # All errors attributed to that request (only when present)
```

All payload files for one request share its `request_id` in the filename; there is no cross-request mixing.

## Security Notes

- All Plexus data is fetched read-only via the management API — no direct DB access
- Admin key is the only auth mechanism (`Authorization: Bearer <key>` for debug UI, `x-admin-key` for Plexus API)
- `plexus.yaml` is mounted read-only and never served to the frontend
- ZIP files are stored on disk; export history tracks them but requires auth to download
- Auth comparison uses HMAC-SHA256 with `crypto.timingSafeEqual` to prevent timing attacks

## Development

```bash
npm install
npm run dev      # Vite dev server (frontend + API proxy)
npm test         # Vitest (backend + frontend unit tests)
```

## Deployment

The included `docker-compose.yml` is configured for local/development use. A `docker-compose.test.yml` is included for running a test instance on a separate port. `podman-compose.ai01.yml` is the (rootful) Podman override used on the AI01 host: it points `PLEXUS_API_URL` at the host-published Plexus port, reads the admin key from the live `plexus.yaml` (`ADMIN_KEY_FILE`), and publishes on `${PORT}`.

> **Podman gotcha:** `podman-compose up -d --build` rebuilds the image but may keep running the *old* container with stale code. Always deploy with `up -d --build --force-recreate` and verify the file contents inside the container (`podman exec plexus-debug-ui sh -c 'head routes/debug.js'`) if behavior doesn't change.

For production:

1. Use strong passwords (set via `.env`)
2. Restrict network access to the Plexus API
3. Run behind a reverse proxy with TLS
4. Set `PLEXUS_CONFIG_PATH` to the absolute path of your `plexus.yaml`

## Changelog

### v0.2.1 — Detail Drawer & Export Fixes

- Fixed detail drawer showing empty tabs on every request: the debug route called `plexusApi.getUsage()`, which does not exist (and the management API has no single-usage endpoint), producing a 500 for `/api/debug/:requestId`
- Summary/Retries tabs now use the clicked usage row (passed from the table) instead of re-fetching
- Fixed exports silently dropping almost every selected request: the export looked each request up in a `limit=1` list page, matching only the single most recent row; it now filters by `requestId`
- Fixed Errors tab/export showing the global latest 50 errors for every request: `/v0/management/errors` ignores `?requestId=`, now filtered client-side over a recent 500-error window
- Fixed errors never being written into ZIP bundles at all (`error_message` fields vs `req.error` mismatch) and `manifest.hasError` always being false
- Per-request Export button in the detail drawer for one-click single-request debug bundles
- ZIP `requests/{id}.json` is now a self-contained record (full usage row, tool calls, errors)
- Switching rows no longer flashes the previous request's raw payload (stale state cleared on id change)
- New optional `PLEXUS_API_ADMIN_KEY` env var when the Plexus management key differs from the UI admin key
- Documented management API quirks and the `podman-compose --force-recreate` deployment gotcha

### v0.2.0 — API Integration + Search + Retry Detection

- Replaced direct PostgreSQL queries with Plexus management API (`/v0/management/*`)
- Added `PLEXUS_API_URL` config (replaces `PLEXUS_DATABASE_URL`)
- Added free-text keyword search across request fields
- Added context size column (tokens in → out) and tools column (calls/defined)
- Added retry detection: amber highlights, attempt count badges, "Retried" filter
- Added finish reason filter and color-coded finish reason column
- Added Retries tab in detail drawer showing full retry chain
- Added `docker-compose.test.yml` for test deployments
- Field normalization: Plexus API camelCase → snake_case for frontend

### v0.1.0 — Initial Release

- Dashboard with filterable, paginated request table
- Searchable dropdown filters for provider, model, API key
- Detail drawer with raw request/response, errors, annotations
- ZIP debug bundle export with manifest and HTML report
- Export history with re-download
- Annotations (tags and notes)
- Health check endpoint
- Docker/Podman deployment

## License

MIT

## ☁️ Cloud Credits

Power your AI projects with [Ozore.com](https://ozore.com/?ref=cwe4kdx0) — use code **lundrog50** for 50% off your first month.

> `direct-pin` and `custom-router` are available on **Pro** and **Max** plans only.

## ☕ Support

If this project helped you, consider buying me a coffee:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-TheArchitectit-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/TheArchitectit)
