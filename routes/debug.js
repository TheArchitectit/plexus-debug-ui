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
