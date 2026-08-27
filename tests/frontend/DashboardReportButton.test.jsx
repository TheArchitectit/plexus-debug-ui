import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Dashboard from '../../src/components/Dashboard.jsx';

// Dashboard's data surface is the useRequests hook + FilterPanel's filtersApi.
vi.mock('../../src/hooks/useRequests.js', () => ({
  useRequests: () => ({
    rows: [{ request_id: 'a', provider: 'neuralwatt' }, { request_id: 'b', provider: 'gmi' }],
    loading: false, error: null, loadMore: () => {}, hasMore: false,
  }),
}));
vi.mock('../../src/lib/api.js', () => ({
  filtersApi: { list: () => Promise.resolve({ providers: [], models: [], apiKeys: [], finishReasons: [] }) },
}));

describe('Dashboard provider-report button', () => {
  it('exists, is disabled with no selection, enabled after select-all', () => {
    render(<Dashboard />);
    const btn = screen.getByRole('button', { name: /provider report/i });
    expect(btn.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Select all rows'));
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain('2');
  });

  it('opening the modal shows a notes field with the 4000-char counter', () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByLabelText('Select all rows'));
    fireEvent.click(screen.getByRole('button', { name: /provider report/i }));
    expect(screen.getByLabelText(/summary notes/i)).toBeTruthy();
    expect(screen.getByText(/^0 \/ 4000$/)).toBeTruthy();
  });
});
