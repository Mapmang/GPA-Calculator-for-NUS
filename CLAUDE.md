# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run fetch-data    # regenerate public/data/modules.json snapshot from NUSMods
npm run dev           # wrangler dev → http://localhost:8787
npm run deploy        # runs fetch-data, then wrangler deploy

# simulate the daily cron locally:
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=0+22+*+*+*"
```

There is **no build step, no test suite, and no linter/formatter** configured. The frontend (`public/`) is plain ES modules served as static assets — changes are live without compilation.

One-time setup before the first deploy: `npx wrangler kv namespace create MODULES`, then paste the generated id into the `kv_namespaces` block in `wrangler.jsonc`.

## Architecture

A single-page NUS GPA calculator on Cloudflare Workers. The Worker (`src/worker.js`) only handles `/api/*`; everything else is served from `public/` via the `ASSETS` binding (`run_worker_first: ["/api/*"]` in `wrangler.jsonc`). All GPA math runs client-side in the browser — the Worker exists purely to serve module data.

**`src/compact.mjs` is shared by both the Worker and the build script** (`scripts/fetch-modules.mjs`). It fetches NUSMods `moduleInfo.json` and compacts each module to `[code, title, credits, suAllowed(0|1)]`. When changing the data shape, update both the producer here and the consumer in `public/app.js` (`loadModuleData` destructures this tuple).

**NUSMods data has three fallback layers** (the API is never called from the browser, and is hit at most once per day globally):
1. **KV** (`MODULES_KV`, key `modules:v1`) — written by the daily cron (`scheduled()` in `src/worker.js`, `0 22 * * *` = 6 AM SGT). `/api/modules` reads from here first.
2. **Deploy-time snapshot** — `npm run deploy` runs `fetch-modules.mjs` to bake `public/data/modules.json` (gitignored). Used when KV is empty (e.g. right after first deploy).
3. **Live fetch** — last resort inside `handleModules`; on the Workers Free plan this can exceed the ~10 ms CPU limit and fail (the site still works off the snapshot). The GitHub Action (`.github/workflows/refresh-data.yml`) refreshes the snapshot from CI to sidestep this.

`/api/modules` responses are cached at the edge (`caches.default`) and in the browser with `max-age` computed by `secondsUntilNextRefresh()` so caches expire just after the 6 AM SGT refresh. `/api/refresh` (POST, `Bearer ${REFRESH_KEY}` secret) forces a KV refresh for testing.

**GPA logic** (`public/app.js`, `recalc()`) mirrors the original Excel workbook and must stay consistent with the grade table in `README.md`:
- Quality points = grade point × MCs; semester/cumulative GPA = Σ QP ÷ Σ counted MCs.
- An **S/U** module is excluded from GPA entirely (both numerator and denominator). It still earns MCs if the grade is a D (1.0) or better → "S" (`S_THRESHOLD = 1`); below a D → "U", no MCs (units count toward the degree only on an S). The S/U toggle is auto-disabled for modules whose NUSMods data says S/U is not allowed.
- **S/U is hard-capped at 32 MCs** (`SU_MC_CAP`). `suCreditsTotal()` sums the credits of all S/U-enabled rows (grade-independent); `updateSuToggle()` (the single source of truth for toggle state, called from `resolveModule` and per-row in `recalc`) greys out unchecked toggles once the cap is reached, and the toggle handler blocks any change that would exceed 32 (reverting + flashing the stat). The "MCs S/U'd" stat shows `X / 32` and turns red at the cap. A **credits edit** (or autocomplete auto-fill) that would push an already-S/U'd row over the cap auto-drops S/U on that row (`enforceSuCapOnRow`) instead of blocking the number field, so the total can never display over 32.
- **CS / CU** (`PASS_FAIL`) is a pass/fail grading basis with no grade points, so it lives outside `GRADE_POINTS` (validity checks use `isValidGrade`). Like S/U it is excluded from GPA, but it is a *selected grade*, not a toggle: **CS** earns MCs, **CU** earns none. Selecting CS/CU disables and clears the row's S/U toggle (`updateSuToggle` treats `isPassFail(row.g)` like a module that disallows S/U), so CS/CU never counts toward the 32-MC S/U cap. The row greys out (`.excluded`) and reuses the `.su-result` chip to show "Pass"/"Fail".
- A row counts only once a letter grade is selected (deliberate divergence from the spreadsheet, which treated empty graded cells as 0). CS/CU likewise count only once chosen.
- Graduation requirement is hardcoded at 160 MCs (`GRADUATION_MCS`).
- Honours classification comes from `CLASSIFICATIONS`; **Pass** floors at `MIN_GRADUATION_GPA` (2.00). A cumulative GPA below 2.00 is not a passing class — `recalc()` flags it as "not eligible to graduate", turns the summary box and floating island red (`.danger`), and reveals the `#grad-warning` banner. Threshold per the [NUS continuation/graduation requirements](https://nus.edu.sg/registrar/academic-information-policies/undergraduate-students/continuation-and-graduation-requirements).

Calculator state persists to `localStorage` (`STORAGE_KEY = 'nus-gpa-calc-v1'`); `loadState()` validates/migrates restored data. The grade dropdown and module autocomplete are custom-built (not native `<select>`) — see `setupGradeDropdown` and the autocomplete section in `app.js`.

The grid is **not a fixed 4 years**: `state.years` (clamped to `[DEFAULT_YEARS, MAX_YEARS]` = `[4, 8]`) drives everything via `semesterIds(years)`, which replaces the old fixed `SEMESTERS` const. `buildLayout`, `recalc`, `defaultState`, and `loadState` all derive their semester ids from it; "Add year"/"Remove year" mutate `state.years` and call `rebuildLayout()` (the shared teardown also used by "Reset all"). Theme is a separate concern persisted under `THEME_KEY = 'nus-gpa-theme'`: an inline `<head>` script applies `data-theme` before first paint to avoid a flash, and `app.js` (`applyTheme`/`initialTheme`) follows the OS `prefers-color-scheme` until the user explicitly toggles. The dark palette is a `[data-theme="dark"]` override of the `:root` CSS variables in `styles.css`.

## Keeping the site clean and complete

When changing the frontend, **preserve the existing feature surface** below unless the user explicitly asks to remove something, and keep the UI minimal — no new dependencies, no build step, no framework. Plain ES modules and hand-written CSS only. Before adding UI, check whether an existing element or helper in `public/` already covers it; reuse over duplication. After a change, the full list below should still work end-to-end.

**Current functions that must keep working:**
- **Year/semester grid** — `state.years` (4–8) × Semester 1–2, built by `buildLayout()` from `semesterIds(state.years)`; each `.sem-card` shows its own semester GPA and counted MCs.
- **Add / remove year** — `+ Add year` (capped at `MAX_YEARS` = 8) and `− Remove year` (only past `DEFAULT_YEARS` = 4, confirm-guarded when the year has data); both call `rebuildLayout()` and toggle the buttons' `disabled` state (`addYear`, `removeYear`, `updateYearButtons`).
- **Dark / light theme toggle** — header button flips `data-theme`; first visit follows OS `prefers-color-scheme`, the explicit choice persists to `THEME_KEY`, and an inline `<head>` script prevents a flash (`applyTheme`, `initialTheme`).
- **Add / remove module rows** — `+ Add module` per semester and the `×` remove button; removing the last row leaves one empty row (`createRowEl`, `rebuildSemRows`).
- **Module autocomplete** — code-prefix and (≥3 chars) title search over NUSMods data, keyboard-navigable, with MC and S/U badges (`searchModules`, `showAutocomplete`).
- **Auto-fill on resolve** — selecting/typing a known code fills MCs (still editable) and enables/disables the S/U toggle per `suAllowed` (`resolveModule`).
- **Custom grade dropdown** — styled `setupGradeDropdown` listbox (A+ … F, the CS/CU pass/fail grades, plus the "no grade" `–`), mouse + keyboard driven; only one open at a time.
- **CS / CU (pass / fail) grades** — selectable in the grade dropdown; excluded from GPA, CS earns MCs and CU earns none, the row greys out and shows a "Pass"/"Fail" chip, and the S/U toggle is disabled while CS/CU is chosen (`PASS_FAIL`, `isPassFail`, `recalc`, `updateSuToggle`).
- **Editable MCs** — manual credits entry for modules not in NUSMods, with the "Not in NUSMods — set MCs manually" hint (`updateTitleHint`).
- **S/U handling** — toggle excludes a module from GPA and shows the S/U result chip; the toggle is greyed out when the module disallows S/U or when the 32-MC S/U cap (`SU_MC_CAP`) is reached.
- **Live summary** — cumulative GPA, honours classification (`CLASSIFICATIONS`), total earned MCs with the 160-MC graduation progress bar, and total MCs S/U'd.
- **Floating GPA island** — appears once the summary scrolls off-screen (`IntersectionObserver`), mirrors GPA/class/progress, and scrolls back to top on click.
- **Persistence** — debounced `localStorage` save and validated restore across reloads.
- **Reset all** — confirm-guarded clear back to the default empty state.
- **Data status line** — shows acad year, module count, and last-refresh time, with a graceful offline fallback message (`loadModuleData`).
- **Footer** — NUSMods attribution, grading-scale summary, the unofficial-tool disclaimer, and the GitHub source link.

If you add a feature, append it to this list so the inventory stays current.
