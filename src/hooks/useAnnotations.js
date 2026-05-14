import { useState, useEffect, useCallback } from 'react';
import { annotationsApi } from '../lib/api.js';

export function useAnnotations(requestId) {
  const [annotations, setAnnotations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await annotationsApi.list({ requestId });
        if (!cancelled) setAnnotations(res.data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [requestId]);

  const add = useCallback(async (tag, note) => {
    const res = await annotationsApi.create({ requestId, tag, note });
    setAnnotations((prev) => [res, ...prev]);
  }, [requestId]);

  const remove = useCallback(async (id) => {
    await annotationsApi.delete(id);
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return { annotations, loading, error, add, remove };
}
