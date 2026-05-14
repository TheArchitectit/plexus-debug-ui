# Plexus Debug UI — Design Specification

## Overview

A containerized web application running on AI01 that connects to the Plexus PostgreSQL database for read-only live querying and provides a web UI to filter, inspect, and export debug bundles from Plexus request logs.

The app maintains its own PostgreSQL database to track extended debug metadata that Plexus does not capture: annotations, export history, parsed tool calls, and debug sessions.

## Goals

- Filter Plexus requests by provider, model, API key, date range, status, and error presence
- Inspect raw request/response payloads, errors, and provider performance per request
- Export selected requests as ZIP debug bundles containing metadata, raw payloads, and an HTML overview report
- Track custom annotations, tags, and export history in a separate database
- Deploy as a container on AI01 alongside Plexus

## Non-Goals

- User management or multi-tenant auth (single admin key from Plexus config)
- Write operations to the Plexus database (read-only)
- Real-time streaming updates (polling-based live data is sufficient)
- E2E test suite (internal ops tool)

## Architecture

```
┌─────────────────────────────────────┐
│  Browser (React + Vite)             │
│  localhost:4002                     │
└─────────────┬───────────────────────┘
              │ HTTP
┌─────────────▼───────────────────────┐
│  Node.js / Express Backend          │
│  localhost:4002                     │
│                                     │
│  ┌──────────────┐  ┌──────────────┐ │
│  │ Plexus DB    │  │ App DB       │ │
│  │ 100.96.49.42 │  │ (own PG)     │ │
│  │ port 5435    │  │ port 5432    │ │
│  │ read-only    │  │ read-write   │ │
│  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────┘
```

### Backend Stack

- **Runtime:** Node.js 20 (Alpine)
- **Framework:** Express.js 4.x
- **Database Client:** `pg` (node-postgres) with connection pooling
- **ZIP Generation:** `archiver` with streaming backpressure
- **Auth:** Single admin key from Plexus `plexus.yaml` — parsed at startup by reading the `adminKey` field from the mounted YAML file.

### Frontend Stack

- **Build Tool:** Vite 5.x
- **Framework:** React 18
- **Styling:** Tailwind CSS
- **Data Fetching:** Native `fetch` with custom hooks
- **State:** React `useState`/`useReducer` (no global state library needed)

## Components

### Backend API Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/requests` | Filterable, paginated list from `request_usage` |
| GET | `/api/debug/:requestId` | Full debug view: `debug_logs` + `inference_errors` + `provider_performance` |
| POST | `/api/export` | Generate ZIP bundle from array of `request_id`s |
| GET | `/api/export/:exportId` | Download previously generated bundle |
| GET | `/api/export-history` | List of past exports with metadata |
| GET | `/api/annotations` | List annotations for a request or all |
| POST | `/api/annotations` | Add tag/note annotation to a request |
| DELETE | `/api/annotations/:id` | Remove an annotation |
| GET | `/health` | Health check: both DB connections |

### Frontend Views

| View | Purpose |
|------|---------|
| **Dashboard** | Filter panel + paginated request table. Columns: request_id, provider, model, api_key, status, tokens, duration, timestamp. Row click opens detail drawer. |
| **Detail Drawer** | Slide-out panel with tabs: Summary, Raw Request, Raw Response, Errors, Tool Calls, Annotations. |
| **Bundle Export** | Modal: select requests via checkboxes, preview bundle size, generate and download ZIP. |
| **Export History** | Table of past bundles with filters, re-download links, and deletion. |

## Data Flow

1. **Initial Load:** React mounts → `useEffect` fetches `/api/requests?limit=50` → Express queries Plexus `request_usage` ordered by `created_at DESC` → returns JSON with `nextCursor` (lowest `created_at` timestamp in result set for offset-free pagination).
2. **Filtering:** User sets filters → debounced 300ms → Express builds parameterized SQL with `WHERE` clauses on `provider`, `canonical_model_name`, `api_key`, `response_status`, `created_at` range, and `EXISTS` subquery on `inference_errors` for error filtering.
3. **Detail View:** User clicks row → `/api/debug/:requestId` → Express JOINs `debug_logs`, `inference_errors`, `provider_performance` on `request_id` → returns unified debug payload.
4. **Export:** User selects requests → clicks Export → POST `/api/export` with `request_ids` array → Express:
   - Queries Plexus for each request's related tables
   - Parses raw JSON for tool call summaries
   - Streams ZIP via `archiver` with `requests/{id}.json`, `raw/{id}_request.json`, `raw/{id}_response.json`, `errors/{id}.json`
   - Generates `manifest.json` and `report.html` inline
   - Writes ZIP to disk in `./exports/` directory
   - Records entry in `export_history`
   - Returns download URL
5. **Annotation:** User adds tag/note → POST `/api/annotations` → stored in app DB `request_annotations`.

## Own Database Schema

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE debug_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT,
    filters JSONB NOT NULL DEFAULT '{}',
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE request_annotations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id TEXT NOT NULL,
    tag TEXT,
    note TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_annotations_request_id ON request_annotations(request_id);
CREATE INDEX idx_annotations_tag ON request_annotations(tag);

CREATE TABLE export_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES debug_sessions(id) ON DELETE SET NULL,
    request_ids TEXT[] NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_export_history_created_at ON export_history(created_at);

CREATE TABLE parsed_tool_calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id TEXT NOT NULL,
    tool_name TEXT,
    arguments JSONB,
    result JSONB,
    error TEXT,
    parsed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_parsed_tool_calls_request_id ON parsed_tool_calls(request_id);
```

## ZIP Bundle Format

```
plexus-debug-{timestamp}.zip
├── manifest.json          # Metadata: export date, filter snapshot, request count
├── report.html            # Overview: provider breakdown, error stats, latency charts
├── requests/
│   ├── {request_id}.json  # Parsed summary: metadata + tool call summary
│   └── ...
├── raw/
│   ├── {request_id}_request.json      # raw_request from debug_logs
│   ├── {request_id}_response.json     # raw_response from debug_logs
│   └── ...
└── errors/
    ├── {request_id}_error.json        # inference_errors row
    └── ...
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Plexus DB unavailable | Return 503 with banner flag; UI falls back to app DB cached data |
| Large payload (>5MB single file) | Write as separate file in ZIP; skip inlining in manifest |
| Query timeout (>10s) | Return partial results with `partial: true` + suggested narrower filters |
| ZIP generation failure | Clean up partial ZIP file; return 500 with error details |
| Invalid request_id in export | Skip silently, include in manifest warnings array |
| Auth failure (bad admin key) | Return 401, no data |

## Testing

- **Backend unit:** `vitest` for SQL query builder logic and ZIP manifest generation
- **Backend integration:** One test hitting real Plexus DB read-only via `/api/requests`
- **Frontend unit:** `vitest` + `@testing-library/react` for filter form and table rendering
- **Health check:** `GET /health` verifies both pool connections, returns `{ "status": "ok", "plexusDb": true, "appDb": true }` or 503

## Deployment

### Dockerfile

Multi-stage build: Node.js 20 Alpine for `npm ci` and Vite build, then `node:20-alpine` runtime with only `dist/` and `node_modules`.

### docker-compose.yml

```yaml
services:
  plexus-debug-ui:
    build: .
    ports:
      - "4002:4002"
    environment:
      - PLEXUS_DATABASE_URL=postgresql://plexus:plexus_pass@100.96.49.42:5435/plexus
      - APP_DATABASE_URL=postgresql://app:app_pass@db:5432/debug_ui
      - ADMIN_KEY_FILE=/app/config/plexus.yaml
      - PORT=4002
    volumes:
      - /home/user001/plexus/plexus.yaml:/app/config/plexus.yaml:ro
      - ./exports:/app/exports
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app_pass
      POSTGRES_DB: debug_ui
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

### AI01 Deployment

- Directory: `~/plexus-debug-ui`
- Start: `podman-compose up -d` (or `docker-compose up -d`)
- Port: 4002
- Plexus config mounted read-only for admin key
- Exports directory mounted for persistent ZIP storage

## Security Notes

- Plexus DB connection is read-only (no `INSERT`/`UPDATE`/`DELETE` routes touch it)
- Admin key is the only auth mechanism; exposed via `Authorization: Bearer <key>` header
- Plexus `plexus.yaml` contains API keys; mounted read-only and never served to frontend
- ZIP files are stored on disk; `export_history` tracks them but does not serve without auth
- No CORS needed (same-origin deployment)

## Performance Considerations

- Plexus `request_usage` has 41,878 rows; use cursor-based pagination (`LIMIT` + `created_at` offset)
- Raw payloads can be 250KB+; never buffer more than 10 payloads in memory during ZIP generation
- JSON parsing of raw request/response for tool call extraction is CPU-bound; offload to background if needed
- Connection pool: 5-10 connections to Plexus DB (read-only, shared across requests)

## Future Extensions (out of scope)

- WebSocket live feed of new requests
- Grafana-style dashboards with aggregated metrics
- Automated bundle generation on error threshold
- Integration with Loki/Promtail logs
