import { config } from '../config.js';

const BASE = config.plexusApiUrl.replace(/\/$/, '');
const ADMIN_KEY = config.adminKey;

async function api(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'x-admin-key': ADMIN_KEY,
      'Accept': 'application/json',
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Plexus API ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function camelToSnake(obj) {
  if (Array.isArray(obj)) return obj.map(camelToSnake);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [
        k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()),
        camelToSnake(v),
      ])
    );
  }
  return obj;
}

function buildQuery(filters) {
  const params = new URLSearchParams();
  const map = {
    provider: 'provider',
    model: 'incomingModelAlias',
    apiKey: 'apiKey',
    status: 'responseStatus',
    dateFrom: 'startDate',
    dateTo: 'endDate',
    requestId: 'requestId',
    hasError: null,
    hasRetry: null,
    finishReason: null,
  };
  for (const [k, v] of Object.entries(filters)) {
    if (v === '' || v == null) continue;
    if (k === 'limit') {
      params.set('limit', String(Math.min(parseInt(v, 10), 500)));
    } else if (k === 'cursor') {
      params.set('offset', v);
    } else if (map[k]) {
      params.set(map[k], v);
    } else if (k === 'finishReason') {
      params.set('finishReason', v);
    }
  }
  return params.toString();
}

export const plexusApi = {
  listUsage(filters) {
    const qs = buildQuery(filters);
    return api(`/v0/management/usage?${qs}`).then((res) => ({
      data: camelToSnake(res.data || []),
      total: res.total || 0,
      nextCursor: null,
    }));
  },

  getDebugLog(requestId) {
    return api(`/v0/management/debug/logs/${requestId}`).then(camelToSnake);
  },

  listErrors(requestId) {
    // The management errors endpoint ignores a requestId query param — it
    // only supports limit/offset — so filter client-side over recent errors.
    return api('/v0/management/errors?limit=500')
      .then((res) => camelToSnake(Array.isArray(res) ? res : res.data || []))
      .then((rows) => (requestId ? rows.filter((r) => r.request_id === requestId) : rows));
  },

  listPerformance() {
    return api('/v0/management/performance').then((res) => camelToSnake(Array.isArray(res) ? res : res.data || []));
  },

  getHealth() {
    return fetch(`${BASE}/health`, { headers: { 'x-admin-key': ADMIN_KEY } })
      .then((r) => r.ok)
      .catch(() => false);
  },
};
