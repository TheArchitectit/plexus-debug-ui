import fs from 'fs';
import yaml from 'js-yaml';

function loadAdminKey() {
  const envKey = process.env.ADMIN_KEY;
  if (envKey) return envKey;
  const file = process.env.ADMIN_KEY_FILE;
  if (!file) return null;
  try {
    const doc = yaml.load(fs.readFileSync(file, 'utf8'));
    return doc?.adminKey || null;
  } catch {
    return null;
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required.`);
  }
  return value;
}

export const config = {
  port: parseInt(process.env.PORT || '4002', 10),
  plexusApiUrl: process.env.PLEXUS_API_URL || 'http://host.docker.internal:4000',
  appDbUrl: requireEnv('APP_DATABASE_URL'),
  adminKey: loadAdminKey(),
  exportsDir: process.env.EXPORTS_DIR || './exports',
};