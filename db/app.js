import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export const appPool = new Pool({
  connectionString: config.appDbUrl,
  max: 10,
});

appPool.on('error', (err) => {
  console.error('App DB pool error:', err);
});

export async function queryApp(sql, params) {
  const client = await appPool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}
