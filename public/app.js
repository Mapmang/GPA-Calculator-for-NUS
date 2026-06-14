/* NUS GPA Calculator — logic mirrors the original Excel workbook:
 *   quality points = grade point x credits, S/U'd modules are excluded from
 *   both the numerator and denominator. GPA = sum(QP) / sum(counted credits).
 */
'use strict';

// Grade table (Excel "Grade Table" sheet)
const GRADE_POINTS = {
  'A+': 5, 'A': 5, 'A-': 4.5,
  'B+': 4, 'B': 3.5, 'B-': 3,
  'C+': 2.5, 'C': 2,
  'D+': 1.5, 'D': 1,
  'F': 0,
};
const S_THRESHOLD = 1; // 'S' requires a D (1.0) or better; below a D → 'U'

// CS/CU ("Completed Satisfactory/Unsatisfactory") is a pass/fail grading basis,
// excluded from GPA. CS earns credits; CU earns none. value = earns credits.
const PASS_FAIL = { CS: true, CU: false };

// Longer menu labels; the trigger keeps the short CS/CU because it's narrow.
const GRADE_LABELS = { CS: 'CS · Pass', CU: 'CU · Fail' };

const isPassFail = (g) => g === 'CS' || g === 'CU';
const isValidGrade = (g) => GRADE_POINTS[g] !== undefined || isPassFail(g);

// leading '' is the "no grade" choice; CS/CU follow the letter grades
const GRADE_OPTIONS = ['', ...Object.keys(GRADE_POINTS), ...Object.keys(PASS_FAIL)];

// Tracks the one open grade menu so a new open (or an outside click) closes it.
let openGradeDd = null;

function closeGradeMenu() {
  openGradeDd?.close();
  openGradeDd = null;
}

document.addEventListener('click', (e) => {
  if (openGradeDd && !openGradeDd.root.contains(e.target)) closeGradeMenu();
});

// Builds the custom grade dropdown for a row: a styled trigger plus a
// popup menu that replaces the native <select> popup.
// onChange() is called after the row's grade is updated.
function setupGradeDropdown(rowEl, onChange) {
  const root = rowEl.querySelector('.grade-dd');
  const trigger = root.querySelector('.grade-trigger');
  const valEl = root.querySelector('.grade-trigger-val');

  const menu = document.createElement('div');
  menu.className = 'grade-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;

  GRADE_OPTIONS.forEach((g, i) => {
    const opt = document.createElement('div');
    opt.className = 'grade-opt';
    opt.dataset.val = g;
    opt.setAttribute('role', 'option');
    opt.textContent = g === '' ? '–' : (GRADE_LABELS[g] || g);
    opt.addEventListener('click', () => commit(g));
    opt.addEventListener('mousemove', () => setActive(i));
    menu.appendChild(opt);
  });
  root.appendChild(menu);

  let activeIdx = -1;

  function render() {
    const g = getRow(rowEl).g;
    valEl.textContent = g === '' ? '–' : g;
    [...menu.children].forEach((o) =>
      o.classList.toggle('selected', o.dataset.val === g));
  }

  function setActive(i) {
    activeIdx = i;
    [...menu.children].forEach((o, j) => o.classList.toggle('active', j === i));
    menu.children[i]?.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    closeGradeMenu();
    hideAutocomplete();
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    root.classList.add('open');
    setActive(Math.max(0, GRADE_OPTIONS.indexOf(getRow(rowEl).g)));
    openGradeDd = {
      root,
      close() {
        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        root.classList.remove('open');
        [...menu.children].forEach((o) => o.classList.remove('active'));
      },
    };
  }

  function commit(g) {
    getRow(rowEl).g = g;
    render();
    closeGradeMenu();
    trigger.focus();
    onChange();
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openGradeDd && openGradeDd.root === root) closeGradeMenu();
    else open();
  });

  trigger.addEventListener('keydown', (e) => {
    if (menu.hidden) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(GRADE_OPTIONS.length - 1, activeIdx + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(0, activeIdx - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (activeIdx >= 0) commit(GRADE_OPTIONS[activeIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeGradeMenu();
    }
  });

  render(); // reflect the initial (possibly restored) grade
}

const DEFAULT_YEARS = 4;    // standard honours programme length
const MAX_YEARS = 8;        // upper bound for the "Add year" button

// Semester ids 'y1s1' … `y${years}s2`, derived from the current year count.
function semesterIds(years) {
  const ids = [];
  for (let y = 1; y <= years; y++) for (let s = 1; s <= 2; s++) ids.push(`y${y}s${s}`);
  return ids;
}

const STORAGE_KEY = 'nus-gpa-calc-v1';
const THEME_KEY = 'nus-gpa-theme';
const DEFAULT_ROWS = 4;     // empty module rows each semester starts with
const GRADUATION_MCS = 160; // standard 4-year honours degree requirement
const SU_MC_CAP = 32;       // hard limit on how many MCs may be taken S/U

// ---------- Module data (from /api/modules, refreshed daily at 6 AM SGT) ----------

const moduleMap = new Map(); // code -> { title, credits, su }
const searchList = [];       // [{ code, title, titleLower, credits, su }]

async function loadModuleData() {
  const statusEl = document.getElementById('data-status');
  try {
    const res = await fetch('/api/modules');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    for (const [code, title, credits, su] of data.modules) {
      const entry = { code, title, titleLower: title.toLowerCase(), credits, su: su === 1 };
      moduleMap.set(code, entry);
      searchList.push(entry);
    }
    const fetched = new Date(data.fetchedAt);
    statusEl.textContent =
      `AY${data.acadYear} · ${data.count.toLocaleString()} modules from NUSMods ` +
      `· refreshed daily at 6:00 AM SGT (last update: ${fetched.toLocaleString(undefined, {
        day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
      })})`;
    // Re-resolve anything restored from a previous visit
    document.querySelectorAll('.row').forEach((rowEl) => resolveModule(rowEl, false));
    recalc();
  } catch {
    statusEl.textContent =
      'Module data unavailable right now — autocomplete is off, but you can still enter credits manually.';
    statusEl.classList.add('error');
  }
}

// ---------- State ----------

function emptyRow() {
  return { m: '', g: '', c: null, su: false };
}

function defaultState(years = DEFAULT_YEARS) {
  const rows = {};
  for (const id of semesterIds(years)) rows[id] = Array.from({ length: DEFAULT_ROWS }, emptyRow);
  return { years, rows };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const years = Math.min(MAX_YEARS, Math.max(DEFAULT_YEARS,
      Number.isInteger(parsed.years) ? parsed.years : DEFAULT_YEARS));
    const state = defaultState(years);
    for (const id of semesterIds(years)) {
      if (Array.isArray(parsed.rows?.[id]) && parsed.rows[id].length) {
        state.rows[id] = parsed.rows[id].map((r) => ({
          m: typeof r.m === 'string' ? r.m : '',
          g: isValidGrade(r.g) ? r.g : '',
          c: Number.isFinite(r.c) ? r.c : null,
          su: r.su === true,
        }));
        while (state.rows[id].length < DEFAULT_ROWS) state.rows[id].push(emptyRow());
      }
    }
    return state;
  } catch {
    return defaultState();
  }
}

let state = loadState();
let saveTimer = null;

function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch { /* storage full / disabled — non-fatal */ }
  }, 250);
}

// ---------- Rendering ----------

const semEls = {}; // semId -> { rowsEl, gpaEl }

function buildLayout() {
  const yearsEl = document.getElementById('years');
  const semTpl = document.getElementById('sem-template');
  for (let y = 1; y <= state.years; y++) {
    const h = document.createElement('h2');
    h.className = 'year-title';
    h.textContent = `Year ${y}`;
    yearsEl.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'year-grid';
    yearsEl.appendChild(grid);
    for (let s = 1; s <= 2; s++) {
      const semId = `y${y}s${s}`;
      const card = semTpl.content.firstElementChild.cloneNode(true);
      card.querySelector('.sem-title').textContent = `Semester ${s}`;
      card.querySelector('.add-row-btn').addEventListener('click', () => {
        state.rows[semId].push(emptyRow());
        const rowEl = createRowEl(semId, state.rows[semId].length - 1);
        semEls[semId].rowsEl.appendChild(rowEl);
        rowEl.querySelector('.module-input').focus();
        saveState();
      });
      grid.appendChild(card);
      semEls[semId] = {
        rowsEl: card.querySelector('.sem-rows'),
        gpaEl: card.querySelector('.sem-gpa'),
      };
      state.rows[semId].forEach((_, i) => {
        semEls[semId].rowsEl.appendChild(createRowEl(semId, i));
      });
    }
  }
}

function createRowEl(semId, index) {
  const tpl = document.getElementById('row-template');
  const rowEl = tpl.content.firstElementChild.cloneNode(true);
  rowEl.dataset.sem = semId;
  rowEl.dataset.index = String(index);

  const row = state.rows[semId][index];
  const modInput = rowEl.querySelector('.module-input');
  const credInput = rowEl.querySelector('.credits-input');
  const suCheck = rowEl.querySelector('.su-check');

  setupGradeDropdown(rowEl, () => {
    updateSuToggle(rowEl); // a CS/CU pick clears S/U before recalc tallies the cap
    recalc();
    saveState();
  });

  // example code only on the first row of each semester
  if (index > 0) modInput.placeholder = '';

  modInput.value = row.m;
  credInput.value = row.c ?? '';
  suCheck.checked = row.su;

  modInput.addEventListener('input', () => {
    getRow(rowEl).m = modInput.value.trim().toUpperCase();
    resolveModule(rowEl, true);
    showAutocomplete(modInput);
    recalc();
    saveState();
  });
  modInput.addEventListener('focus', () => showAutocomplete(modInput));
  modInput.addEventListener('blur', () => {
    hideAutocomplete();
    updateTitleHint(rowEl, true);
  });
  modInput.addEventListener('keydown', autocompleteKeydown);

  credInput.addEventListener('input', () => {
    const v = Number.parseFloat(credInput.value);
    getRow(rowEl).c = Number.isFinite(v) && v >= 0 ? v : null;
    enforceSuCapOnRow(rowEl); // drop S/U if this edit breaches the 32-MC cap
    recalc();
    saveState();
  });

  suCheck.addEventListener('change', () => {
    const row = getRow(rowEl);
    const cc = row.c > 0 ? row.c : 0;
    // suCreditsTotal() still excludes this row (row.su not yet updated)
    if (suCheck.checked && suCreditsTotal() + cc > SU_MC_CAP) {
      suCheck.checked = false; // revert — would exceed the S/U budget
      flashSuLimit();
      return;
    }
    row.su = suCheck.checked;
    recalc();
    saveState();
  });

  rowEl.querySelector('.remove-btn').addEventListener('click', () => {
    const semRows = state.rows[semId];
    const i = Number(rowEl.dataset.index);
    semRows.splice(i, 1);
    if (semRows.length === 0) semRows.push(emptyRow());
    rebuildSemRows(semId);
    recalc();
    saveState();
  });

  resolveModule(rowEl, false);
  return rowEl;
}

function rebuildSemRows(semId) {
  const { rowsEl } = semEls[semId];
  rowsEl.textContent = '';
  state.rows[semId].forEach((_, i) => rowsEl.appendChild(createRowEl(semId, i)));
}

function getRow(rowEl) {
  return state.rows[rowEl.dataset.sem][Number(rowEl.dataset.index)];
}

// Looks up the typed code; on a newly resolved module, auto-fills the credits
// (still user-editable) and enables/disables the S/U toggle.
function resolveModule(rowEl, autofill) {
  const row = getRow(rowEl);
  const mod = moduleMap.get(row.m) || null;
  const newCode = mod ? mod.code : null;

  if (autofill && newCode && rowEl.dataset.resolved !== newCode) {
    row.c = mod.credits;
    rowEl.querySelector('.credits-input').value = mod.credits;
    enforceSuCapOnRow(rowEl); // auto-filled MCs may breach the 32-MC S/U cap
  }
  rowEl.dataset.resolved = newCode || '';

  updateSuToggle(rowEl);
  updateTitleHint(rowEl, false);
}

// Single source of truth for a row's S/U toggle state: greyed out when the
// module disallows S/U, and also when the 32-MC cap is reached (cap only blocks
// turning S/U *on* — it never removes an existing S/U selection).
function updateSuToggle(rowEl, atSuCap = suCreditsTotal() >= SU_MC_CAP) {
  const row = getRow(rowEl);
  const mod = moduleMap.get(row.m) || null;
  const moduleDisallows = !!(mod && !mod.su);
  const passFail = isPassFail(row.g); // CS/CU is its own basis — S/U doesn't apply
  const blockSu = moduleDisallows || passFail;
  const suCheck = rowEl.querySelector('.su-check');
  const suToggle = rowEl.querySelector('.su-toggle');

  if (blockSu && row.su) { // module/grade doesn't offer S/U — auto-uncheck
    row.su = false;
    suCheck.checked = false;
  }

  const capBlocked = atSuCap && !row.su;
  suCheck.disabled = blockSu || capBlocked;
  suToggle.classList.toggle('disabled', blockSu || capBlocked);
  suToggle.title = passFail ? 'CS/CU is pass/fail — S/U does not apply'
    : moduleDisallows ? `${mod.code} has no S/U option`
    : capBlocked ? `S/U limit of ${SU_MC_CAP} MCs reached`
    : mod ? `${mod.code} can be taken S/U (excluded from GPA)`
    : 'Count as Satisfactory/Unsatisfactory (excluded from GPA)';
}

// Total credits currently marked S/U (grade-independent), used for the cap.
function suCreditsTotal() {
  let total = 0;
  for (const id of semesterIds(state.years)) {
    for (const row of state.rows[id]) {
      if (row.su && row.c > 0) total += row.c;
    }
  }
  return total;
}

// Auto-drops S/U on a row whose credits now push the S/U total past the cap
// (keeps the 32-MC budget without blocking the free-typing credits field).
function enforceSuCapOnRow(rowEl) {
  const row = getRow(rowEl);
  if (row.su && suCreditsTotal() > SU_MC_CAP) {
    row.su = false;
    rowEl.querySelector('.su-check').checked = false;
    flashSuLimit();
  }
}

function updateTitleHint(rowEl, afterBlur) {
  const row = getRow(rowEl);
  const titleEl = rowEl.querySelector('.module-title');
  const mod = moduleMap.get(row.m);
  if (mod) {
    titleEl.textContent = mod.title;
  } else if (afterBlur && row.m && moduleMap.size > 0) {
    titleEl.textContent = 'Not in NUSMods — set MCs manually';
  } else {
    titleEl.textContent = '';
  }
}

// ---------- Autocomplete ----------

const acEl = document.getElementById('autocomplete');
let acItems = [];
let acActive = -1;
let acInput = null;

function searchModules(query) {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const out = [];
  for (const m of searchList) {
    if (m.code.startsWith(q)) {
      out.push(m);
      if (out.length >= 8) return out;
    }
  }
  if (q.length >= 3) {
    const ql = query.trim().toLowerCase();
    for (const m of searchList) {
      if (!m.code.startsWith(q) && m.titleLower.includes(ql)) {
        out.push(m);
        if (out.length >= 8) break;
      }
    }
  }
  return out;
}

function showAutocomplete(input) {
  acInput = input;
  acItems = searchModules(input.value);
  acActive = -1;
  if (!acItems.length) {
    hideAutocomplete();
    return;
  }
  acEl.textContent = '';
  acItems.forEach((m, i) => {
    const item = document.createElement('div');
    item.className = 'ac-item';
    const code = document.createElement('span');
    code.className = 'ac-code';
    code.textContent = m.code;
    const title = document.createElement('span');
    title.className = 'ac-title';
    title.textContent = m.title;
    const mc = document.createElement('span');
    mc.className = 'ac-badge';
    mc.textContent = `${m.credits} MC`;
    item.append(code, title, mc);
    if (m.su) {
      const su = document.createElement('span');
      su.className = 'ac-badge su';
      su.textContent = 'S/U';
      item.appendChild(su);
    }
    item.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep focus so blur doesn't fire first
      selectModule(i);
    });
    item.addEventListener('mousemove', () => setActive(i));
    acEl.appendChild(item);
  });
  const rect = input.getBoundingClientRect();
  acEl.style.left = `${Math.min(rect.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - 320)}px`;
  acEl.style.top = `${rect.bottom + window.scrollY + 4}px`;
  acEl.style.minWidth = `${Math.max(rect.width, 300)}px`;
  acEl.hidden = false;
}

function hideAutocomplete() {
  acEl.hidden = true;
  acItems = [];
  acActive = -1;
}

function setActive(i) {
  acActive = i;
  [...acEl.children].forEach((el, j) => el.classList.toggle('active', j === i));
}

function autocompleteKeydown(e) {
  if (acEl.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    setActive((acActive + dir + acItems.length) % acItems.length);
    acEl.children[acActive]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && acActive >= 0) {
    e.preventDefault();
    selectModule(acActive);
  } else if (e.key === 'Escape') {
    hideAutocomplete();
  }
}

function selectModule(i) {
  const m = acItems[i];
  const rowEl = acInput.closest('.row');
  acInput.value = m.code;
  getRow(rowEl).m = m.code;
  rowEl.dataset.resolved = ''; // force credit autofill
  resolveModule(rowEl, true);
  hideAutocomplete();
  recalc();
  saveState();
  rowEl.querySelector('.grade-trigger').focus();
}

// ---------- GPA calculation (Excel "Backend" sheet logic) ----------

// NUS requires a minimum GPA of 2.00 to graduate; below this a student is on
// academic probation and not eligible to graduate.
// https://nus.edu.sg/registrar/academic-information-policies/undergraduate-students/continuation-and-graduation-requirements
const MIN_GRADUATION_GPA = 2.0;

// [min GPA, full label, compact label for the floating island]
const CLASSIFICATIONS = [
  [4.5, 'Honours (Highest Distinction)', 'Highest Dist.'],
  [4.0, 'Honours (Distinction)', 'Distinction'],
  [3.5, 'Honours (Merit)', 'Merit'],
  [3.0, 'Honours', 'Honours'],
  [MIN_GRADUATION_GPA, 'Pass', 'Pass'],
];

function classification(gpa, short) {
  const c = CLASSIFICATIONS.find(([min]) => gpa >= min);
  if (!c) return short ? 'Cannot graduate' : 'Below 2.00 — not eligible to graduate';
  return short ? c[2] : c[1];
}

function recalc() {
  let totalQp = 0;
  let totalCredits = 0;
  let earnedMcs = 0;
  const suTotal = suCreditsTotal();
  const atSuCap = suTotal >= SU_MC_CAP;

  for (const id of semesterIds(state.years)) {
    let qp = 0;
    let credits = 0;
    state.rows[id].forEach((row, i) => {
      const gp = GRADE_POINTS[row.g];
      const isPF = isPassFail(row.g);
      const hasGrade = gp !== undefined || isPF;
      const c = row.c ?? 0;
      const rowEl = semEls[id].rowsEl.children[i];

      if (hasGrade && c > 0) {
        if (isPF) {
          if (row.g === 'CS') earnedMcs += c; // CS earns credits, CU doesn't — neither in GPA
        } else if (row.su) {
          if (gp >= S_THRESHOLD) earnedMcs += c; // S earns credits, U doesn't
        } else {
          qp += gp * c;
          credits += c;
          if (row.g !== 'F') earnedMcs += c; // D and above pass
        }
      }

      if (rowEl) {
        updateSuToggle(rowEl, atSuCap); // enable/disable toggles as the cap is crossed
        rowEl.classList.toggle('excluded', row.su || isPF);
        const resEl = rowEl.querySelector('.su-result');
        if (isPF) {
          const pass = row.g === 'CS';
          resEl.textContent = pass ? 'Pass' : 'Fail';
          resEl.className = `su-result ${pass ? 's' : 'u'}`;
          resEl.title = pass
            ? 'CS — credits earned, not in GPA'
            : 'CU — no credits earned, not in GPA';
        } else if (row.su && hasGrade) {
          const satisfactory = gp >= S_THRESHOLD;
          resEl.textContent = satisfactory ? 'S' : 'U';
          resEl.className = `su-result ${satisfactory ? 's' : 'u'}`;
          resEl.title = satisfactory
            ? 'Satisfactory (D or better) — credits earned, not in GPA'
            : 'Unsatisfactory (below D) — no credits earned, not in GPA';
        } else {
          resEl.textContent = '';
          resEl.className = 'su-result';
          resEl.title = '';
        }
      }
    });

    semEls[id].gpaEl.innerHTML = credits > 0
      ? `GPA <b>${(qp / credits).toFixed(2)}</b> · ${fmtMc(credits)} MCs`
      : '–';

    totalQp += qp;
    totalCredits += credits;
  }

  const cumEl = document.getElementById('cum-gpa');
  const classEl = document.getElementById('cum-class');
  if (totalCredits > 0) {
    const gpa = totalQp / totalCredits;
    const failing = gpa < MIN_GRADUATION_GPA;
    cumEl.textContent = gpa.toFixed(2);
    classEl.textContent = classification(gpa);
    hasGpa = true;
    islandGpaEl.textContent = gpa.toFixed(2);
    islandClassEl.textContent = classification(gpa, true);
    summaryEl.classList.toggle('danger', failing);
    islandEl.classList.toggle('danger', failing);
    warningEl.hidden = !failing;
  } else {
    cumEl.textContent = '–';
    classEl.textContent = '';
    hasGpa = false;
    islandGpaEl.textContent = '–';
    islandClassEl.textContent = '';
    summaryEl.classList.remove('danger');
    islandEl.classList.remove('danger');
    warningEl.hidden = true;
  }
  document.getElementById('stat-total').textContent = fmtMc(earnedMcs);
  document.getElementById('stat-su').textContent = fmtMc(suTotal);
  document.getElementById('su-progress-fill').style.width =
    `${Math.min(100, (suTotal / SU_MC_CAP) * 100)}%`;
  suStatEl.classList.toggle('at-cap', atSuCap);
  const left = Math.max(0, GRADUATION_MCS - earnedMcs);
  document.getElementById('stat-total-label').textContent =
    left > 0 ? `Total MCs · ${fmtMc(left)} to graduation` : 'Total MCs · requirement met';
  const mcPct = Math.min(100, (earnedMcs / GRADUATION_MCS) * 100);
  document.getElementById('mc-progress-fill').style.width = `${mcPct}%`;
  islandMcEl.textContent = `${fmtMc(earnedMcs)} / ${GRADUATION_MCS} MC`;
  islandFillEl.style.width = `${mcPct}%`;
  updateIslandVisibility();
}

// ---------- Dynamic island (floating GPA badge) ----------

const summaryEl = document.querySelector('.summary');
const warningEl = document.getElementById('grad-warning');
const suStatEl = document.getElementById('su-stat');

// Brief highlight on the S/U stat when a toggle is blocked by the 32-MC cap.
function flashSuLimit() {
  suStatEl.classList.remove('flash');
  void suStatEl.offsetWidth; // reflow so the animation can re-trigger
  suStatEl.classList.add('flash');
}
suStatEl.addEventListener('animationend', () => suStatEl.classList.remove('flash'));
const islandEl = document.getElementById('gpa-island');
const islandGpaEl = document.getElementById('island-gpa');
const islandClassEl = document.getElementById('island-class');
const islandMcEl = document.getElementById('island-mc');
const islandFillEl = document.getElementById('island-progress-fill');
let hasGpa = false;
let summaryVisible = true; // updated by the IntersectionObserver below

// The island appears only once you've scrolled the main summary out of
// view and there's actually a GPA to show.
function updateIslandVisibility() {
  const show = hasGpa && !summaryVisible;
  islandEl.classList.toggle('visible', show);
  islandEl.setAttribute('aria-hidden', String(!show));
}

islandEl.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

new IntersectionObserver((entries) => {
  summaryVisible = entries[0].isIntersecting;
  updateIslandVisibility();
}, { rootMargin: '-8px 0px 0px 0px' }).observe(document.querySelector('.summary'));

function fmtMc(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ---------- Theme (dark / light) ----------

const themeBtn = document.getElementById('theme-btn');

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark';
  themeBtn.textContent = dark ? 'Light mode' : 'Dark mode';
  themeBtn.setAttribute('aria-pressed', String(dark));
  themeBtn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
}

// Saved choice wins; otherwise follow the OS preference on first visit.
function initialTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

applyTheme(initialTheme());

themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch { /* storage disabled — non-fatal */ }
  applyTheme(next);
});

// ---------- Init ----------

// Tears down and re-renders every year/semester card from current state.
function rebuildLayout() {
  closeGradeMenu();
  document.getElementById('years').textContent = '';
  for (const k of Object.keys(semEls)) delete semEls[k];
  buildLayout();
  updateYearButtons();
}

const addYearBtn = document.getElementById('add-year-btn');
const removeYearBtn = document.getElementById('remove-year-btn');

function updateYearButtons() {
  addYearBtn.disabled = state.years >= MAX_YEARS;
  removeYearBtn.disabled = state.years <= DEFAULT_YEARS;
}

function addYear() {
  if (state.years >= MAX_YEARS) return;
  state.years += 1;
  for (const id of [`y${state.years}s1`, `y${state.years}s2`]) {
    state.rows[id] = Array.from({ length: DEFAULT_ROWS }, emptyRow);
  }
  rebuildLayout();
  recalc();
  saveState();
}

function removeYear() {
  if (state.years <= DEFAULT_YEARS) return;
  const ids = [`y${state.years}s1`, `y${state.years}s2`];
  const hasData = ids.some((id) => state.rows[id]?.some((r) => r.m || r.g || r.c != null));
  if (hasData && !confirm(`Remove Year ${state.years} and its modules?`)) return;
  ids.forEach((id) => delete state.rows[id]);
  state.years -= 1;
  rebuildLayout();
  recalc();
  saveState();
}

addYearBtn.addEventListener('click', addYear);
removeYearBtn.addEventListener('click', removeYear);

document.getElementById('reset-btn').addEventListener('click', () => {
  if (!confirm('Clear all modules and grades?')) return;
  localStorage.removeItem(STORAGE_KEY);
  state = defaultState();
  rebuildLayout();
  recalc();
});

window.addEventListener('resize', hideAutocomplete);
window.addEventListener('scroll', () => { if (!acEl.hidden && acInput) showAutocomplete(acInput); }, { passive: true });

buildLayout();
updateYearButtons();
recalc();
loadModuleData();
