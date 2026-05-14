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
