import React, { useState, useCallback } from 'react';

export default function FilterPanel({ onFilter }) {
  const [filters, setFilters] = useState({
    provider: '',
    model: '',
    apiKey: '',
    status: '',
    dateFrom: '',
    dateTo: '',
    hasError: '',
  });

  const update = useCallback((key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
  }, []);

  const apply = useCallback(() => {
    const clean = Object.fromEntries(
      Object.entries(filters).filter(([, v]) => v !== '')
    );
    onFilter(clean);
  }, [filters, onFilter]);

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
      <input
        className="border rounded px-2 py-1"
        placeholder="Provider"
        value={filters.provider}
        onChange={(e) => update('provider', e.target.value)}
      />
      <input
        className="border rounded px-2 py-1"
        placeholder="Model"
        value={filters.model}
        onChange={(e) => update('model', e.target.value)}
      />
      <input
        className="border rounded px-2 py-1"
        placeholder="API Key"
        value={filters.apiKey}
        onChange={(e) => update('apiKey', e.target.value)}
      />
      <select
        className="border rounded px-2 py-1"
        value={filters.status}
        onChange={(e) => update('status', e.target.value)}
      >
        <option value="">All statuses</option>
        <option value="success">Success</option>
        <option value="error">Error</option>
      </select>
      <input
        type="date"
        className="border rounded px-2 py-1"
        value={filters.dateFrom}
        onChange={(e) => update('dateFrom', e.target.value)}
      />
      <input
        type="date"
        className="border rounded px-2 py-1"
        value={filters.dateTo}
        onChange={(e) => update('dateTo', e.target.value)}
      />
      <select
        className="border rounded px-2 py-1"
        value={filters.hasError}
        onChange={(e) => update('hasError', e.target.value)}
      >
        <option value="">All</option>
        <option value="true">Has error</option>
        <option value="false">No error</option>
      </select>
      <button
        className="bg-slate-900 text-white rounded px-3 py-1 hover:bg-slate-800"
        onClick={apply}
      >
        Apply Filters
      </button>
    </div>
  );
}
