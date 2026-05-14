const ADMIN_KEY = localStorage.getItem('plexusAdminKey') || '';

async function api(path, options = {}) {
  const url = path.startsWith('http') ? path : `/api${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_KEY}`,
      ...options.headers,
    },
  });

  if (res.status === 401) {
    const key = prompt('Enter admin key:');
    if (key) {
      localStorage.setItem('plexusAdminKey', key);
      return api(path, options);
    }
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

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

export const annotationsApi = {
  list: (params) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/annotations?${qs}`);
  },
  create: (data) => api('/annotations', { method: 'POST', body: JSON.stringify(data) }),
  delete: (id) => api(`/annotations/${id}`, { method: 'DELETE' }),
};
