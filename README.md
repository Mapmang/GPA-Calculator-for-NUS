# NUS GPA Calculator

A clean, single-page NUS GPA / CAP calculator deployed on **Cloudflare Workers**.
Type a module code and its modular credits (MCs) and S/U eligibility are filled
in automatically from [NUSMods](https://api.nusmods.com/v2/) data. Credits stay
editable, and the S/U toggle is greyed out for modules that do not offer the
S/U option.

## How GPA is calculated

Same logic as the original Excel workbook:

| Grade | A+ / A | A− | B+ | B | B− | C+ | C | D+ | D | F |
|-------|--------|----|----|---|----|----|---|----|---|---|
| Points| 5.0    |4.5 |4.0 |3.5|3.0 |2.5 |2.0|1.5 |1.0| 0 |

- Quality points = grade points × MCs
- A module marked **S/U** is excluded from GPA entirely (numerator *and*
  denominator). The app shows whether it would convert to an **S** (C or
  better) or a **U**.
- Semester GPA = Σ quality points ÷ Σ counted MCs; cumulative GPA is the same
  sum across all eight semesters.
- One deliberate difference from the spreadsheet: a row only counts once a
  letter grade is selected (the sheet treated a graded-but-empty cell as 0
  points).

## NUSMods data — fetched once per day, globally

The NUSMods API is never called from the browser. The Worker keeps a compact
copy (code, title, MCs, S/U flag for ~20k modules) and serves it from
`/api/modules` with edge + browser caching that expires just after the daily
refresh. Three layers keep it fresh:

1. **Cron trigger** (`0 22 * * *` = **6:00 AM Singapore time**): the Worker
   downloads `moduleInfo.json` once and stores the compact version in KV.
   This is the only scheduled call to NUSMods — once per day, globally.
2. **Deploy-time snapshot**: `npm run deploy` first runs
   `scripts/fetch-modules.mjs`, which bakes `public/data/modules.json` into the
   static assets. `/api/modules` falls back to this snapshot whenever KV has no
   data (e.g. right after the first deploy, before the cron has ever run).
3. **Optional GitHub Action** (`.github/workflows/refresh-data.yml`): re-runs
   the snapshot + deploy daily at 6 AM SGT. See "Workers Free plan" below.

### Note for the Workers **Free** plan

The free plan caps CPU at ~10 ms per invocation — too little to parse the
18 MB NUSMods file, so the cron refresh may fail there (the site keeps working
off the deploy-time snapshot; nothing breaks). Two options:

- Enable the included GitHub Action: it refreshes the snapshot daily at
  6 AM SGT from CI instead (still exactly one NUSMods call per day), or
- use the Workers Paid plan ($5/mo), where the cron runs comfortably.

Module credits and S/U attributes change rarely (mainly at the new academic
year), so even refreshing only on deploys is fine in practice.

## Deploy

```bash
npm install

# one-time: create the KV namespace and paste its id into wrangler.jsonc
npx wrangler kv namespace create MODULES

npm run deploy        # fetches fresh NUSMods data, then deploys
```

`npx wrangler deploy` prompts for Cloudflare login on first use. The cron
trigger and static assets are configured automatically from `wrangler.jsonc`.

If you skip the KV setup, delete the `kv_namespaces` block from
`wrangler.jsonc`; the site then runs purely off the deploy-time snapshot.

### Optional: daily auto-refresh via GitHub Actions

Push this repo to GitHub and add two repository secrets:

- `CLOUDFLARE_API_TOKEN` — API token with the *Edit Cloudflare Workers* template
- `CLOUDFLARE_ACCOUNT_ID` — from the Workers dashboard overview page

The workflow in `.github/workflows/refresh-data.yml` then redeploys with fresh
NUSMods data every day at 6:00 AM SGT (22:00 UTC).

### Manual refresh (optional)

```bash
npx wrangler secret put REFRESH_KEY     # choose any secret value
curl -X POST https://<your-worker>.workers.dev/api/refresh \
     -H "Authorization: Bearer <that value>"
```

## Local development

```bash
npm install
npm run fetch-data    # generate the local data snapshot
npm run dev           # http://localhost:8787

# simulate the 6 AM cron locally:
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=0+22+*+*+*"
```

## Project layout

```
public/            static frontend (index.html, app.js, styles.css)
public/data/       generated NUSMods snapshot (gitignored)
src/worker.js      Worker: /api/modules, /api/refresh, daily cron
src/compact.mjs    shared fetch-and-compact logic
scripts/           deploy-time snapshot generator
```
