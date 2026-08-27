import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReportsView from '../../src/components/ReportsView.jsx';
import { reportsApi, downloadReport } from '../../src/lib/api.js';
import { MAX_REPORT_REQUESTS } from '../../services/providerReport.js';

vi.mock('../../src/lib/api.js', () => ({
  reportsApi: { create: vi.fn(), history: vi.fn() },
  downloadReport: vi.fn(),
}));

describe('ReportsView', () => {
  beforeEach(() => {
    reportsApi.history.mockResolvedValue({
      data: [{ id: 'r1', provider: 'neuralwatt', request_ids: ['a'], file_size: 1000, created_at: '2026-08-27T15:00:00Z' }],
    });
    reportsApi.create.mockResolvedValue({ reportId: 'r2', downloadUrl: '/api/reports/r2', fileSize: 10 });
    downloadReport.mockResolvedValue(undefined);
  });

  it('renders the create form and history', async () => {
    render(<ReportsView />);
    expect(screen.getByLabelText(/request ids/i)).toBeTruthy();
    expect(screen.getByLabelText(/summary notes/i)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('neuralwatt')).toBeTruthy());
  });

  it('creates a report from pasted ids and triggers download', async () => {
    render(<ReportsView />);
    fireEvent.change(screen.getByLabelText(/request ids/i), { target: { value: 'id-a\nid-b, id-c' } });
    fireEvent.change(screen.getByLabelText(/summary notes/i), { target: { value: 'broken output' } });
    fireEvent.click(screen.getByRole('button', { name: /create report/i }));
    await waitFor(() => expect(reportsApi.create).toHaveBeenCalledWith(['id-a', 'id-b', 'id-c'], 'broken output'));
    expect(downloadReport).toHaveBeenCalledWith('r2');
  });

  it('blocks create and warns when over the request cap', async () => {
    render(<ReportsView />);
    const ids = Array.from({ length: MAX_REPORT_REQUESTS + 1 }, (_, i) => 'id' + i).join('\n');
    fireEvent.change(screen.getByLabelText(/request ids/i), { target: { value: ids } });
    const btn = screen.getByRole('button', { name: /create report/i });
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/at most 100/i)).toBeTruthy();
  });

  it('re-downloads from history', async () => {
    render(<ReportsView />);
    await waitFor(() => screen.getByText('neuralwatt'));
    fireEvent.click(screen.getByRole('button', { name: /download/i }));
    expect(downloadReport).toHaveBeenCalledWith('r1');
  });
});
