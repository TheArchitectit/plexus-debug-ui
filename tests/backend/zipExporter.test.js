import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import unzipper from 'unzipper';
import { createDebugBundle } from '../../services/zipExporter.js';

describe('zipExporter', () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plexus-test-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('creates a zip with manifest and request files', async () => {
    const requests = [
      {
        request_id: 'req-1',
        provider: 'openai',
        model: 'gpt-4o',
        raw_request: '{"messages":[]}',
        raw_response: '{"choices":[]}',
        error: null,
      },
    ];
    const outPath = path.join(tmpDir, 'test.zip');
    const result = await createDebugBundle(requests, outPath);
    expect(fs.existsSync(outPath)).toBe(true);
    expect(result.filePath).toBe(outPath);
    expect(result.requestCount).toBe(1);

    const entries = [];
    await new Promise((resolve, reject) => {
      fs.createReadStream(outPath)
        .pipe(unzipper.Parse())
        .on('entry', (entry) => {
          entries.push(entry.path);
          entry.autodrain();
        })
        .on('close', resolve)
        .on('error', reject);
    });

    expect(entries).toContain('manifest.json');
    expect(entries).toContain('requests/req-1.json');
    expect(entries).toContain('raw/req-1_request.json');
    expect(entries).toContain('raw/req-1_response.json');
    expect(entries).toContain('report.html');
  });
});
