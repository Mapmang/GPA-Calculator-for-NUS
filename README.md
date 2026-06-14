# NUS GPA Calculator

A clean, single-page NUS GPA / CAP calculator deployed on **Cloudflare Workers**.
Type a module code and its modular credits (MCs) and S/U eligibility are filled
in automatically from [NUSMods](https://api.nusmods.com/v2/) data. Credits stay
editable, and the S/U toggle is greyed out for modules that do not offer the
S/U option. It tracks a full degree — a configurable 4-to-8-year grid, the
160-MC graduation requirement, and your honours classification — and everything
persists in the browser.

## How GPA is calculated

Same logic as the original Excel workbook:

| Grade | A+ / A | A− | B+ | B | B− | C+ | C | D+ | D | F |
|-------|--------|----|----|---|----|----|---|----|---|---|
| Points| 5.0    |4.5 |4.0 |3.5|3.0 |2.5 |2.0|1.5 |1.0| 0 |

- Quality points = grade points × MCs
- A module marked **S/U** is excluded from GPA entirely (numerator *and*
  denominator). The app shows whether it would convert to an **S** (D or
  better, credits count toward the degree) or a **U** (below a D, no credits).
- The **CS / CU** (Completed Satisfactory / Unsatisfactory) grades are a
  pass/fail basis, also excluded from GPA: **CS** earns credits toward the
  degree, **CU** earns none.
- **S/U is capped at 32 MCs** — once 32 MCs are marked S/U, further toggles are
  disabled and the "MCs S/U'd" indicator (`X / 32`) turns red. Raising a module's
  credits past the remaining budget turns its S/U back off automatically.
- Semester GPA = Σ quality points ÷ Σ counted MCs; cumulative GPA is the same
  sum across every semester in the grid (a 4-year / 8-semester programme by
  default, expandable up to 8 years).
- One deliberate difference from the spreadsheet: a row only counts once a
  letter grade is selected (the sheet treated a graded-but-empty cell as 0
  points).

### Graduation & honours classification

The summary tracks progress toward the **160-MC** graduation requirement with a
progress bar, and shows the honours class for the current cumulative GPA:

| Cumulative GPA | Classification                  |
|----------------|---------------------------------|
| ≥ 4.50         | Honours (Highest Distinction)   |
| ≥ 4.00         | Honours (Distinction)           |
| ≥ 3.50         | Honours (Merit)                 |
| ≥ 3.00         | Honours                         |
| ≥ 2.00         | Pass                            |

A cumulative GPA below **2.00** is not a passing class: the app flags it as *not
eligible to graduate*, turns the summary and floating island red, and shows a
warning banner. (Threshold per the
[NUS continuation & graduation requirements](https://nus.edu.sg/registrar/academic-information-policies/undergraduate-students/continuation-and-graduation-requirements).)

## Features

- **Configurable degree length** — a 4-year (8-semester) grid by default, with
  *Add year* / *Remove year* up to 8 years; each semester card shows its own GPA
  and counted MCs.
- **Module autocomplete** — search by code prefix or (from 3 characters) by
  title, keyboard-navigable, with MC and S/U badges. Selecting a module fills its
  MCs (still editable) and enables or disables the S/U toggle accordingly.
- **Manual MCs** — set credits by hand for modules not in NUSMods.
- **Custom grade dropdown** — A+ … F, the CS/CU pass/fail grades, and a "no
  grade" option, driven by mouse or keyboard.
- **S/U handling** — toggle a module to S/U (excluded from GPA, shown as S or U)
  with a hard 32-MC cap; the toggle greys out when the cap is reached or the
  module disallows S/U.
- **Live summary + floating island** — cumulative GPA, honours classification,
  the 160-MC graduation progress bar, and total MCs S/U'd, mirrored in a floating
  island once the summary scrolls off-screen.
- **Dark / light theme** — follows your OS preference until you toggle it, then
  remembers your choice (no flash on load).
- **Persistence & reset** — your entries are saved to `localStorage` and restored
  on reload; *Reset all* clears back to an empty grid.

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
   the snapshot + deploy daily at 6 AM SGT, and also deploys on every push to
   `main`. See "Workers Free plan" below.

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
NUSMods data every day at 6:00 AM SGT (22:00 UTC), and also deploys
automatically whenever you push to `main`.

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
