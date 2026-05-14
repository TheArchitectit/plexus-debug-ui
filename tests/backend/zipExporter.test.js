import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
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
  });
});
