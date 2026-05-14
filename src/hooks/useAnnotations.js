import { useState, useEffect, useCallback } from 'react';
import { annotationsApi } from '../lib/api.js';

export function useAnnotations(requestId) {
  const [annotations, setAnnotations] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await annotationsApi.list({ requestId });
    setAnnotations(res.data);
    setLoading(false);
  }, [requestId]);

  useEffect(() => { load(); }, [load]);

  const add = useCallback(async (tag, note) => {
    const res = await annotationsApi.create({ requestId, tag, note });
    setAnnotations((prev) => [res, ...prev]);
  }, [requestId]);

  const remove = useCallback(async (id) => {
    await annotationsApi.delete(id);
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return { annotations, loading, add, remove };
}
