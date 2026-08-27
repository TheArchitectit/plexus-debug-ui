import fs from 'fs';
import path from 'path';
import { appPool } from './app.js';

const schemaSQL = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS debug_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT,
    filters JSONB NOT NULL DEFAULT '{}',
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS request_annotations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id TEXT NOT NULL,
    tag TEXT,
    note TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_annotations_request_id ON request_annotations(request_id);
CREATE INDEX IF NOT EXISTS idx_annotations_tag ON request_annotations(tag);

CREATE TABLE IF NOT EXISTS export_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES debug_sessions(id) ON DELETE SET NULL,
    request_ids TEXT[] NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_export_history_created_at ON export_history(created_at);

CREATE TABLE IF NOT EXISTS parsed_tool_calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id TEXT NOT NULL,
    tool_name TEXT,
    arguments JSONB,
    result JSONB,
    error TEXT,
    parsed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parsed_tool_calls_request_id ON parsed_tool_calls(request_id);

CREATE TABLE IF NOT EXISTS provider_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider TEXT,
    notes TEXT,
    request_ids TEXT[] NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_provider_reports_created_at ON provider_reports(created_at);
`;

async function migrate() {
  const client = await appPool.connect();
  try {
    await client.query(schemaSQL);
    console.log('Migration complete');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await appPool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate();
}
