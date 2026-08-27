import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

vi.mock('../../services/plexusApi.js', () => ({
  plexusApi: { listUsage: vi.fn() },
}));

import { plexusApi } from '../../services/plexusApi.js';
import filtersRouter from '../../routes/filters.js';

function startApp() {
  const app = express();
  app.use('/api/filters', filtersRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/api/filters` });
    });
  });
}

const ROWS = [
  {
    provider: 'gmi',
    incoming_model_alias: 'claude-sonnet-5',
    canonical_model_name: 'claude-sonnet-4-6',
    api_key: 'hubmode',
    finish_reason: 'stop',
  },
  {
    provider: 'Charm lundrog',
    incoming_model_alias: 'claude-opus-4-6',
    canonical_model_name: 'claude-opus-4-6',
    api_key: 'hubmode',
    finish_reason: 'tool_use',
  },
  // pending row: no provider/alias yet
  { provider: null, incoming_model_alias: null, canonical_model_name: null, api_key: null, finish_reason: null },
];

describe('GET /api/filters', () => {
  beforeEach(() => {
    plexusApi.listUsage.mockReset().mockResolvedValue({ data: ROWS, total: 3 });
  });

  it('lists models by incoming alias so the value matches the incomingModelAlias filter', async () => {
    const { server, url } = await startApp();
    try {
      const res = await fetch(url);
      const body = await res.json();
      // Filter requests arrive as incomingModelAlias=<value>, so the dropdown
      // must offer what the client requested, not the canonicalized name.
      expect(body.models).toContain('claude-sonnet-5');
      expect(body.models).not.toContain('claude-sonnet-4-6');
    } finally {
      server.close();
    }
  });

  it('falls back to canonical name when the alias is missing', async () => {
    plexusApi.listUsage.mockResolvedValue({
      data: [{ provider: 'p', incoming_model_alias: null, canonical_model_name: 'm-canon', api_key: null, finish_reason: null }],
      total: 1,
    });
    const { server, url } = await startApp();
    try {
      const body = await (await fetch(url)).json();
      expect(body.models).toEqual(['m-canon']);
    } finally {
      server.close();
    }
  });

  it('lists providers, apiKeys and finishReasons without nulls', async () => {
    const { server, url } = await startApp();
    try {
      const body = await (await fetch(url)).json();
      expect(body.providers).toEqual(['Charm lundrog', 'gmi']);
      expect(body.apiKeys).toEqual(['hubmode']);
      expect(body.finishReasons).toEqual(['stop', 'tool_use']);
    } finally {
      server.close();
    }
  });
});
