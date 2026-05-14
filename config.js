import fs from 'fs';
import yaml from 'js-yaml';

function loadAdminKey() {
  const file = process.env.ADMIN_KEY_FILE || '/app/config/plexus.yaml';
  try {
    const doc = yaml.load(fs.readFileSync(file, 'utf8'));
    return doc?.adminKey || process.env.ADMIN_KEY || 'change-me';
  } catch {
    return process.env.ADMIN_KEY || 'change-me';
  }
}

export const config = {
  port: parseInt(process.env.PORT || '4002', 10),
  plexusDbUrl: process.env.PLEXUS_DATABASE_URL || 'postgresql://plexus:plexus_pass@100.96.49.42:5435/plexus',
  appDbUrl: process.env.APP_DATABASE_URL || 'postgresql://app:app_pass@localhost:5432/debug_ui',
  adminKey: loadAdminKey(),
  exportsDir: process.env.EXPORTS_DIR || './exports',
};