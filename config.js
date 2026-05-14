import fs from 'fs';
import yaml from 'js-yaml';

function loadAdminKey() {
  const file = process.env.ADMIN_KEY_FILE || '/app/config/plexus.yaml';
  try {
    const doc = yaml.load(fs.readFileSync(file, 'utf8'));
    const key = doc?.adminKey || process.env.ADMIN_KEY;
    if (!key) {
      throw new Error('ADMIN_KEY is required: set ADMIN_KEY env var or adminKey in the yaml config file.');
    }
    return key;
  } catch {
    const key = process.env.ADMIN_KEY;
    if (!key) {
      throw new Error('ADMIN_KEY is required: set ADMIN_KEY env var or adminKey in the yaml config file.');
    }
    return key;
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
  plexusDbUrl: requireEnv('PLEXUS_DATABASE_URL'),
  appDbUrl: requireEnv('APP_DATABASE_URL'),
  adminKey: loadAdminKey(),
  exportsDir: process.env.EXPORTS_DIR || './exports',
};