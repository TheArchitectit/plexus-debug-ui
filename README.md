# Plexus Debug UI

A containerized web application for inspecting and exporting debug bundles from Plexus request logs. Connects read-only to a Plexus PostgreSQL database and provides a web UI to filter, inspect, and export debug data.

## Features

- **Live database filtering** — filter requests by provider, model, API key, status, date range, error presence, retries, and finish reason
- **Searchable dropdowns** — keyword-searchable selects populated with live distinct values from the database
- **Request inspection** — click any row to open a detail drawer with raw request/response payloads, error details, retry chains, and annotations
- **Debug bundle export** — select multiple requests and generate a ZIP bundle with metadata, raw payloads, and an HTML overview report
- **Retry chain visualization** — the Retries tab shows each attempt's provider, model, status, and whether it was retryable
- **Annotations** — tag and note requests for later reference
- **Export history** — track previously generated bundles

## Architecture

```
Browser (React + Vite)  ←→  Node.js/Express Backend  ←→  Plexus PostgreSQL (read-only)
                              ↓
                         Local PostgreSQL (annotations, export history)
```

## Tech Stack

- **Backend:** Node.js 20, Express 4, node-postgres (`pg`), `archiver` for ZIP streaming
- **Frontend:** React 18, Vite 5, Tailwind CSS 3
- **Database:** PostgreSQL 16 (Plexus DB read-only, local DB read-write)
- **Auth:** Single admin key from mounted `plexus.yaml` file

## Quick Start

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env:
#   PLEXUS_DATABASE_URL=postgresql://plexus:PASSWORD@host.docker.internal:5435/plexus
#   APP_DB_PASSWORD=your_app_db_password
#   PLEXUS_CONFIG_PATH=/path/to/plexus.yaml
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

## Database Schema (Local)

The app creates these tables on startup via `db/migrate.js`:

- `debug_sessions` — named filter sessions
- `request_annotations` — tags and notes per request
- `export_history` — generated ZIP bundles
- `parsed_tool_calls` — extracted tool call summaries

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/health` | Health check (both DB pools) |
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
├── manifest.json          # Metadata: export date, filter snapshot, request count
├── report.html            # Overview with provider breakdown, error stats
├── requests/{id}.json     # Parsed summaries
├── raw/{id}_request.json  # Raw request payload
├── raw/{id}_response.json # Raw response payload
└── errors/{id}_error.json # Error details
```

## Security Notes

- Plexus DB connection is read-only — no write routes touch it
- Admin key is the only auth mechanism (`Authorization: Bearer <key>`)
- `plexus.yaml` is mounted read-only and never served to the frontend
- ZIP files are stored on disk; export history tracks them but requires auth to download

## Development

```bash
npm install
npm run dev      # Vite dev server (frontend + API proxy)
npm test         # Vitest (backend + frontend unit tests)
```

## Deployment

The included `docker-compose.yml` is configured for local/development use. For production:

1. Use strong passwords (set via `.env`)
2. Restrict network access to the Plexus database
3. Run behind a reverse proxy with TLS
4. Set `PLEXUS_CONFIG_PATH` to the absolute path of your `plexus.yaml`

## License

MIT
