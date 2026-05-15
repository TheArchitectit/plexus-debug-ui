import { Router } from 'express';
import { queryPlexus } from '../db/plexus.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const [providers, models, apiKeys, finishReasons] = await Promise.all([
    queryPlexus('SELECT DISTINCT provider FROM request_usage WHERE provider IS NOT NULL ORDER BY provider'),
    queryPlexus('SELECT DISTINCT canonical_model_name FROM request_usage WHERE canonical_model_name IS NOT NULL ORDER BY canonical_model_name'),
    queryPlexus('SELECT DISTINCT api_key FROM request_usage WHERE api_key IS NOT NULL ORDER BY api_key'),
    queryPlexus('SELECT DISTINCT finish_reason FROM request_usage WHERE finish_reason IS NOT NULL AND finish_reason != \'\' ORDER BY finish_reason'),
  ]);

  res.json({
    providers: providers.map((r) => r.provider),
    models: models.map((r) => r.canonical_model_name),
    apiKeys: apiKeys.map((r) => r.api_key),
    finishReasons: finishReasons.map((r) => r.finish_reason),
  });
}));

export default router;
