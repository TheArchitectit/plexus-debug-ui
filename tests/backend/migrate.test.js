import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// migrate.js runs SQL on import side-effects only under a real pool; read the
// schema as text to assert coverage without a database.
const schema = fs.readFileSync(
  path.join(process.cwd(), 'db/migrate.js'),
  'utf8',
);

describe('db/migrate.js schema', () => {
  it('creates the provider_reports table idempotently', () => {
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS provider_reports/);
    expect(schema).toMatch(/request_ids TEXT\[\] NOT NULL/);
    expect(schema).toMatch(/file_path TEXT NOT NULL/);
    expect(schema).toMatch(/idx_provider_reports_created_at/);
  });
});
