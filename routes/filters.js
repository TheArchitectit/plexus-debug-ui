import { Router } from 'express';
import { plexusApi } from '../services/plexusApi.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const result = await plexusApi.listUsage({ limit: '500' });
  const rows = result.data || [];

  const providers = [...new Set(rows.map((r) => r.provider).filter(Boolean))].sort();
  const models = [...new Set(rows.map((r) => r.canonical_model_name || r.incoming_model_alias).filter(Boolean))].sort();
  const apiKeys = [...new Set(rows.map((r) => r.api_key).filter(Boolean))].sort();
  const finishReasons = [...new Set(rows.map((r) => r.finish_reason).filter(Boolean))].sort();

  res.json({ providers, models, apiKeys, finishReasons });
}));

export default router;
