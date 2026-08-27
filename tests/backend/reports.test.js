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
async function zipEntries(p) {
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
      const created = fs.readdirSync(config.exportsDir).filter((f) => f.endsWith('.zip'));
      expect(created.length).toBe(1);
      expect(created[0]).toMatch(/^provider-report-neuralwatt-\d{8}-\d{6}\.zip$/);
      expect(await zipEntries(path.join(config.exportsDir, created[0]))).toEqual(
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

  it('rejects a file_path outside exportsDir', async () => {
    config.exportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rptsec-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rptoutside-'));
    const secret = path.join(outsideDir, 'x.zip');
    fs.writeFileSync(secret, 'nope');
    queryApp.mockResolvedValueOnce([{ file_path: secret }]);
    const { server, base } = await startApp();
    try {
      const r = await fetch(base + '/rep-1');
      expect(r.status).toBe(403);
    } finally { server.close(); fs.rmSync(outsideDir, { recursive: true }); }
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
