import { Router } from 'express';
import { plexusApi } from '../services/plexusApi.js';
import { appPool } from '../db/app.js';

const router = Router();

router.get('/', async (req, res) => {
  const plexusOk = await plexusApi.getHealth();
  let appOk = false;

  try {
    await appPool.query('SELECT 1');
    appOk = true;
  } catch {
    appOk = false;
  }

  const status = plexusOk && appOk ? 200 : 503;
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate, proxy-revalidate');
  res.status(status).json({ status: plexusOk && appOk ? 'ok' : 'degraded', plexusApi: plexusOk, appDb: appOk });
});

export default router;
