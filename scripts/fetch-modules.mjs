// Build-time data snapshot: fetches NUSMods moduleInfo.json, compacts it and
// writes public/data/modules.json so the deployed site always has module data
// even before the daily cron has run (or on plans where the cron cannot run).
//
// Usage: node scripts/fetch-modules.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAndCompact } from '../src/compact.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outFile = join(root, 'public', 'data', 'modules.json');

const payload = await fetchAndCompact(fetch);
await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, JSON.stringify(payload));

const suCount = payload.modules.filter((m) => m[3] === 1).length;
console.log(
  `Wrote ${outFile}\n` +
    `  acadYear: ${payload.acadYear}\n` +
    `  modules:  ${payload.count} (${suCount} with S/U option)\n` +
    `  fetched:  ${payload.fetchedAt}`,
);
