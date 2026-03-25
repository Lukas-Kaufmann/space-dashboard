/**
 * Shared fetch helpers for the space dashboard frontend.
 * All API calls go through our Worker proxy at /api/*.
 */

/**
 * Fetch JSON from our API proxy with timeout.
 * Returns { data, stale } where stale=true if served from expired cache.
 */
export async function fetchAPI(endpoint, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`/api/${endpoint}`, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `API ${res.status}`);
    }

    const data = await res.json();
    const stale = res.headers.get('X-Cache') === 'STALE';
    return { data, stale };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`Request to /api/${endpoint} timed out`);
    }
    throw err;
  }
}

/**
 * Fetch multiple endpoints in parallel with independent failure handling.
 * Returns an object keyed by endpoint name: { data, stale, error }.
 */
export async function fetchAll(endpoints) {
  const results = await Promise.allSettled(
    endpoints.map(ep => fetchAPI(ep))
  );

  const out = {};
  endpoints.forEach((ep, i) => {
    const r = results[i];
    if (r.status === 'fulfilled') {
      out[ep] = { data: r.value.data, stale: r.value.stale, error: null };
    } else {
      out[ep] = { data: null, stale: false, error: r.reason.message };
    }
  });

  return out;
}
