import { Router } from 'express';
import { plexusPool } from '../db/plexus.js';
import { appPool } from '../db/app.js';

const router = Router();

router.get('/', async (req, res) => {
  let plexusOk = false;
  let appOk = false;

  try {
    await plexusPool.query('SELECT 1');
    plexusOk = true;
  } catch {
    plexusOk = false;
  }

  try {
    await appPool.query('SELECT 1');
    appOk = true;
  } catch {
    appOk = false;
  }

  const status = plexusOk && appOk ? 200 : 503;
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate, proxy-revalidate');
  res.status(status).json({ status: plexusOk && appOk ? 'ok' : 'degraded', plexusDb: plexusOk, appDb: appOk });
});

export default router;
