import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export const plexusPool = new Pool({
  connectionString: config.plexusDbUrl,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

plexusPool.on('error', (err) => {
  console.error('Plexus DB pool error:', err);
});

export async function queryPlexus(sql, params) {
  const client = await plexusPool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}
