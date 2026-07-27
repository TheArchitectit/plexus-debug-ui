import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { queryApp } from '../db/app.js';
import { plexusApi } from '../services/plexusApi.js';
import { createDebugBundle } from '../services/zipExporter.js';
import { extractToolCalls } from '../services/toolParser.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';

const DEFAULT_USER = 'admin';
const router = Router();

router.use(requireAuth);

router.post('/', asyncHandler(async (req, res) => {
  const { requestIds, sessionName } = req.body;
  if (!Array.isArray(requestIds) || requestIds.length === 0) {
    return res.status(400).json({ error: 'requestIds array required' });
  }
  if (requestIds.length > 1000) {
    return res.status(400).json({ error: 'Maximum 1000 requests per export' });
  }

  const requests = await Promise.all(
    requestIds.map(async (id) => {
      try {
        const [usage, debug, errors] = await Promise.all([
          // The usage list API supports an exact requestId filter (there is no
          // single-usage endpoint). Note: listErrors is a client-side filter
          // over the recent-errors window, so older errors for a request may
          // have aged out of that window.
          plexusApi.listUsage({ requestId: id, limit: '1' }).then((r) => r.data[0] || null).catch(() => null),
          plexusApi.getDebugLog(id).catch(() => null),
          plexusApi.listErrors(id).catch(() => []),
        ]);
        if (!usage) return null;
        const error = errors[0] || null;
        return {
          ...usage,
          raw_request: debug?.raw_request,
          raw_response: debug?.raw_response,
          transformed_request: debug?.transformed_request,
          transformed_response: debug?.transformed_response,
          error_message: error?.error_message,
          error_stack: error?.error_stack,
          error_details: error?.details,
          toolCalls: extractToolCalls(debug?.raw_request, debug?.raw_response),
        };
      } catch {
        return null;
      }
    })
  );

  const valid = requests.filter(Boolean);

  const ts = Date.now();
  const fileName = `plexus-debug-${ts}.zip`;
  const outPath = path.join(config.exportsDir, fileName);

  const bundle = await createDebugBundle(valid, outPath);

  const [session] = await queryApp(
    `INSERT INTO debug_sessions (name, filters, created_by) VALUES ($1, $2, $3) RETURNING id`,
    [sessionName || `Export ${new Date().toISOString()}`, JSON.stringify({ requestIds }), DEFAULT_USER]
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
  const resolvedPath = path.resolve(record.file_path);
  const exportsDir = path.resolve(config.exportsDir);
  if (!resolvedPath.startsWith(exportsDir)) {
    return res.status(403).json({ error: 'Invalid file path' });
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
