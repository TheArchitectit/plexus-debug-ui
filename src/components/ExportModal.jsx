import React, { useState } from 'react';
import { useExport } from '../hooks/useExport.js';

export default function ExportModal({ requestIds, onClose }) {
  const { loading, result, error, create, download } = useExport();
  const [sessionName, setSessionName] = useState('');

  const handleExport = async () => {
    const res = await create(requestIds, sessionName);
    if (res?.exportId) download(res.exportId);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h2 className="text-lg font-bold mb-4">Export Debug Bundle</h2>
        <p className="text-sm text-slate-600 mb-3">{requestIds.length} requests selected</p>
        <input
          className="border rounded px-3 py-2 w-full mb-4"
          placeholder="Session name (optional)"
          value={sessionName}
          onChange={(e) => setSessionName(e.target.value)}
        />
        {error && <div className="bg-red-100 text-red-800 p-2 rounded text-sm mb-3">{error}</div>}
        {result && (
          <div className="bg-green-100 text-green-800 p-2 rounded text-sm mb-3">
            Bundle ready! Downloading...
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="px-3 py-2 rounded border hover:bg-slate-50" onClick={onClose}>Cancel</button>
          <button
            className="px-3 py-2 rounded bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
            onClick={handleExport}
            disabled={loading}
          >
            {loading ? 'Generating...' : 'Export & Download'}
          </button>
        </div>
      </div>
    </div>
  );
}
