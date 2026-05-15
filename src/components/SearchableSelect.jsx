import React, { useState, useRef, useEffect } from 'react';

export default function SearchableSelect({ options, value, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = options.filter((o) =>
    o.toLowerCase().includes(search.toLowerCase())
  );

  const displayValue = value || '';

  return (
    <div className="relative" ref={ref}>
      <input
        className="border rounded px-2 py-1 w-full cursor-pointer"
        placeholder={placeholder}
        value={open ? search : displayValue}
        onChange={(e) => {
          if (!open) setOpen(true);
          setSearch(e.target.value);
          if (!e.target.value) onChange('');
        }}
        onFocus={() => {
          setOpen(true);
          setSearch('');
        }}
      />
      {open && (
        <ul className="absolute z-50 bg-white border rounded shadow-lg max-h-48 overflow-y-auto w-full mt-1">
          <li
            className="px-2 py-1 hover:bg-slate-100 cursor-pointer text-sm"
            onMouseDown={(e) => {
              e.preventDefault();
              onChange('');
              setSearch('');
              setOpen(false);
            }}
          >
            — Clear —
          </li>
          {filtered.map((opt) => (
            <li
              key={opt}
              className={`px-2 py-1 cursor-pointer text-sm truncate ${opt === value ? 'bg-slate-200' : 'hover:bg-slate-100'}`}
              title={opt}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(opt);
                setSearch('');
                setOpen(false);
              }}
            >
              {opt}
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-2 py-1 text-sm text-slate-400">No matches</li>
          )}
        </ul>
      )}
    </div>
  );
}
