import React, { useState } from 'react';
import Dashboard from './components/Dashboard.jsx';
import ExportHistory from './components/ExportHistory.jsx';

export default function App() {
  const [view, setView] = useState('dashboard');

  return (
    <div className="min-h-screen">
      <nav className="bg-slate-900 text-white px-4 py-3 flex gap-4 items-center">
        <h1 className="text-lg font-bold">Plexus Debug UI</h1>
        <button
          className={`px-3 py-1 rounded ${view === 'dashboard' ? 'bg-slate-700' : 'hover:bg-slate-800'}`}
          onClick={() => setView('dashboard')}
        >
          Dashboard
        </button>
        <button
          className={`px-3 py-1 rounded ${view === 'history' ? 'bg-slate-700' : 'hover:bg-slate-800'}`}
          onClick={() => setView('history')}
        >
          Export History
        </button>
      </nav>
      <main className="p-4 max-w-7xl mx-auto">
        {view === 'dashboard' && <Dashboard />}
        {view === 'history' && <ExportHistory />}
      </main>
    </div>
  );
}
