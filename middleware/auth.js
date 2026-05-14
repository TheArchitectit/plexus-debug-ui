import { timingSafeEqual, createHmac } from 'crypto';
import { config } from '../config.js';

function secureCompare(a, b) {
  const hashA = createHmac('sha256', 'dummy').update(a).digest();
  const hashB = createHmac('sha256', 'dummy').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!secureCompare(token, config.adminKey)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
