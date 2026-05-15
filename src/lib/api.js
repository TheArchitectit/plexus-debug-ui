function getAdminKey() {
  return localStorage.getItem('plexusAdminKey') || '';
}

async function api(path, options = {}) {
  const url = path.startsWith('http') ? path : `/api${path}`;
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAdminKey()}`,
        ...options.headers,
      },
    });
  } catch (networkErr) {
    throw new Error(`Network error: ${networkErr.message}`);
  }

  if (res.status === 401 && !options._retry) {
    const key = prompt('Enter admin key:');
    if (key) {
      localStorage.setItem('plexusAdminKey', key);
      return api(path, { ...options, _retry: true });
    }
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export const filtersApi = {
  list: () => api('/filters'),
};

export const requestsApi = {
  list: (filters) => {
    const qs = new URLSearchParams(filters).toString();
    return api(`/requests?${qs}`);
  },
  debug: (requestId) => api(`/debug/${requestId}`),
};

export const exportApi = {
  create: (requestIds, sessionName) => api('/export', {
    method: 'POST',
    body: JSON.stringify({ requestIds, sessionName }),
  }),
  download: (exportId) => `/api/export/${exportId}`,
  history: () => api('/export'),
};

export async function downloadExport(exportId) {
  const res = await fetch(`/api/export/${exportId}`, {
    headers: { 'Authorization': `Bearer ${getAdminKey()}` },
  });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `plexus-debug-${exportId}.zip`;
  a.click();
  window.URL.revokeObjectURL(url);
}

export const annotationsApi = {
  list: (params) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/annotations?${qs}`);
  },
  create: (data) => api('/annotations', { method: 'POST', body: JSON.stringify(data) }),
  delete: (id) => api(`/annotations/${id}`, { method: 'DELETE' }),
};
