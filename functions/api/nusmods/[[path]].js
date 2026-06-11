const NUSMODS_BASE = 'https://api.nusmods.com/v2';
const TTL_SECONDS = 24 * 60 * 60;

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    if (request.method !== 'GET') {
        return json({ error: 'Method not allowed' }, 405);
    }

    if (!env.NUSMODS_CACHE) {
        return json({ error: 'NUSMODS_CACHE KV binding is not configured' }, 500);
    }

    if (url.pathname === '/api/nusmods/status') {
        return json({ enabled: true, cacheTtlSeconds: TTL_SECONDS });
    }

    if (url.pathname === '/api/nusmods/module-list') {
        const year = url.searchParams.get('year') || '';
        if (!validYear(year)) return json({ error: 'Invalid academic year' }, 400);

        return cachedJson(
            env.NUSMODS_CACHE,
            `module-list:${year}`,
            `${NUSMODS_BASE}/${year}/moduleList.json`,
        );
    }

    if (url.pathname === '/api/nusmods/module-info') {
        const year = url.searchParams.get('year') || '';
        const code = (url.searchParams.get('code') || '').toUpperCase();
        if (!validYear(year) || !validModuleCode(code)) {
            return json({ error: 'Invalid module request' }, 400);
        }

        return cachedJson(
            env.NUSMODS_CACHE,
            `module-info:${year}:${code}`,
            `${NUSMODS_BASE}/${year}/modules/${encodeURIComponent(code)}.json`,
        );
    }

    return json({ error: 'Not found' }, 404);
}

async function cachedJson(cache, key, upstreamUrl) {
    const cached = await cache.get(key);
    if (cached) {
        return json(JSON.parse(cached), 200, 'HIT');
    }

    const upstream = await fetch(upstreamUrl, {
        headers: { 'User-Agent': 'gpa-calculator-cloudflare-cache/1.0' },
    });

    if (!upstream.ok) {
        return json({ error: 'NUSMods API request failed' }, 502);
    }

    const data = await upstream.json();
    await cache.put(key, JSON.stringify(data), { expirationTtl: TTL_SECONDS });
    return json(data, 200, 'MISS');
}

function json(data, status = 200, cacheStatus = null) {
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
    };

    if (cacheStatus) headers['X-NUSMods-Cache'] = cacheStatus;

    return new Response(JSON.stringify(data), { status, headers });
}

function validYear(year) {
    return /^\d{4}-\d{4}$/.test(year);
}

function validModuleCode(code) {
    return /^[A-Z0-9]{2,12}$/.test(code);
}
