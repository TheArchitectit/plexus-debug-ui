import { Router } from 'express';
import { plexusApi } from '../services/plexusApi.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

router.get('/:requestId', asyncHandler(async (req, res) => {
  const { requestId } = req.params;

  const [usage, debug, errors, perf] = await Promise.all([
    plexusApi.listUsage({ limit: '1' }).then((r) => r.data.find((u) => u.request_id === requestId)).catch(() => null),
    plexusApi.getDebugLog(requestId).catch(() => null),
    plexusApi.listErrors(requestId).catch(() => []),
    plexusApi.listPerformance().then((r) => r.find((p) => p.request_id === requestId)).catch(() => null),
  ]);

  res.json({ usage, debug, errors, performance: perf });
}));

export default router;
