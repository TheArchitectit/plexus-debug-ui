import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ReportsView from '../../src/components/ReportsView.jsx';
import { reportsApi, downloadReport } from '../../src/lib/api.js';

vi.mock('../../src/lib/api.js', () => ({
  reportsApi: { create: vi.fn(), history: vi.fn(), preview: vi.fn() },
  downloadReport: vi.fn(),
  filtersApi: { list: () => Promise.resolve({ providers: ['neuralwatt', 'big'], models: [], apiKeys: [], finishReasons: [] }) },
}));

describe('ReportsView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reportsApi.history.mockResolvedValue({
      data: [{ id: 'r1', provider: 'neuralwatt', request_ids: ['a'], file_size: 1000, created_at: '2026-08-27T15:00:00Z' }],
    });
    reportsApi.create.mockResolvedValue({ reportId: 'r2', downloadUrl: '/api/reports/r2', fileSize: 10 });
    reportsApi.preview.mockResolvedValue({ count: 3, overLimit: false, ids: ['a', 'b', 'c'] });
    downloadReport.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  // Advance past the debounced preview call, flushing microtasks after.
  async function runTimers(ms = 400) {
    vi.advanceTimersByTime(ms);
    for (let i = 0; i < 10; i++) await act(async () => {});
  }

  it('renders a criteria form and history', async () => {
    render(<ReportsView />);
    expect(screen.getByLabelText(/provider/i)).toBeTruthy();
    expect(screen.getByLabelText(/summary notes/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /create report/i })).toBeTruthy();
    await runTimers();
    expect(screen.getAllByText('neuralwatt').length).toBeGreaterThan(0);
  });

  it('create is disabled until at least one criterion is set', async () => {
    render(<ReportsView />);
    await runTimers(); // let dropdown options load
    expect(screen.getByRole('button', { name: /create report/i }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/^Provider$/), { target: { value: 'neuralwatt' } });
    expect(screen.getByRole('button', { name: /create report/i }).disabled).toBe(false);
  });

  it('previews the match count from criteria', async () => {
    render(<ReportsView />);
    await runTimers();
    fireEvent.change(screen.getByLabelText(/^Provider$/), { target: { value: 'neuralwatt' } });
    await runTimers();
    expect(reportsApi.preview).toHaveBeenCalledWith({ provider: 'neuralwatt' });
    expect(screen.getByText(/3 matching requests/i)).toBeTruthy();
  });

  it('warns when the preview is over the cap and blocks create', async () => {
    reportsApi.preview.mockResolvedValue({ count: 5000, overLimit: true, ids: [] });
    render(<ReportsView />);
    await runTimers();
    fireEvent.change(screen.getByLabelText(/^Provider$/), { target: { value: 'big' } });
    await runTimers();
    expect(screen.getByText(/too many/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /create report/i }).disabled).toBe(true);
  });

  it('creates a report from criteria and triggers download', async () => {
    render(<ReportsView />);
    await runTimers();
    fireEvent.change(screen.getByLabelText(/^Provider$/), { target: { value: 'neuralwatt' } });
    fireEvent.change(screen.getByLabelText(/^Status$/), { target: { value: 'error' } });
    fireEvent.change(screen.getByLabelText(/summary notes/i), { target: { value: 'broken output' } });
    await runTimers();
    fireEvent.click(screen.getByRole('button', { name: /create report/i }));
    await runTimers(0);
    expect(reportsApi.create).toHaveBeenCalledWith({
      filters: { provider: 'neuralwatt', status: 'error' },
      notes: 'broken output',
    });
    expect(downloadReport).toHaveBeenCalledWith('r2');
  });

  it('re-downloads from history', async () => {
    render(<ReportsView />);
    await runTimers();
    fireEvent.click(screen.getByRole('button', { name: /^download$/i }));
    expect(downloadReport).toHaveBeenCalledWith('r1');
  });
});
