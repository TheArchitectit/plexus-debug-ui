import React, { useState, useCallback, useMemo } from 'react';
import FilterPanel from './FilterPanel.jsx';
import RequestTable from './RequestTable.jsx';
import DetailDrawer from './DetailDrawer.jsx';
import ExportModal from './ExportModal.jsx';
import { useRequests } from '../hooks/useRequests.js';

export default function Dashboard() {
  const [filters, setFilters] = useState({});
  const [selected, setSelected] = useState(new Set());
  const [detailId, setDetailId] = useState(null);
  const [showExport, setShowExport] = useState(false);

  const { rows, loading, error, loadMore, hasMore } = useRequests(filters);

  const filteredRows = useMemo(() => {
    const term = (filters.search || '').toLowerCase().trim();
    if (!term) return rows;
    return rows.filter((r) =>
      (r.request_id || '').toLowerCase().includes(term) ||
      (r.provider || '').toLowerCase().includes(term) ||
      (r.canonical_model_name || '').toLowerCase().includes(term) ||
      (r.incoming_model_alias || '').toLowerCase().includes(term) ||
      (r.api_key || '').toLowerCase().includes(term) ||
      (r.finish_reason || '').toLowerCase().includes(term)
    );
  }, [rows, filters.search]);

  const selectedRows = filteredRows.filter((r) => selected.has(r.request_id));

  const onSelect = useCallback((id, checked) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const onSelectAll = useCallback((checked) => {
    setSelected(checked ? new Set(filteredRows.map((r) => r.request_id)) : new Set());
  }, [filteredRows]);

  return (
    <div>
      <FilterPanel onFilter={setFilters} />
      {error && <div role="alert" className="bg-red-100 text-red-800 p-3 rounded mb-4">{error}</div>}
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm text-slate-600">
          {filteredRows.length} requests shown
          {filters.search && ` (filtered from ${rows.length})`}
        </span>
        <div className="flex gap-2">
          <button
            className="bg-slate-900 text-white px-3 py-1 rounded text-sm hover:bg-slate-800 disabled:opacity-50"
            disabled={selected.size === 0}
            onClick={() => setShowExport(true)}
          >
            Export {selected.size} selected
          </button>
          {hasMore && (
            <button
              className="border border-slate-300 px-3 py-1 rounded text-sm hover:bg-slate-50"
              onClick={loadMore}
            >
              Load more
            </button>
          )}
        </div>
      </div>
      <RequestTable
        rows={filteredRows}
        selected={selected}
        onSelect={onSelect}
        onSelectAll={onSelectAll}
        onRowClick={setDetailId}
      />
      {loading && <div className="text-center py-4 text-slate-500">Loading...</div>}
      {detailId && <DetailDrawer requestId={detailId} onClose={() => setDetailId(null)} />}
      {showExport && (
        <ExportModal
          requestIds={Array.from(selected)}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}
