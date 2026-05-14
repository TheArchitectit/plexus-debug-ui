import React, { useState, useEffect } from 'react';
import { exportApi } from '../lib/api.js';

function formatBytes(b) {
  if (!b) return '-';
  return `${(b / 1024).toFixed(1)} KB`;
}

export default function ExportHistory() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    exportApi.history().then((res) => {
      setRows(res.data);
      setLoading(false);
    });
  }, []);

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h2 className="text-lg font-bold mb-4">Export History</h2>
      {loading && <div className="text-slate-500">Loading...</div>}
      {!loading && rows.length === 0 && <div className="text-slate-500">No exports yet.</div>}
      <table className="w-full text-sm">
        <thead className="bg-slate-100">
          <tr>
            <th className="px-3 py-2 text-left">Session</th>
            <th className="px-3 py-2 text-left">Requests</th>
            <th className="px-3 py-2 text-left">Size</th>
            <th className="px-3 py-2 text-left">Created</th>
            <th className="px-3 py-2 text-left">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t">
              <td className="px-3 py-2">{row.session_name || 'Untitled'}</td>
              <td className="px-3 py-2">{row.request_ids?.length || 0}</td>
              <td className="px-3 py-2">{formatBytes(row.file_size)}</td>
              <td className="px-3 py-2">{new Date(row.created_at).toLocaleString()}</td>
              <td className="px-3 py-2">
                <a
                  className="text-blue-600 hover:underline"
                  href={`/api/export/${row.session_id}`}
                >
                  Download
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
