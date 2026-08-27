import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FilterPanel from '../../src/components/FilterPanel.jsx';
import { filtersApi } from '../../src/lib/api.js';

vi.mock('../../src/lib/api.js', () => ({
  filtersApi: { list: vi.fn() },
}));

describe('FilterPanel', () => {
  beforeEach(() => {
    filtersApi.list.mockReset().mockResolvedValue({
      providers: ['openai', 'anthropic'],
      models: ['claude-sonnet-5'],
      apiKeys: [],
      finishReasons: [],
    });
  });

  it('calls onFilter with the provider chosen from the searchable dropdown', async () => {
    const onFilter = vi.fn();
    render(<FilterPanel onFilter={onFilter} />);

    const input = screen.getByPlaceholderText('Provider');
    await waitFor(() => expect(filtersApi.list).toHaveBeenCalled());
    // Wait until the fetched options have been applied to state.
    fireEvent.focus(input);
    await screen.findByText('openai');
    fireEvent.mouseDown(screen.getByText('openai'));
    fireEvent.click(screen.getByText('Apply Filters'));

    expect(onFilter).toHaveBeenCalledWith(expect.objectContaining({ provider: 'openai' }));
  });

  it('filters dropdown options by typed search text', async () => {
    const onFilter = vi.fn();
    render(<FilterPanel onFilter={onFilter} />);

    const input = screen.getByPlaceholderText('Provider');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'anth' } });

    expect(await screen.findByText('anthropic')).toBeTruthy();
    expect(screen.queryByText('openai')).toBeNull();
  });
});
