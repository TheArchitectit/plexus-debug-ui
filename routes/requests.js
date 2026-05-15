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
  } else if (filters.hasError === 'false') {
    conditions.push(`NOT EXISTS (SELECT 1 FROM inference_errors e WHERE e.request_id = request_usage.request_id)`);
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
           tools_defined, tool_calls_count, message_count, finish_reason,
           (EXISTS (SELECT 1 FROM inference_errors e WHERE e.request_id = request_usage.request_id)) as has_error
    FROM request_usage
    ${where} ${cursorClause ? (where ? cursorClause.replace('AND', 'AND') : `WHERE ${cursorClause.replace('AND', '')}`) : ''}
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
