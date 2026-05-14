import { Router } from 'express';
import { queryApp } from '../db/app.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/auth.js';

const DEFAULT_USER = 'admin';
const router = Router();

router.use(requireAuth);

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
    [requestId, tag || null, note || null, DEFAULT_USER]
  );
  res.status(201).json(row);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await queryApp(`DELETE FROM request_annotations WHERE id = $1`, [req.params.id]);
  res.status(204).send();
}));

export default router;
