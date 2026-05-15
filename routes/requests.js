import { Router } from 'express';
import { plexusApi } from '../services/plexusApi.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const filters = {
    provider: req.query.provider,
    model: req.query.model,
    apiKey: req.query.apiKey,
    status: req.query.status,
    dateFrom: req.query.dateFrom,
    dateTo: req.query.dateTo,
    finishReason: req.query.finishReason,
    limit: req.query.limit || '50',
    cursor: req.query.cursor,
  };

  try {
    const result = await plexusApi.listUsage(filters);

    if (req.query.hasError === 'true') {
      result.data = result.data.filter((r) => r.has_error);
    } else if (req.query.hasError === 'false') {
      result.data = result.data.filter((r) => !r.has_error);
    }
    if (req.query.hasRetry === 'true') {
      result.data = result.data.filter((r) => Number(r.attempt_count) > 1);
    } else if (req.query.hasRetry === 'false') {
      result.data = result.data.filter((r) => Number(r.attempt_count) <= 1);
    }

    const nextCursor = result.data.length > 0
      ? result.data[result.data.length - 1].created_at
      : null;

    res.json({ data: result.data, nextCursor, total: result.total });
  } catch (err) {
    err.status = 503;
    err.partial = true;
    throw err;
  }
}));

export default router;
