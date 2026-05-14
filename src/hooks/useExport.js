import { useState, useCallback } from 'react';
import { exportApi, downloadExport } from '../lib/api.js';

export function useExport() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const create = useCallback(async (requestIds, sessionName) => {
    setLoading(true);
    setError(null);
    try {
      const res = await exportApi.create(requestIds, sessionName);
      setResult(res);
      return res;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const download = useCallback((exportId) => {
    downloadExport(exportId);
  }, []);

  return { loading, result, error, create, download };
}
