import { useState, useEffect, useCallback, useRef } from 'react';
import { requestsApi } from '../lib/api.js';

export function useRequests(filters) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cursor, setCursor] = useState(null);
  const filtersRef = useRef(filters);
  const requestIdRef = useRef(0);

  useEffect(() => {
    filtersRef.current = filters;
    setRows([]);
    setCursor(null);
    setError(null);
    fetch(true);
  }, [JSON.stringify(filters)]);

  const fetch = useCallback(async (reset = false) => {
    const reqId = ++requestIdRef.current;
    setLoading(true);
    try {
      const params = { ...filtersRef.current, limit: 50 };
      if (!reset && cursor) params.cursor = cursor;
      const res = await requestsApi.list(params);
      if (reqId !== requestIdRef.current) return;
      setRows((prev) => (reset ? res.data : [...prev, ...res.data]));
      setCursor(res.nextCursor);
    } catch (err) {
      if (reqId !== requestIdRef.current) return;
      setError(err.message);
    } finally {
      if (reqId === requestIdRef.current) setLoading(false);
    }
  }, [cursor]);

  const loadMore = useCallback(() => fetch(false), [fetch]);

  return { rows, loading, error, loadMore, hasMore: !!cursor };
}
