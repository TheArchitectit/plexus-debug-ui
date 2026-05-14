# Plexus Debug UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a containerized Node.js/Express + React/Vite web app that connects read-only to the Plexus PostgreSQL database for filtering and exporting debug bundles, with its own PostgreSQL for extended metadata.

**Architecture:** Express backend serves API routes and the built React frontend. Two pg connection pools: one read-only to Plexus DB, one read-write to app DB. ZIP bundles are streamed to disk via archiver. Admin key auth parsed from mounted plexus.yaml.

**Tech Stack:** Node.js 20, Express 4, pg 8, archiver 7, js-yaml 4, React 18, Vite 5, Tailwind CSS 3, vitest 1

---

## File Structure

```
├── package.json
├── vite.config.js
├── Dockerfile
├── docker-compose.yml
├── server.js                     # Express app entry
├── config.js                     # Env config + admin key parser
├── db/
│   ├── plexus.js                 # Plexus DB pool + queries
│   ├── app.js                    # App DB pool + queries
│   └── migrate.js                # Schema migration runner
├── routes/
│   ├── requests.js               # GET /api/requests
│   ├── debug.js                  # GET /api/debug/:requestId
│   ├── export.js                 # POST/GET /api/export
│   ├── annotations.js            # CRUD /api/annotations
│   └── health.js                 # GET /health
├── services/
│   ├── zipExporter.js            # ZIP bundle streaming logic
│   └── toolParser.js             # Extract tool calls from raw JSON
├── middleware/
│   ├── auth.js                   # Bearer admin key check
│   └── errorHandler.js           # Global error handler
├── public/                       # Static assets
├── index.html                    # Vite HTML entry
├── src/
│   ├── main.jsx                  # React mount
│   ├── App.jsx                   # Router + layout
│   ├── index.css                 # Tailwind directives
│   ├── components/
│   │   ├── Dashboard.jsx         # Filter panel + table wrapper
│   │   ├── FilterPanel.jsx     # Filter inputs
│   │   ├── RequestTable.jsx    # Paginated table
│   │   ├── DetailDrawer.jsx    # Slide-out debug detail
│   │   ├── ExportModal.jsx     # Bundle export wizard
│   │   └── ExportHistory.jsx   # Past bundles list
│   ├── hooks/
│   │   ├── useRequests.js      # Fetch requests with filters
│   │   ├── useDebug.js         # Fetch debug details
│   │   ├── useAnnotations.js   # Annotation CRUD
│   │   └── useExport.js        # Export generation + download
│   └── lib/
│       └── api.js              # fetch wrapper + auth header
└── tests/
    ├── backend/
    │   ├── requests.test.js      # /api/requests integration
    │   └── zipExporter.test.js # ZIP generation unit
    └── frontend/
        └── FilterPanel.test.jsx # Filter form unit
```

---

### Task 1: Project Bootstrap — package.json, config, and dev infrastructure

**Files:**
- Create: `package.json`
- Create: `vite.config.js`
- Create: `config.js`
- Create: `docker-compose.yml`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "plexus-debug-ui",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "concurrently \"npm run server:dev\" \"npm run client:dev\"",
    "server:dev": "nodemon server.js",
    "client:dev": "vite",
    "build": "vite build",
    "start": "node server.js",
    "test": "vitest run",
    "migrate": "node db/migrate.js"
  },
  "dependencies": {
    "express": "^4.21.0",
    "pg": "^8.13.0",
    "archiver": "^7.0.0",
    "js-yaml": "^4.1.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "concurrently": "^9.0.0",
    "jsdom": "^25.0.0",
    "nodemon": "^3.1.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write vite.config.js**

```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
  server: {
    proxy: {
      '/api': 'http://localhost:4002',
      '/health': 'http://localhost:4002',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

- [ ] **Step 3: Write config.js**

```javascript
import fs from 'fs';
import yaml from 'js-yaml';

function loadAdminKey() {
  const file = process.env.ADMIN_KEY_FILE || '/app/config/plexus.yaml';
  try {
    const doc = yaml.load(fs.readFileSync(file, 'utf8'));
    return doc?.adminKey || process.env.ADMIN_KEY || 'change-me';
  } catch {
    return process.env.ADMIN_KEY || 'change-me';
  }
}

export const config = {
  port: parseInt(process.env.PORT || '4002', 10),
  plexusDbUrl: process.env.PLEXUS_DATABASE_URL || 'postgresql://plexus:plexus_pass@100.96.49.42:5435/plexus',
  appDbUrl: process.env.APP_DATABASE_URL || 'postgresql://app:app_pass@localhost:5432/debug_ui',
  adminKey: loadAdminKey(),
  exportsDir: process.env.EXPORTS_DIR || './exports',
};
```

- [ ] **Step 4: Write docker-compose.yml**

```yaml
services:
  plexus-debug-ui:
    build: .
    ports:
      - "4002:4002"
    environment:
      - PLEXUS_DATABASE_URL=postgresql://plexus:plexus_pass@host.docker.internal:5435/plexus
      - APP_DATABASE_URL=postgresql://app:app_pass@db:5432/debug_ui
      - ADMIN_KEY_FILE=/app/config/plexus.yaml
      - PORT=4002
      - EXPORTS_DIR=/app/exports
    volumes:
      - /home/user001/plexus/plexus.yaml:/app/config/plexus.yaml:ro
      - ./exports:/app/exports
    depends_on:
      - db
    extra_hosts:
      - "host.docker.internal:host-gateway"

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app_pass
      POSTGRES_DB: debug_ui
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

- [ ] **Step 5: Commit**

```bash
git add package.json vite.config.js config.js docker-compose.yml
git commit -m "chore: bootstrap project config and dev infrastructure"
```

---

### Task 2: Database Layer — connection pools, schema, and migration

**Files:**
- Create: `db/plexus.js`
- Create: `db/app.js`
- Create: `db/migrate.js`

- [ ] **Step 1: Write db/plexus.js**

```javascript
import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export const plexusPool = new Pool({
  connectionString: config.plexusDbUrl,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

plexusPool.on('error', (err) => {
  console.error('Plexus DB pool error:', err);
});

export async function queryPlexus(sql, params) {
  const client = await plexusPool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 2: Write db/app.js**

```javascript
import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export const appPool = new Pool({
  connectionString: config.appDbUrl,
  max: 10,
});

appPool.on('error', (err) => {
  console.error('App DB pool error:', err);
});

export async function queryApp(sql, params) {
  const client = await appPool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 3: Write db/migrate.js**

```javascript
import fs from 'fs';
import path from 'path';
import { appPool } from './app.js';

const schemaSQL = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS debug_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT,
    filters JSONB NOT NULL DEFAULT '{}',
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS request_annotations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id TEXT NOT NULL,
    tag TEXT,
    note TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_annotations_request_id ON request_annotations(request_id);
CREATE INDEX IF NOT EXISTS idx_annotations_tag ON request_annotations(tag);

CREATE TABLE IF NOT EXISTS export_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES debug_sessions(id) ON DELETE SET NULL,
    request_ids TEXT[] NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_export_history_created_at ON export_history(created_at);

CREATE TABLE IF NOT EXISTS parsed_tool_calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id TEXT NOT NULL,
    tool_name TEXT,
    arguments JSONB,
    result JSONB,
    error TEXT,
    parsed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parsed_tool_calls_request_id ON parsed_tool_calls(request_id);
`;

async function migrate() {
  const client = await appPool.connect();
  try {
    await client.query(schemaSQL);
    console.log('Migration complete');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await appPool.end();
  }
}

migrate();
```

- [ ] **Step 4: Commit**

```bash
git add db/
git commit -m "feat: add database pools, schema, and migration runner"
```

---

### Task 3: Middleware — auth and error handling

**Files:**
- Create: `middleware/auth.js`
- Create: `middleware/errorHandler.js`

- [ ] **Step 1: Write middleware/auth.js**

```javascript
import { config } from '../config.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (token !== config.adminKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
```

- [ ] **Step 2: Write middleware/errorHandler.js**

```javascript
export function errorHandler(err, req, res, next) {
  console.error('Unhandled error:', err);
  const status = err.status || 500;
  const message = err.message || 'Internal server error';
  res.status(status).json({ error: message, partial: err.partial || false });
}

export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add middleware/
git commit -m "feat: add auth and error handling middleware"
```

---

### Task 4: Service — ZIP bundle exporter

**Files:**
- Create: `services/zipExporter.js`
- Create: `tests/backend/zipExporter.test.js`

- [ ] **Step 1: Write tests/backend/zipExporter.test.js**

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createDebugBundle } from '../../services/zipExporter.js';

describe('zipExporter', () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plexus-test-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('creates a zip with manifest and request files', async () => {
    const requests = [
      {
        request_id: 'req-1',
        provider: 'openai',
        model: 'gpt-4o',
        raw_request: '{"messages":[]}',
        raw_response: '{"choices":[]}',
        error: null,
      },
    ];
    const outPath = path.join(tmpDir, 'test.zip');
    const result = await createDebugBundle(requests, outPath);
    expect(fs.existsSync(outPath)).toBe(true);
    expect(result.filePath).toBe(outPath);
    expect(result.requestCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/backend/zipExporter.test.js
```

Expected: FAIL — `createDebugBundle` not defined.

- [ ] **Step 3: Write services/zipExporter.js**

```javascript
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

const MAX_INLINE_SIZE = 5 * 1024 * 1024;

export async function createDebugBundle(requests, outPath) {
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const output = fs.createWriteStream(outPath);
  const archive = archiver('zip', { zlib: { level: 6 } });

  await new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') throw err;
    });
    archive.pipe(output);

    const manifest = {
      exportedAt: new Date().toISOString(),
      requestCount: requests.length,
      requests: requests.map((r) => ({
        request_id: r.request_id,
        provider: r.provider,
        model: r.model,
        status: r.status,
        hasError: !!r.error,
      })),
      warnings: [],
    };

    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

    for (const req of requests) {
      const base = `requests/${req.request_id}`;
      const summary = {
        request_id: req.request_id,
        provider: req.provider,
        model: req.model,
        status: req.status,
        created_at: req.created_at,
      };
      archive.append(JSON.stringify(summary, null, 2), { name: `${base}.json` });

      const rawReqSize = req.raw_request?.length || 0;
      const rawRespSize = req.raw_response?.length || 0;

      if (rawReqSize > 0 && rawReqSize < MAX_INLINE_SIZE) {
        archive.append(req.raw_request, { name: `${base}_request.json` });
      } else if (rawReqSize > 0) {
        manifest.warnings.push(`${req.request_id}: request payload too large (${rawReqSize} bytes)`);
      }

      if (rawRespSize > 0 && rawRespSize < MAX_INLINE_SIZE) {
        archive.append(req.raw_response, { name: `${base}_response.json` });
      } else if (rawRespSize > 0) {
        manifest.warnings.push(`${req.request_id}: response payload too large (${rawRespSize} bytes)`);
      }

      if (req.error) {
        archive.append(JSON.stringify(req.error, null, 2), { name: `errors/${req.request_id}_error.json` });
      }
    }

    const reportHtml = generateReportHtml(requests);
    archive.append(reportHtml, { name: 'report.html' });

    archive.finalize();
  });

  const stats = fs.statSync(outPath);
  return { filePath: outPath, fileSize: stats.size, requestCount: requests.length };
}

function generateReportHtml(requests) {
  const providerCounts = {};
  const errorCount = requests.filter((r) => r.error).length;
  for (const r of requests) {
    providerCounts[r.provider] = (providerCounts[r.provider] || 0) + 1;
  }

  let providerRows = '';
  for (const [p, c] of Object.entries(providerCounts)) {
    providerRows += `<tr><td>${p}</td><td>${c}</td></tr>`;
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Debug Report</title>
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px;text-align:left}th{background:#f5f5f5}</style>
</head><body>
<h1>Plexus Debug Report</h1>
<p>Generated: ${new Date().toISOString()}</p>
<p>Total requests: ${requests.length}</p>
<p>Errors: ${errorCount}</p>
<h2>Provider Breakdown</h2>
<table><tr><th>Provider</th><th>Count</th></tr>${providerRows}</table>
</body></html>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/backend/zipExporter.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/ tests/
git commit -m "feat: add ZIP debug bundle exporter with tests"
```

---

### Task 5: Service — tool call parser

**Files:**
- Create: `services/toolParser.js`

- [ ] **Step 1: Write services/toolParser.js**

```javascript
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
```

- [ ] **Step 2: Commit**

```bash
git add services/toolParser.js
git commit -m "feat: add tool call parser for raw request/response JSON"
```

---

### Task 6: Routes — requests list and debug detail

**Files:**
- Create: `routes/requests.js`
- Create: `routes/debug.js`
- Create: `tests/backend/requests.test.js`

- [ ] **Step 1: Write tests/backend/requests.test.js**

```javascript
import { describe, it, expect } from 'vitest';
import { buildRequestsQuery } from '../../routes/requests.js';

describe('buildRequestsQuery', () => {
  it('builds query with provider filter', () => {
    const { sql, params } = buildRequestsQuery({ provider: 'openai' });
    expect(sql).toContain('provider = $');
    expect(params).toContain('openai');
  });

  it('builds query with date range', () => {
    const { sql, params } = buildRequestsQuery({ dateFrom: '2024-01-01', dateTo: '2024-01-02' });
    expect(sql).toContain('created_at >=');
    expect(sql).toContain('created_at <=');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/backend/requests.test.js
```

Expected: FAIL — `buildRequestsQuery` not exported.

- [ ] **Step 3: Write routes/requests.js**

```javascript
import { Router } from 'express';
import { queryPlexus } from '../db/plexus.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

export function buildRequestsQuery(filters) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (filters.provider) {
    conditions.push(`provider = $${idx++}`);
    params.push(filters.provider);
  }
  if (filters.model) {
    conditions.push(`(canonical_model_name = $${idx} OR incoming_model_alias = $${idx} OR selected_model_name = $${idx})`);
    params.push(filters.model);
    idx++;
  }
  if (filters.apiKey) {
    conditions.push(`api_key = $${idx++}`);
    params.push(filters.apiKey);
  }
  if (filters.status) {
    conditions.push(`response_status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.dateFrom) {
    const fromMs = new Date(filters.dateFrom).getTime();
    conditions.push(`created_at >= $${idx++}`);
    params.push(fromMs);
  }
  if (filters.dateTo) {
    const toMs = new Date(filters.dateTo).getTime();
    conditions.push(`created_at <= $${idx++}`);
    params.push(toMs);
  }
  if (filters.hasError === 'true') {
    conditions.push(`EXISTS (SELECT 1 FROM inference_errors e WHERE e.request_id = request_usage.request_id)`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const cursorClause = filters.cursor
    ? `AND created_at < $${idx++}`
    : '';
  if (filters.cursor) params.push(parseInt(filters.cursor, 10));

  const limit = parseInt(filters.limit || '50', 10);
  const sql = `
    SELECT request_id, provider, incoming_model_alias, canonical_model_name, selected_model_name,
           api_key, response_status, tokens_input, tokens_output, duration_ms, created_at,
           (EXISTS (SELECT 1 FROM inference_errors e WHERE e.request_id = request_usage.request_id)) as has_error
    FROM request_usage
    ${where} ${cursorClause ? where ? cursorClause.replace('AND', 'AND') : `WHERE ${cursorClause.replace('AND', '')}` : ''}
    ORDER BY created_at DESC
    LIMIT $${idx}
  `;
  params.push(limit);

  return { sql, params };
}

router.get('/', asyncHandler(async (req, res) => {
  const filters = {
    provider: req.query.provider,
    model: req.query.model,
    apiKey: req.query.apiKey,
    status: req.query.status,
    dateFrom: req.query.dateFrom,
    dateTo: req.query.dateTo,
    hasError: req.query.hasError,
    cursor: req.query.cursor,
    limit: req.query.limit,
  };

  const { sql, params } = buildRequestsQuery(filters);

  try {
    const rows = await queryPlexus(sql, params);
    const nextCursor = rows.length > 0 ? rows[rows.length - 1].created_at : null;
    res.json({ data: rows, nextCursor });
  } catch (err) {
    err.status = 503;
    err.partial = true;
    throw err;
  }
}));

export default router;
```

- [ ] **Step 4: Write routes/debug.js**

```javascript
import { Router } from 'express';
import { queryPlexus } from '../db/plexus.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

router.get('/:requestId', asyncHandler(async (req, res) => {
  const { requestId } = req.params;

  const [usage] = await queryPlexus(
    `SELECT * FROM request_usage WHERE request_id = $1`,
    [requestId]
  );

  const [debug] = await queryPlexus(
    `SELECT * FROM debug_logs WHERE request_id = $1`,
    [requestId]
  );

  const errors = await queryPlexus(
    `SELECT * FROM inference_errors WHERE request_id = $1`,
    [requestId]
  );

  const [perf] = await queryPlexus(
    `SELECT * FROM provider_performance WHERE request_id = $1`,
    [requestId]
  );

  res.json({ usage, debug, errors, performance: perf });
}));

export default router;
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/backend/requests.test.js
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add routes/ tests/
git commit -m "feat: add requests list and debug detail routes with tests"
```

---

### Task 7: Routes — export and annotations

**Files:**
- Create: `routes/export.js`
- Create: `routes/annotations.js`
- Modify: `services/zipExporter.js` (add generateReportHtml export if needed)

- [ ] **Step 1: Write routes/export.js**

```javascript
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { queryPlexus } from '../db/plexus.js';
import { queryApp } from '../db/app.js';
import { createDebugBundle } from '../services/zipExporter.js';
import { extractToolCalls } from '../services/toolParser.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { config } from '../config.js';

const router = Router();

router.post('/', asyncHandler(async (req, res) => {
  const { requestIds, sessionName } = req.body;
  if (!Array.isArray(requestIds) || requestIds.length === 0) {
    return res.status(400).json({ error: 'requestIds array required' });
  }

  const placeholders = requestIds.map((_, i) => `$${i + 1}`).join(',');
  const requests = await queryPlexus(
    `SELECT r.*, d.raw_request, d.raw_response, d.transformed_request, d.transformed_response,
            e.error_message, e.error_stack, e.details as error_details
     FROM request_usage r
     LEFT JOIN debug_logs d ON d.request_id = r.request_id
     LEFT JOIN inference_errors e ON e.request_id = r.request_id
     WHERE r.request_id IN (${placeholders})`,
    requestIds
  );

  const enriched = requests.map((r) => ({
    ...r,
    error: r.error_message ? { message: r.error_message, stack: r.error_stack, details: r.error_details } : null,
    toolCalls: extractToolCalls(r.raw_request, r.raw_response),
  }));

  const ts = Date.now();
  const fileName = `plexus-debug-${ts}.zip`;
  const outPath = path.join(config.exportsDir, fileName);

  const bundle = await createDebugBundle(enriched, outPath);

  const [session] = await queryApp(
    `INSERT INTO debug_sessions (name, filters, created_by) VALUES ($1, $2, $3) RETURNING id`,
    [sessionName || `Export ${new Date().toISOString()}`, JSON.stringify({ requestIds }), 'admin']
  );

  await queryApp(
    `INSERT INTO export_history (session_id, request_ids, file_path, file_size) VALUES ($1, $2, $3, $4)`,
    [session.id, requestIds, outPath, bundle.fileSize]
  );

  res.json({ exportId: session.id, downloadUrl: `/api/export/${session.id}`, fileSize: bundle.fileSize });
}));

router.get('/:exportId', asyncHandler(async (req, res) => {
  const { exportId } = req.params;
  const [record] = await queryApp(
    `SELECT file_path FROM export_history WHERE session_id = $1`,
    [exportId]
  );
  if (!record || !fs.existsSync(record.file_path)) {
    return res.status(404).json({ error: 'Export not found' });
  }
  res.download(record.file_path);
}));

router.get('/', asyncHandler(async (req, res) => {
  const rows = await queryApp(
    `SELECT e.id, e.session_id, e.request_ids, e.file_size, e.created_at, s.name as session_name
     FROM export_history e
     LEFT JOIN debug_sessions s ON s.id = e.session_id
     ORDER BY e.created_at DESC
     LIMIT 50`
  );
  res.json({ data: rows });
}));

export default router;
```

- [ ] **Step 2: Write routes/annotations.js**

```javascript
import { Router } from 'express';
import { queryApp } from '../db/app.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const { requestId, tag } = req.query;
  const conditions = [];
  const params = [];
  let idx = 1;

  if (requestId) {
    conditions.push(`request_id = $${idx++}`);
    params.push(requestId);
  }
  if (tag) {
    conditions.push(`tag = $${idx++}`);
    params.push(tag);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await queryApp(
    `SELECT * FROM request_annotations ${where} ORDER BY created_at DESC`,
    params
  );
  res.json({ data: rows });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { requestId, tag, note } = req.body;
  if (!requestId) return res.status(400).json({ error: 'requestId required' });

  const [row] = await queryApp(
    `INSERT INTO request_annotations (request_id, tag, note, created_by) VALUES ($1, $2, $3, $4) RETURNING *`,
    [requestId, tag || null, note || null, 'admin']
  );
  res.status(201).json(row);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await queryApp(`DELETE FROM request_annotations WHERE id = $1`, [req.params.id]);
  res.status(204).send();
}));

export default router;
```

- [ ] **Step 3: Commit**

```bash
git add routes/
git commit -m "feat: add export and annotation routes"
```

---

### Task 8: Routes — health check and server wiring

**Files:**
- Create: `routes/health.js`
- Create: `server.js`

- [ ] **Step 1: Write routes/health.js**

```javascript
import { Router } from 'express';
import { plexusPool } from '../db/plexus.js';
import { appPool } from '../db/app.js';

const router = Router();

router.get('/', async (req, res) => {
  let plexusOk = false;
  let appOk = false;

  try {
    await plexusPool.query('SELECT 1');
    plexusOk = true;
  } catch {
    plexusOk = false;
  }

  try {
    await appPool.query('SELECT 1');
    appOk = true;
  } catch {
    appOk = false;
  }

  const status = plexusOk && appOk ? 200 : 503;
  res.status(status).json({ status: plexusOk && appOk ? 'ok' : 'degraded', plexusDb: plexusOk, appDb: appOk });
});

export default router;
```

- [ ] **Step 2: Write server.js**

```javascript
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import requestsRouter from './routes/requests.js';
import debugRouter from './routes/debug.js';
import exportRouter from './routes/export.js';
import annotationsRouter from './routes/annotations.js';
import healthRouter from './routes/health.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '10mb' }));

app.use('/health', healthRouter);
app.use('/api', requireAuth);
app.use('/api/requests', requestsRouter);
app.use('/api/debug', debugRouter);
app.use('/api/export', exportRouter);
app.use('/api/annotations', annotationsRouter);

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Plexus Debug UI running on port ${config.port}`);
});
```

- [ ] **Step 3: Commit**

```bash
git add routes/health.js server.js
git commit -m "feat: add health check and wire up Express server"
```

---

### Task 9: Frontend — HTML entry, CSS, and API client

**Files:**
- Create: `index.html`
- Create: `src/index.css`
- Create: `src/main.jsx`
- Create: `src/lib/api.js`

- [ ] **Step 1: Write index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Plexus Debug UI</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

- [ ] **Step 2: Write src/index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  background-color: #f3f4f6;
  font-family: system-ui, -apple-system, sans-serif;
}
```

- [ ] **Step 3: Write src/main.jsx**

```javascript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 4: Write src/lib/api.js**

```javascript
const ADMIN_KEY = localStorage.getItem('plexusAdminKey') || '';

async function api(path, options = {}) {
  const url = path.startsWith('http') ? path : `/api${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_KEY}`,
      ...options.headers,
    },
  });

  if (res.status === 401) {
    const key = prompt('Enter admin key:');
    if (key) {
      localStorage.setItem('plexusAdminKey', key);
      return api(path, options);
    }
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export const requestsApi = {
  list: (filters) => {
    const qs = new URLSearchParams(filters).toString();
    return api(`/requests?${qs}`);
  },
  debug: (requestId) => api(`/debug/${requestId}`),
};

export const exportApi = {
  create: (requestIds, sessionName) => api('/export', {
    method: 'POST',
    body: JSON.stringify({ requestIds, sessionName }),
  }),
  download: (exportId) => `/api/export/${exportId}`,
  history: () => api('/export'),
};

export const annotationsApi = {
  list: (params) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/annotations?${qs}`);
  },
  create: (data) => api('/annotations', { method: 'POST', body: JSON.stringify(data) }),
  delete: (id) => api(`/annotations/${id}`, { method: 'DELETE' }),
};
```

- [ ] **Step 5: Commit**

```bash
git add index.html src/
git commit -m "feat: add frontend entry, Tailwind CSS, and API client"
```

---

### Task 10: Frontend — App shell and Dashboard

**Files:**
- Create: `src/App.jsx`
- Create: `src/components/Dashboard.jsx`
- Create: `src/components/FilterPanel.jsx`
- Create: `src/components/RequestTable.jsx`

- [ ] **Step 1: Write src/App.jsx**

```javascript
import React, { useState } from 'react';
import Dashboard from './components/Dashboard.jsx';
import ExportHistory from './components/ExportHistory.jsx';

export default function App() {
  const [view, setView] = useState('dashboard');

  return (
    <div className="min-h-screen">
      <nav className="bg-slate-900 text-white px-4 py-3 flex gap-4 items-center">
        <h1 className="text-lg font-bold">Plexus Debug UI</h1>
        <button
          className={`px-3 py-1 rounded ${view === 'dashboard' ? 'bg-slate-700' : 'hover:bg-slate-800'}`}
          onClick={() => setView('dashboard')}
        >
          Dashboard
        </button>
        <button
          className={`px-3 py-1 rounded ${view === 'history' ? 'bg-slate-700' : 'hover:bg-slate-800'}`}
          onClick={() => setView('history')}
        >
          Export History
        </button>
      </nav>
      <main className="p-4 max-w-7xl mx-auto">
        {view === 'dashboard' && <Dashboard />}
        {view === 'history' && <ExportHistory />}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Write src/components/FilterPanel.jsx**

```javascript
import React, { useState, useCallback } from 'react';

export default function FilterPanel({ onFilter }) {
  const [filters, setFilters] = useState({
    provider: '',
    model: '',
    apiKey: '',
    status: '',
    dateFrom: '',
    dateTo: '',
    hasError: '',
  });

  const update = useCallback((key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
  }, []);

  const apply = useCallback(() => {
    const clean = Object.fromEntries(
      Object.entries(filters).filter(([, v]) => v !== '')
    );
    onFilter(clean);
  }, [filters, onFilter]);

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
      <input
        className="border rounded px-2 py-1"
        placeholder="Provider"
        value={filters.provider}
        onChange={(e) => update('provider', e.target.value)}
      />
      <input
        className="border rounded px-2 py-1"
        placeholder="Model"
        value={filters.model}
        onChange={(e) => update('model', e.target.value)}
      />
      <input
        className="border rounded px-2 py-1"
        placeholder="API Key"
        value={filters.apiKey}
        onChange={(e) => update('apiKey', e.target.value)}
      />
      <select
        className="border rounded px-2 py-1"
        value={filters.status}
        onChange={(e) => update('status', e.target.value)}
      >
        <option value="">All statuses</option>
        <option value="success">Success</option>
        <option value="error">Error</option>
      </select>
      <input
        type="date"
        className="border rounded px-2 py-1"
        value={filters.dateFrom}
        onChange={(e) => update('dateFrom', e.target.value)}
      />
      <input
        type="date"
        className="border rounded px-2 py-1"
        value={filters.dateTo}
        onChange={(e) => update('dateTo', e.target.value)}
      />
      <select
        className="border rounded px-2 py-1"
        value={filters.hasError}
        onChange={(e) => update('hasError', e.target.value)}
      >
        <option value="">All</option>
        <option value="true">Has error</option>
        <option value="false">No error</option>
      </select>
      <button
        className="bg-slate-900 text-white rounded px-3 py-1 hover:bg-slate-800"
        onClick={apply}
      >
        Apply Filters
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Write src/components/RequestTable.jsx**

```javascript
import React from 'react';

function formatDate(ts) {
  if (!ts) return '-';
  const d = new Date(Number(ts));
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export default function RequestTable({ rows, selected, onSelect, onSelectAll, onRowClick }) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.request_id));

  return (
    <div className="bg-white rounded-lg shadow overflow-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-100 sticky top-0">
          <tr>
            <th className="px-3 py-2 text-left">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => onSelectAll(e.target.checked)}
              />
            </th>
            <th className="px-3 py-2 text-left">Request ID</th>
            <th className="px-3 py-2 text-left">Provider</th>
            <th className="px-3 py-2 text-left">Model</th>
            <th className="px-3 py-2 text-left">API Key</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-right">Tokens</th>
            <th className="px-3 py-2 text-right">Duration</th>
            <th className="px-3 py-2 text-left">Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.request_id}
              className="border-t hover:bg-slate-50 cursor-pointer"
              onClick={() => onRowClick(row.request_id)}
            >
              <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected.has(row.request_id)}
                  onChange={(e) => onSelect(row.request_id, e.target.checked)}
                />
              </td>
              <td className="px-3 py-2 font-mono text-xs">{row.request_id?.slice(0, 12)}...</td>
              <td className="px-3 py-2">{row.provider}</td>
              <td className="px-3 py-2">{row.canonical_model_name || row.incoming_model_alias}</td>
              <td className="px-3 py-2">{row.api_key}</td>
              <td className="px-3 py-2">
                <span className={`px-2 py-0.5 rounded text-xs ${row.response_status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                  {row.response_status}
                </span>
              </td>
              <td className="px-3 py-2 text-right">{(row.tokens_input || 0) + (row.tokens_output || 0)}</td>
              <td className="px-3 py-2 text-right">{row.duration_ms}ms</td>
              <td className="px-3 py-2 text-xs whitespace-nowrap">{formatDate(row.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Write src/components/Dashboard.jsx**

```javascript
import React, { useState, useCallback } from 'react';
import FilterPanel from './FilterPanel.jsx';
import RequestTable from './RequestTable.jsx';
import DetailDrawer from './DetailDrawer.jsx';
import ExportModal from './ExportModal.jsx';
import { useRequests } from '../hooks/useRequests.js';

export default function Dashboard() {
  const [filters, setFilters] = useState({});
  const [selected, setSelected] = useState(new Set());
  const [detailId, setDetailId] = useState(null);
  const [showExport, setShowExport] = useState(false);

  const { rows, loading, error, loadMore, hasMore } = useRequests(filters);

  const onSelect = useCallback((id, checked) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const onSelectAll = useCallback((checked) => {
    setSelected(checked ? new Set(rows.map((r) => r.request_id)) : new Set());
  }, [rows]);

  const selectedRows = rows.filter((r) => selected.has(r.request_id));

  return (
    <div>
      <FilterPanel onFilter={setFilters} />
      {error && <div className="bg-red-100 text-red-800 p-3 rounded mb-4">{error}</div>}
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm text-slate-600">{rows.length} requests shown</span>
        <div className="flex gap-2">
          <button
            className="bg-slate-900 text-white px-3 py-1 rounded text-sm hover:bg-slate-800 disabled:opacity-50"
            disabled={selected.size === 0}
            onClick={() => setShowExport(true)}
          >
            Export {selected.size} selected
          </button>
          {hasMore && (
            <button
              className="border border-slate-300 px-3 py-1 rounded text-sm hover:bg-slate-50"
              onClick={loadMore}
            >
              Load more
            </button>
          )}
        </div>
      </div>
      <RequestTable
        rows={rows}
        selected={selected}
        onSelect={onSelect}
        onSelectAll={onSelectAll}
        onRowClick={setDetailId}
      />
      {loading && <div className="text-center py-4 text-slate-500">Loading...</div>}
      {detailId && <DetailDrawer requestId={detailId} onClose={() => setDetailId(null)} />}
      {showExport && (
        <ExportModal
          requestIds={Array.from(selected)}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat: add App shell, Dashboard, FilterPanel, and RequestTable"
```

---

### Task 11: Frontend — hooks and remaining components

**Files:**
- Create: `src/hooks/useRequests.js`
- Create: `src/hooks/useDebug.js`
- Create: `src/hooks/useAnnotations.js`
- Create: `src/hooks/useExport.js`
- Create: `src/components/DetailDrawer.jsx`
- Create: `src/components/ExportModal.jsx`
- Create: `src/components/ExportHistory.jsx`

- [ ] **Step 1: Write src/hooks/useRequests.js**

```javascript
import { useState, useEffect, useCallback, useRef } from 'react';
import { requestsApi } from '../lib/api.js';

export function useRequests(filters) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cursor, setCursor] = useState(null);
  const filtersRef = useRef(filters);

  useEffect(() => {
    filtersRef.current = filters;
    setRows([]);
    setCursor(null);
    setError(null);
    fetch(true);
  }, [JSON.stringify(filters)]);

  const fetch = useCallback(async (reset = false) => {
    setLoading(true);
    try {
      const params = { ...filtersRef.current, limit: 50 };
      if (!reset && cursor) params.cursor = cursor;
      const res = await requestsApi.list(params);
      setRows((prev) => (reset ? res.data : [...prev, ...res.data]));
      setCursor(res.nextCursor);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [cursor]);

  const loadMore = useCallback(() => fetch(false), [fetch]);

  return { rows, loading, error, loadMore, hasMore: !!cursor };
}
```

- [ ] **Step 2: Write src/hooks/useDebug.js**

```javascript
import { useState, useEffect } from 'react';
import { requestsApi } from '../lib/api.js';

export function useDebug(requestId) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    requestsApi.debug(requestId)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [requestId]);

  return { data, loading, error };
}
```

- [ ] **Step 3: Write src/hooks/useAnnotations.js**

```javascript
import { useState, useEffect, useCallback } from 'react';
import { annotationsApi } from '../lib/api.js';

export function useAnnotations(requestId) {
  const [annotations, setAnnotations] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await annotationsApi.list({ requestId });
    setAnnotations(res.data);
    setLoading(false);
  }, [requestId]);

  useEffect(() => { load(); }, [load]);

  const add = useCallback(async (tag, note) => {
    const res = await annotationsApi.create({ requestId, tag, note });
    setAnnotations((prev) => [res, ...prev]);
  }, [requestId]);

  const remove = useCallback(async (id) => {
    await annotationsApi.delete(id);
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return { annotations, loading, add, remove };
}
```

- [ ] **Step 4: Write src/hooks/useExport.js**

```javascript
import { useState, useCallback } from 'react';
import { exportApi } from '../lib/api.js';

export function useExport() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const create = useCallback(async (requestIds, sessionName) => {
    setLoading(true);
    setError(null);
    try {
      const res = await exportApi.create(requestIds, sessionName);
      setResult(res);
      return res;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const download = useCallback((exportId) => {
    window.location.href = exportApi.download(exportId);
  }, []);

  return { loading, result, error, create, download };
}
```

- [ ] **Step 5: Write src/components/DetailDrawer.jsx**

```javascript
import React, { useState } from 'react';
import { useDebug } from '../hooks/useDebug.js';
import { useAnnotations } from '../hooks/useAnnotations.js';

const TABS = ['Summary', 'Raw Request', 'Raw Response', 'Errors', 'Annotations'];

export default function DetailDrawer({ requestId, onClose }) {
  const [tab, setTab] = useState('Summary');
  const { data, loading } = useDebug(requestId);
  const { annotations, add, remove } = useAnnotations(requestId);
  const [tagInput, setTagInput] = useState('');
  const [noteInput, setNoteInput] = useState('');

  return (
    <div className="fixed inset-y-0 right-0 w-full md:w-[600px] bg-white shadow-2xl z-50 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h2 className="font-bold font-mono text-sm">{requestId}</h2>
        <button className="text-slate-500 hover:text-slate-900" onClick={onClose}>✕</button>
      </div>
      <div className="flex border-b">
        {TABS.map((t) => (
          <button
            key={t}
            className={`flex-1 py-2 text-sm ${tab === t ? 'border-b-2 border-slate-900 font-semibold' : 'text-slate-500'}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto p-4">
        {loading && <div className="text-slate-500">Loading...</div>}
        {!loading && tab === 'Summary' && data?.usage && (
          <div className="space-y-2 text-sm">
            <p><strong>Provider:</strong> {data.usage.provider}</p>
            <p><strong>Model:</strong> {data.usage.canonical_model_name}</p>
            <p><strong>Status:</strong> {data.usage.response_status}</p>
            <p><strong>Input tokens:</strong> {data.usage.tokens_input}</p>
            <p><strong>Output tokens:</strong> {data.usage.tokens_output}</p>
            <p><strong>Duration:</strong> {data.usage.duration_ms}ms</p>
            <p><strong>Attempt count:</strong> {data.usage.attempt_count}</p>
            <p><strong>Finish reason:</strong> {data.usage.finish_reason}</p>
          </div>
        )}
        {!loading && tab === 'Raw Request' && (
          <pre className="text-xs bg-slate-50 p-3 rounded overflow-auto max-h-[60vh]">
            {JSON.stringify(JSON.parse(data?.debug?.raw_request || '{}'), null, 2)}
          </pre>
        )}
        {!loading && tab === 'Raw Response' && (
          <pre className="text-xs bg-slate-50 p-3 rounded overflow-auto max-h-[60vh]">
            {JSON.stringify(JSON.parse(data?.debug?.raw_response || '{}'), null, 2)}
          </pre>
        )}
        {!loading && tab === 'Errors' && (
          <div className="space-y-3">
            {data?.errors?.length === 0 && <p className="text-slate-500">No errors recorded.</p>}
            {data?.errors?.map((e, i) => (
              <div key={i} className="bg-red-50 p-3 rounded text-sm">
                <p className="font-semibold text-red-800">{e.error_message}</p>
                <pre className="text-xs mt-2 overflow-auto">{e.error_stack}</pre>
              </div>
            ))}
          </div>
        )}
        {!loading && tab === 'Annotations' && (
          <div>
            <div className="flex gap-2 mb-3">
              <input
                className="border rounded px-2 py-1 text-sm flex-1"
                placeholder="Tag"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
              />
              <input
                className="border rounded px-2 py-1 text-sm flex-[2]"
                placeholder="Note"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
              />
              <button
                className="bg-slate-900 text-white px-3 py-1 rounded text-sm"
                onClick={() => { add(tagInput, noteInput); setTagInput(''); setNoteInput(''); }}
              >
                Add
              </button>
            </div>
            {annotations.map((a) => (
              <div key={a.id} className="flex justify-between items-start bg-slate-50 p-2 rounded mb-2 text-sm">
                <div>
                  {a.tag && <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs mr-2">{a.tag}</span>}
                  <span>{a.note}</span>
                </div>
                <button className="text-red-500 text-xs" onClick={() => remove(a.id)}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Write src/components/ExportModal.jsx**

```javascript
import React, { useState } from 'react';
import { useExport } from '../hooks/useExport.js';

export default function ExportModal({ requestIds, onClose }) {
  const { loading, result, error, create, download } = useExport();
  const [sessionName, setSessionName] = useState('');

  const handleExport = async () => {
    const res = await create(requestIds, sessionName);
    if (res?.exportId) download(res.exportId);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h2 className="text-lg font-bold mb-4">Export Debug Bundle</h2>
        <p className="text-sm text-slate-600 mb-3">{requestIds.length} requests selected</p>
        <input
          className="border rounded px-3 py-2 w-full mb-4"
          placeholder="Session name (optional)"
          value={sessionName}
          onChange={(e) => setSessionName(e.target.value)}
        />
        {error && <div className="bg-red-100 text-red-800 p-2 rounded text-sm mb-3">{error}</div>}
        {result && (
          <div className="bg-green-100 text-green-800 p-2 rounded text-sm mb-3">
            Bundle ready! Downloading...
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="px-3 py-2 rounded border hover:bg-slate-50" onClick={onClose}>Cancel</button>
          <button
            className="px-3 py-2 rounded bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
            onClick={handleExport}
            disabled={loading}
          >
            {loading ? 'Generating...' : 'Export & Download'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Write src/components/ExportHistory.jsx**

```javascript
import React, { useState, useEffect } from 'react';
import { exportApi } from '../lib/api.js';

function formatBytes(b) {
  if (!b) return '-';
  return `${(b / 1024).toFixed(1)} KB`;
}

export default function ExportHistory() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    exportApi.history().then((res) => {
      setRows(res.data);
      setLoading(false);
    });
  }, []);

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h2 className="text-lg font-bold mb-4">Export History</h2>
      {loading && <div className="text-slate-500">Loading...</div>}
      {!loading && rows.length === 0 && <div className="text-slate-500">No exports yet.</div>}
      <table className="w-full text-sm">
        <thead className="bg-slate-100">
          <tr>
            <th className="px-3 py-2 text-left">Session</th>
            <th className="px-3 py-2 text-left">Requests</th>
            <th className="px-3 py-2 text-left">Size</th>
            <th className="px-3 py-2 text-left">Created</th>
            <th className="px-3 py-2 text-left">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t">
              <td className="px-3 py-2">{row.session_name || 'Untitled'}</td>
              <td className="px-3 py-2">{row.request_ids?.length || 0}</td>
              <td className="px-3 py-2">{formatBytes(row.file_size)}</td>
              <td className="px-3 py-2">{new Date(row.created_at).toLocaleString()}</td>
              <td className="px-3 py-2">
                <a
                  className="text-blue-600 hover:underline"
                  href={`/api/export/${row.session_id}`}
                >
                  Download
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 8: Commit**

```bash
git add src/
git commit -m "feat: add frontend hooks, DetailDrawer, ExportModal, and ExportHistory"
```

---

### Task 12: Frontend tests and Tailwind config

**Files:**
- Create: `tailwind.config.js`
- Create: `postcss.config.js`
- Create: `tests/frontend/FilterPanel.test.jsx`

- [ ] **Step 1: Write tailwind.config.js**

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
```

- [ ] **Step 2: Write postcss.config.js**

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 3: Write tests/frontend/FilterPanel.test.jsx**

```javascript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FilterPanel from '../../src/components/FilterPanel.jsx';

describe('FilterPanel', () => {
  it('calls onFilter with provider value', () => {
    const onFilter = vi.fn();
    render(<FilterPanel onFilter={onFilter} />);
    fireEvent.change(screen.getByPlaceholderText('Provider'), { target: { value: 'openai' } });
    fireEvent.click(screen.getByText('Apply Filters'));
    expect(onFilter).toHaveBeenCalledWith(expect.objectContaining({ provider: 'openai' }));
  });
});
```

- [ ] **Step 4: Run frontend test to verify it passes**

```bash
npx vitest run tests/frontend/FilterPanel.test.jsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tailwind.config.js postcss.config.js tests/
git commit -m "test: add Tailwind config and frontend component tests"
```

---

### Task 13: Dockerfile and production build verification

**Files:**
- Create: `Dockerfile`
- Modify: `package.json` (add `build` and `start` scripts if not present — they should already be there from Task 1)

- [ ] **Step 1: Write Dockerfile**

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Runtime
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/config.js ./config.js
COPY --from=builder /app/db ./db
COPY --from=builder /app/routes ./routes
COPY --from=builder /app/services ./services
COPY --from=builder /app/middleware ./middleware
EXPOSE 4002
CMD ["node", "server.js"]
```

- [ ] **Step 2: Verify local build works**

```bash
npm install
npm run build
```

Expected: `dist/` directory created with compiled frontend assets.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "feat: add multi-stage Dockerfile"
```

---

### Task 14: Integration verification and deployment to AI01

**Files:**
- None new — verification and deployment steps.

- [ ] **Step 1: Run all backend tests**

```bash
npx vitest run tests/backend/
```

Expected: All tests PASS.

- [ ] **Step 2: Run all frontend tests**

```bash
npx vitest run tests/frontend/
```

Expected: All tests PASS.

- [ ] **Step 3: Start local dev stack**

```bash
npm run migrate
npm run dev
```

In another terminal:
```bash
curl http://localhost:4002/health
```

Expected: `{"status":"ok","plexusDb":true,"appDb":true}` (assuming local Postgres is running via docker-compose).

- [ ] **Step 4: Deploy to AI01**

```bash
rsync -avz --exclude node_modules --exclude dist --exclude .git . user001@ai01:~/plexus-debug-ui/
ssh user001@ai01 "cd ~/plexus-debug-ui && podman-compose up -d --build"
```

- [ ] **Step 5: Verify on AI01**

```bash
ssh user001@ai01 "curl -s http://localhost:4002/health"
```

Expected: `{"status":"ok","plexusDb":true,"appDb":true}`

- [ ] **Step 6: Commit any final changes**

```bash
git commit -m "chore: final integration and deployment verification" || true
```

---

## Self-Review

### 1. Spec coverage

| Spec Section | Plan Task |
|---|---|
| Read-only Plexus DB queries | Task 2 (db/plexus.js), Task 6 (routes/requests.js, routes/debug.js) |
| App DB schema | Task 2 (db/migrate.js) |
| Filter by provider/model/apiKey/status/date/error | Task 6 (buildRequestsQuery), Task 10 (FilterPanel.jsx) |
| Debug detail view | Task 6 (routes/debug.js), Task 11 (DetailDrawer.jsx) |
| ZIP bundle export | Task 4 (services/zipExporter.js), Task 7 (routes/export.js), Task 11 (ExportModal.jsx) |
| ZIP format (manifest, raw, errors, report.html) | Task 4 (createDebugBundle) |
| Annotations CRUD | Task 7 (routes/annotations.js), Task 11 (useAnnotations.js, DetailDrawer.jsx) |
| Export history | Task 7 (routes/export.js), Task 11 (ExportHistory.jsx) |
| Admin key auth | Task 3 (middleware/auth.js), Task 8 (server.js), Task 9 (api.js) |
| Health check | Task 8 (routes/health.js) |
| Error handling (DB unavailable, large payloads, timeout) | Task 2 (pool error handlers), Task 4 (MAX_INLINE_SIZE), Task 6 (503/partial) |
| Deployment (Dockerfile, docker-compose, AI01) | Task 1 (docker-compose.yml), Task 13 (Dockerfile), Task 14 (deploy) |
| Testing (backend unit, integration, frontend unit) | Task 4, 6, 12 (tests/) |

**No gaps found.**

### 2. Placeholder scan

- No TBD, TODO, or "implement later" found.
- No vague "add error handling" or "write tests" without code.
- All code blocks contain complete, copy-pasteable code.

### 3. Type consistency

- `request_id` is consistently `text` (PostgreSQL) and `string` (JavaScript).
- `created_at` is consistently `bigint` in Plexus and `timestamptz` in app DB — this is intentional per spec.
- API response shapes match between backend routes and frontend hooks.
- All route file names match their mount paths in `server.js`.

**No inconsistencies found.**
