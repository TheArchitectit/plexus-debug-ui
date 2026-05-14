import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db/plexus.js', () => ({
  queryPlexus: vi.fn(),
}));

vi.mock('../../middleware/errorHandler.js', () => ({
  asyncHandler: (fn) => fn,
}));

import { buildRequestsQuery } from '../../routes/requests.js';

describe('buildRequestsQuery', () => {
  it('builds query with provider filter', () => {
    const { sql, params } = buildRequestsQuery({ provider: 'openai' });
    expect(sql).toContain('provider = $');
    expect(params).toContain('openai');
  });

  it('builds query with date range', () => {
    const { sql, params } = buildRequestsQuery({ dateFrom: '2024-01-01', dateTo: '2024-01-02' });
    expect(sql).toContain('created_at >=');
    expect(sql).toContain('created_at <=');
  });
});
