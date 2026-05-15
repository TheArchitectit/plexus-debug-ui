import React, { useState } from 'react';
import { useDebug } from '../hooks/useDebug.js';
import { useAnnotations } from '../hooks/useAnnotations.js';

const TABS = ['Summary', 'Retries', 'Raw Request', 'Raw Response', 'Errors', 'Annotations'];

function safeJsonPrettify(str) {
  if (!str) return '{}';
  if (typeof str !== 'string') return JSON.stringify(str, null, 2);
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

function RetryChain({ retryHistory, attemptCount, finalProvider, finalModel, allProviders }) {
  if (!retryHistory) {
    return <p className="text-slate-500">No retry data recorded.</p>;
  }

  let attempts = [];
  try {
    attempts = typeof retryHistory === 'string' ? JSON.parse(retryHistory) : retryHistory;
  } catch {
    return <p className="text-red-600">Could not parse retry history.</p>;
  }

  if (!Array.isArray(attempts) || attempts.length === 0) {
    return <p className="text-slate-500">No retry data recorded.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-4 text-sm mb-3">
        <span><strong>Total attempts:</strong> {attemptCount}</span>
        <span><strong>Final provider:</strong> {finalProvider || '-'}</span>
        <span><strong>Final model:</strong> {finalModel || '-'}</span>
      </div>
      {allProviders && (
        <p className="text-xs text-slate-500"><strong>All attempted:</strong> {allProviders}</p>
      )}
      <div className="space-y-2">
        {attempts.map((a, i) => (
          <div
            key={i}
            className={`border rounded p-3 text-sm ${a.status === 'success' ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'}`}
          >
            <div className="flex justify-between items-center mb-1">
              <span className="font-semibold">Attempt {a.index || i + 1}</span>
              <div className="flex gap-2">
                <span className={`px-2 py-0.5 rounded text-xs ${a.status === 'success' ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}`}>
                  {a.status}
                </span>
                {a.retryable && (
                  <span className="px-2 py-0.5 rounded text-xs bg-amber-200 text-amber-800">
                    retryable
                  </span>
                )}
              </div>
            </div>
            <p><strong>Provider:</strong> {a.provider} &nbsp; <strong>Model:</strong> {a.model}</p>
            <p><strong>API type:</strong> {a.apiType || '-'}</p>
            <p><strong>Reason:</strong> {a.reason || '-'}</p>
            {a.statusCode && <p><strong>Status code:</strong> {a.statusCode}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DetailDrawer({ requestId, onClose }) {
  const [tab, setTab] = useState('Summary');
  const { data, loading } = useDebug(requestId);
  const { annotations, add, remove } = useAnnotations(requestId);
  const [tagInput, setTagInput] = useState('');
  const [noteInput, setNoteInput] = useState('');

  const u = data?.usage;

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
            className={`flex-1 py-2 text-sm whitespace-nowrap ${tab === t ? 'border-b-2 border-slate-900 font-semibold' : 'text-slate-500'}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto p-4">
        {loading && <div className="text-slate-500">Loading...</div>}
        {!loading && tab === 'Summary' && u && (
          <div className="space-y-2 text-sm">
            <p><strong>Provider:</strong> {u.provider}</p>
            <p><strong>Model:</strong> {u.canonical_model_name}</p>
            <p><strong>Selected model:</strong> {u.selected_model_name}</p>
            <p><strong>Status:</strong> {u.response_status}</p>
            <p><strong>Input tokens:</strong> {u.tokens_input}</p>
            <p><strong>Output tokens:</strong> {u.tokens_output}</p>
            <p><strong>Duration:</strong> {u.duration_ms}ms</p>
            <p><strong>Attempt count:</strong> {u.attempt_count}</p>
            <p><strong>Finish reason:</strong> {u.finish_reason}</p>
            <p><strong>Tools defined:</strong> {u.tools_defined}</p>
            <p><strong>Tool calls:</strong> {u.tool_calls_count}</p>
            <p><strong>Message count:</strong> {u.message_count}</p>
          </div>
        )}
        {!loading && tab === 'Retries' && u && (
          <RetryChain
            retryHistory={u.retry_history}
            attemptCount={u.attempt_count}
            finalProvider={u.final_attempt_provider}
            finalModel={u.final_attempt_model}
            allProviders={u.all_attempted_providers}
          />
        )}
        {!loading && tab === 'Raw Request' && (
          <pre className="text-xs bg-slate-50 p-3 rounded overflow-auto max-h-[60vh]">
            {safeJsonPrettify(data?.debug?.raw_request)}
          </pre>
        )}
        {!loading && tab === 'Raw Response' && (
          <pre className="text-xs bg-slate-50 p-3 rounded overflow-auto max-h-[60vh]">
            {safeJsonPrettify(data?.debug?.raw_response)}
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
