import { config } from '../config.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (token !== config.adminKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
