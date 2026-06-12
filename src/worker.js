import { fetchAndCompact } from './compact.mjs';

const KV_KEY = 'modules:v1';

// Seconds until shortly after the next 6:00 AM SGT refresh (06:10 SGT), so
// browser/edge caches expire just after new data lands.
function secondsUntilNextRefresh(now = new Date()) {
  const sgtMs = now.getTime() + 8 * 3600 * 1000;
  const sgt = new Date(sgtMs);
  const next = new Date(sgtMs);
  next.setUTCHours(6, 10, 0, 0);
  if (next <= sgt) next.setUTCDate(next.getUTCDate() + 1);
  return Math.max(60, Math.floor((next.getTime() - sgt.getTime()) / 1000));
}

async function refreshModuleData(env) {
  const payload = await fetchAndCompact(fetch);
  const body = JSON.stringify(payload);
  if (env.MODULES_KV) {
    await env.MODULES_KV.put(KV_KEY, body);
  }
  return body;
}

async function readSnapshotAsset(env, request) {
  if (!env.ASSETS) return null;
  const url = new URL('/data/modules.json', request.url);
  const res = await env.ASSETS.fetch(new Request(url));
  if (!res.ok) return null;
  return res.text();
}

function jsonResponse(body, source, maxAge) {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${maxAge}, stale-while-revalidate=3600`,
      'X-Data-Source': source,
    },
  });
}

async function handleModules(request, env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/modules', request.url), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const maxAge = secondsUntilNextRefresh();
  let body = null;
  let source = 'kv';

  if (env.MODULES_KV) {
    try {
      body = await env.MODULES_KV.get(KV_KEY);
    } catch {
      body = null;
    }
  }
  if (!body) {
    source = 'snapshot';
    body = await readSnapshotAsset(env, request);
  }
  if (!body) {
    // Last resort: no KV data and no bundled snapshot. Fetch live once and
    // store it so subsequent requests are served from KV. (On the Workers
    // free plan this may exceed the 10 ms CPU limit — see README.)
    try {
      source = 'live';
      body = await refreshModuleData(env);
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Module data unavailable', detail: String(err) }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  const res = jsonResponse(body, source, maxAge);
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

async function handleRefresh(request, env) {
  // Manual refresh hook, e.g. for testing: POST /api/refresh with the
  // REFRESH_KEY secret (npx wrangler secret put REFRESH_KEY).
  if (!env.REFRESH_KEY) {
    return new Response(JSON.stringify({ error: 'REFRESH_KEY secret not configured' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const provided = request.headers.get('Authorization') || '';
  if (provided !== `Bearer ${env.REFRESH_KEY}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const body = await refreshModuleData(env);
  const meta = JSON.parse(body);
  return new Response(
    JSON.stringify({ ok: true, acadYear: meta.acadYear, count: meta.count, fetchedAt: meta.fetchedAt }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/modules' && request.method === 'GET') {
      return handleModules(request, env, ctx);
    }
    if (pathname === '/api/refresh' && request.method === 'POST') {
      return handleRefresh(request, env);
    }
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Everything else is served from static assets by the assets binding.
    return env.ASSETS.fetch(request);
  },

  // Runs once per day at 22:00 UTC = 6:00 AM Singapore time. This is the only
  // place the NUSMods API is called on a schedule, so the upstream API is hit
  // exactly once per day globally.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      refreshModuleData(env).catch((err) => {
        console.error('Scheduled NUSMods refresh failed:', err);
      }),
    );
  },
};
