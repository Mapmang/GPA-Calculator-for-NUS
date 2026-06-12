// Shared between the Cloudflare Worker (src/worker.js) and the build-time
// fetch script (scripts/fetch-modules.mjs).

export const NUSMODS_API = 'https://api.nusmods.com/v2';

// NUS academic years run August–July. Returns candidates newest-first so the
// caller can fall back when the upcoming AY has not been published yet.
export function acadYearCandidates(now = new Date()) {
  // Singapore time (UTC+8, no DST)
  const sgt = new Date(now.getTime() + 8 * 3600 * 1000);
  const y = sgt.getUTCFullYear();
  const startYear = sgt.getUTCMonth() + 1 >= 8 ? y : y - 1;
  return [
    `${startYear}-${startYear + 1}`,
    `${startYear - 1}-${startYear}`,
  ];
}

// moduleInfo.json -> compact payload served to the browser.
// Each module becomes [code, title, credits, suAllowed(0|1)].
export function compactModuleInfo(rawModules, acadYear) {
  const modules = rawModules
    .filter((m) => m && m.moduleCode)
    .map((m) => [
      m.moduleCode,
      m.title || '',
      Number.parseFloat(m.moduleCredit) || 0,
      m.attributes && m.attributes.su === true ? 1 : 0,
    ]);
  modules.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return {
    v: 1,
    acadYear: acadYear.replace('-', '/'),
    fetchedAt: new Date().toISOString(),
    count: modules.length,
    modules,
  };
}

// Fetches moduleInfo.json for the newest available academic year and returns
// the compact payload. Throws if no candidate year is available.
export async function fetchAndCompact(fetchImpl = fetch) {
  const errors = [];
  for (const ay of acadYearCandidates()) {
    const res = await fetchImpl(`${NUSMODS_API}/${ay}/moduleInfo.json`, {
      headers: { 'User-Agent': 'nus-gpa-calculator (github.com cloudflare worker)' },
    });
    if (!res.ok) {
      errors.push(`${ay}: HTTP ${res.status}`);
      continue;
    }
    const raw = await res.json();
    return compactModuleInfo(raw, ay);
  }
  throw new Error(`NUSMods moduleInfo.json unavailable (${errors.join(', ')})`);
}
