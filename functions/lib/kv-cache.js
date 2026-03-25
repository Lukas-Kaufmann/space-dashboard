/**
 * Two-key stale-while-revalidate cache pattern for Cloudflare KV.
 *
 * KV deletes keys after expirationTtl — you can't read expired keys.
 * We use two keys:
 *   data:<key>  — the payload (long TTL, 24h)
 *   fresh:<key> — freshness sentinel (short TTL, caller-specified)
 *
 * On cache miss: fetch upstream, store both keys.
 * On upstream failure: serve stale data if available.
 */
export async function cachedFetch(env, key, ttlSeconds, fetchFn) {
  const dataKey = `data:${key}`;
  const freshKey = `fresh:${key}`;

  // Check freshness sentinel
  const isFresh = await env.CACHE.get(freshKey);
  if (isFresh) {
    const data = await env.CACHE.get(dataKey);
    if (data) {
      return { data: JSON.parse(data), status: 'HIT' };
    }
  }

  try {
    const fresh = await fetchFn();
    const json = JSON.stringify(fresh);

    // Store data with long TTL (survives sentinel expiry for stale reads)
    await env.CACHE.put(dataKey, json, { expirationTtl: 86400 });
    // Store freshness sentinel with short TTL
    await env.CACHE.put(freshKey, '1', { expirationTtl: ttlSeconds });

    return { data: fresh, status: 'MISS' };
  } catch (err) {
    // Upstream failed — serve stale data if available
    const stale = await env.CACHE.get(dataKey);
    if (stale) {
      return { data: JSON.parse(stale), status: 'STALE' };
    }
    throw err;
  }
}
