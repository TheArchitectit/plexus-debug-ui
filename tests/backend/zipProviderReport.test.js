import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import unzipper from 'unzipper';
import { createProviderReportBundle } from '../../services/zipExporter.js';

async function listEntries(zipPath) {
  const dir = await unzipper.Open.file(zipPath);
  return Object.fromEntries(
    await Promise.all(dir.files.map(async (f) => [
      f.path, (await f.buffer()).toString('utf8'),
    ])),
  );
}

describe('createProviderReportBundle', () => {
  it('writes report.md plus each raw file', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-'));
    const out = path.join(tmp, 'r.zip');
    const res = await createProviderReportBundle(
      { reportMd: '# hi\n', rawFiles: { 'raw/a_response.sse': 'data: x\n', 'raw/a_request.json': '{}' } },
      out,
    );
    expect(res.filePath).toBe(out);
    expect(res.fileSize).toBeGreaterThan(0);
    const entries = await listEntries(out);
    expect(entries['report.md']).toBe('# hi\n');
    expect(entries['raw/a_response.sse']).toBe('data: x\n');
    expect(entries['raw/a_request.json']).toBe('{}');
    fs.rmSync(tmp, { recursive: true });
  });
});
