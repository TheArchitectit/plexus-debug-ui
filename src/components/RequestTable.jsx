import React from 'react';

function formatDate(ts) {
  if (!ts) return '-';
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return '-';
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export default function RequestTable({ rows, selected, onSelect, onSelectAll, onRowClick }) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.request_id));

  return (
    <div className="bg-white rounded-lg shadow overflow-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-100 sticky top-0">
          <tr>
            <th className="px-3 py-2 text-left">
              <input
                type="checkbox"
                aria-label="Select all rows"
                checked={allSelected}
                onChange={(e) => onSelectAll(e.target.checked)}
              />
            </th>
            <th className="px-3 py-2 text-left">Request ID</th>
            <th className="px-3 py-2 text-left">Provider</th>
            <th className="px-3 py-2 text-left">Model</th>
            <th className="px-3 py-2 text-left">API Key</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-right">Context</th>
            <th className="px-3 py-2 text-right">Tools</th>
            <th className="px-3 py-2 text-left">Finish</th>
            <th className="px-3 py-2 text-right">Duration</th>
            <th className="px-3 py-2 text-left">Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const retried = Number(row.attempt_count) > 1;
            const badFinish = row.finish_reason === 'error' || row.finish_reason === 'length' || row.finish_reason === 'max_tokens';
            return (
              <tr
                key={row.request_id}
                className={`border-t hover:bg-slate-50 cursor-pointer ${retried ? 'bg-amber-50' : ''} ${badFinish ? 'bg-red-50' : ''}`}
                onClick={() => onRowClick(row)}
              >
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(row.request_id)}
                    onChange={(e) => onSelect(row.request_id, e.target.checked)}
                  />
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {row.request_id?.slice(0, 12)}...
                  <div className="flex gap-1 mt-0.5">
                    {retried && (
                      <span className="bg-amber-100 text-amber-800 px-1.5 py-0 rounded text-[10px] font-semibold">
                        {row.attempt_count} attempts
                      </span>
                    )}
                    {row.has_error && (
                      <span className="bg-red-100 text-red-800 px-1.5 py-0 rounded text-[10px] font-semibold">
                        error
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">{row.provider}</td>
                <td className="px-3 py-2">{row.canonical_model_name || row.incoming_model_alias}</td>
                <td className="px-3 py-2">{row.api_key}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${row.response_status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {row.response_status}
                  </span>
                </td>
                <td className="px-3 py-2 text-right text-xs">
                  <span>{row.tokens_input || 0}</span>
                  <span className="text-slate-400">→</span>
                  <span>{row.tokens_output || 0}</span>
                </td>
                <td className="px-3 py-2 text-right text-xs">
                  {row.tool_calls_count > 0 ? (
                    <span>{row.tool_calls_count}<span className="text-slate-400">/{row.tools_defined || 0}</span></span>
                  ) : (
                    <span className="text-slate-300">-</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className={`px-1.5 py-0.5 rounded ${
                    badFinish ? 'bg-red-100 text-red-700' :
                    row.finish_reason === 'tool_calls' || row.finish_reason === 'tool_use' ? 'bg-blue-100 text-blue-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>
                    {row.finish_reason || '-'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">{row.duration_ms}ms</td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">{formatDate(row.start_time || row.date)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
