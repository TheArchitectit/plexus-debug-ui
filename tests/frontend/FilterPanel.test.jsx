import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FilterPanel from '../../src/components/FilterPanel.jsx';

describe('FilterPanel', () => {
  it('calls onFilter with provider value', () => {
    const onFilter = vi.fn();
    render(<FilterPanel onFilter={onFilter} />);
    fireEvent.change(screen.getByPlaceholderText('Provider'), { target: { value: 'openai' } });
    fireEvent.click(screen.getByText('Apply Filters'));
    expect(onFilter).toHaveBeenCalledWith(expect.objectContaining({ provider: 'openai' }));
  });
});
