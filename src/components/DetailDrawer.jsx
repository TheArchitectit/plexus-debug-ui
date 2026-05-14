import React, { useState } from 'react';
import { useDebug } from '../hooks/useDebug.js';
import { useAnnotations } from '../hooks/useAnnotations.js';

const TABS = ['Summary', 'Raw Request', 'Raw Response', 'Errors', 'Annotations'];

export default function DetailDrawer({ requestId, onClose }) {
  const [tab, setTab] = useState('Summary');
  const { data, loading } = useDebug(requestId);
  const { annotations, add, remove } = useAnnotations(requestId);
  const [tagInput, setTagInput] = useState('');
  const [noteInput, setNoteInput] = useState('');

  return (
    <div className="fixed inset-y-0 right-0 w-full md:w-[600px] bg-white shadow-2xl z-50 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h2 className="font-bold font-mono text-sm">{requestId}</h2>
        <button className="text-slate-500 hover:text-slate-900" onClick={onClose}>✕</button>
      </div>
      <div className="flex border-b">
        {TABS.map((t) => (
          <button
            key={t}
            className={`flex-1 py-2 text-sm ${tab === t ? 'border-b-2 border-slate-900 font-semibold' : 'text-slate-500'}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto p-4">
        {loading && <div className="text-slate-500">Loading...</div>}
        {!loading && tab === 'Summary' && data?.usage && (
          <div className="space-y-2 text-sm">
            <p><strong>Provider:</strong> {data.usage.provider}</p>
            <p><strong>Model:</strong> {data.usage.canonical_model_name}</p>
            <p><strong>Status:</strong> {data.usage.response_status}</p>
            <p><strong>Input tokens:</strong> {data.usage.tokens_input}</p>
            <p><strong>Output tokens:</strong> {data.usage.tokens_output}</p>
            <p><strong>Duration:</strong> {data.usage.duration_ms}ms</p>
            <p><strong>Attempt count:</strong> {data.usage.attempt_count}</p>
            <p><strong>Finish reason:</strong> {data.usage.finish_reason}</p>
          </div>
        )}
        {!loading && tab === 'Raw Request' && (
          <pre className="text-xs bg-slate-50 p-3 rounded overflow-auto max-h-[60vh]">
            {JSON.stringify(JSON.parse(data?.debug?.raw_request || '{}'), null, 2)}
          </pre>
        )}
        {!loading && tab === 'Raw Response' && (
          <pre className="text-xs bg-slate-50 p-3 rounded overflow-auto max-h-[60vh]">
            {JSON.stringify(JSON.parse(data?.debug?.raw_response || '{}'), null, 2)}
          </pre>
        )}
        {!loading && tab === 'Errors' && (
          <div className="space-y-3">
            {data?.errors?.length === 0 && <p className="text-slate-500">No errors recorded.</p>}
            {data?.errors?.map((e, i) => (
              <div key={i} className="bg-red-50 p-3 rounded text-sm">
                <p className="font-semibold text-red-800">{e.error_message}</p>
                <pre className="text-xs mt-2 overflow-auto">{e.error_stack}</pre>
              </div>
            ))}
          </div>
        )}
        {!loading && tab === 'Annotations' && (
          <div>
            <div className="flex gap-2 mb-3">
              <input
                className="border rounded px-2 py-1 text-sm flex-1"
                placeholder="Tag"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
              />
              <input
                className="border rounded px-2 py-1 text-sm flex-[2]"
                placeholder="Note"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
              />
              <button
                className="bg-slate-900 text-white px-3 py-1 rounded text-sm"
                onClick={() => { add(tagInput, noteInput); setTagInput(''); setNoteInput(''); }}
              >
                Add
              </button>
            </div>
            {annotations.map((a) => (
              <div key={a.id} className="flex justify-between items-start bg-slate-50 p-2 rounded mb-2 text-sm">
                <div>
                  {a.tag && <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs mr-2">{a.tag}</span>}
                  <span>{a.note}</span>
                </div>
                <button className="text-red-500 text-xs" onClick={() => remove(a.id)}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
