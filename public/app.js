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
const S_THRESHOLD = 2; // S requires a C (2.0) or better

const GRADE_OPTIONS = ['', ...Object.keys(GRADE_POINTS)]; // leading '' is the "no grade" choice

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
    opt.textContent = g === '' ? '–' : g;
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

const SEMESTERS = []; // semester ids, 'y1s1' … 'y4s2'
for (let y = 1; y <= 4; y++) for (let s = 1; s <= 2; s++) SEMESTERS.push(`y${y}s${s}`);

const STORAGE_KEY = 'nus-gpa-calc-v1';
const DEFAULT_ROWS = 4;     // empty module rows each semester starts with
const GRADUATION_MCS = 160; // standard 4-year honours degree requirement

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

function defaultState() {
  const rows = {};
  for (const id of SEMESTERS) rows[id] = Array.from({ length: DEFAULT_ROWS }, emptyRow);
  return { rows };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const state = defaultState();
    for (const id of SEMESTERS) {
      if (Array.isArray(parsed.rows?.[id]) && parsed.rows[id].length) {
        state.rows[id] = parsed.rows[id].map((r) => ({
          m: typeof r.m === 'string' ? r.m : '',
          g: GRADE_POINTS[r.g] !== undefined ? r.g : '',
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
  for (let y = 1; y <= 4; y++) {
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
    recalc();
    saveState();
  });

  suCheck.addEventListener('change', () => {
    getRow(rowEl).su = suCheck.checked;
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
  }
  rowEl.dataset.resolved = newCode || '';

  const suToggle = rowEl.querySelector('.su-toggle');
  const suCheck = rowEl.querySelector('.su-check');
  if (mod && !mod.su) {
    // Module does not offer the S/U option — grey it out.
    if (suCheck.checked) {
      suCheck.checked = false;
      row.su = false;
    }
    suCheck.disabled = true;
    suToggle.classList.add('disabled');
    suToggle.title = `${mod.code} has no S/U option`;
  } else {
    suCheck.disabled = false;
    suToggle.classList.remove('disabled');
    suToggle.title = mod
      ? `${mod.code} can be taken S/U (excluded from GPA)`
      : 'Count as Satisfactory/Unsatisfactory (excluded from GPA)';
  }

  updateTitleHint(rowEl, false);
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

// [min GPA, full label, compact label for the floating island]
const CLASSIFICATIONS = [
  [4.5, 'Honours (Highest Distinction)', 'Highest Dist.'],
  [4.0, 'Honours (Distinction)', 'Distinction'],
  [3.5, 'Honours (Merit)', 'Merit'],
  [3.0, 'Honours', 'Honours'],
  [0, 'Pass', 'Pass'],
];

function classification(gpa, short) {
  return CLASSIFICATIONS.find(([min]) => gpa >= min)[short ? 2 : 1];
}

function recalc() {
  let totalQp = 0;
  let totalCredits = 0;
  let suCredits = 0;
  let earnedMcs = 0;

  for (const id of SEMESTERS) {
    let qp = 0;
    let credits = 0;
    state.rows[id].forEach((row, i) => {
      const gp = GRADE_POINTS[row.g];
      const hasGrade = gp !== undefined;
      const c = row.c ?? 0;
      const rowEl = semEls[id].rowsEl.children[i];

      if (hasGrade && c > 0) {
        if (row.su) {
          suCredits += c;
          if (gp >= S_THRESHOLD) earnedMcs += c; // S earns credits, U doesn't
        } else {
          qp += gp * c;
          credits += c;
          if (row.g !== 'F') earnedMcs += c; // D and above pass
        }
      }

      if (rowEl) {
        rowEl.classList.toggle('excluded', row.su);
        const resEl = rowEl.querySelector('.su-result');
        if (row.su && hasGrade) {
          const satisfactory = gp >= S_THRESHOLD;
          resEl.textContent = satisfactory ? 'S' : 'U';
          resEl.className = `su-result ${satisfactory ? 's' : 'u'}`;
          resEl.title = satisfactory
            ? 'Satisfactory (C or better) — credits earned, not in GPA'
            : 'Unsatisfactory (below C) — no credits earned, not in GPA';
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
    cumEl.textContent = gpa.toFixed(2);
    classEl.textContent = classification(gpa);
    hasGpa = true;
    islandGpaEl.textContent = gpa.toFixed(2);
    islandClassEl.textContent = classification(gpa, true);
  } else {
    cumEl.textContent = '–';
    classEl.textContent = '';
    hasGpa = false;
    islandGpaEl.textContent = '–';
    islandClassEl.textContent = '';
  }
  document.getElementById('stat-total').textContent = fmtMc(earnedMcs);
  document.getElementById('stat-su').textContent = fmtMc(suCredits);
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

// ---------- Init ----------

document.getElementById('reset-btn').addEventListener('click', () => {
  if (!confirm('Clear all modules and grades?')) return;
  closeGradeMenu();
  localStorage.removeItem(STORAGE_KEY);
  state = defaultState();
  document.getElementById('years').textContent = '';
  for (const k of Object.keys(semEls)) delete semEls[k];
  buildLayout();
  recalc();
});

window.addEventListener('resize', hideAutocomplete);
window.addEventListener('scroll', () => { if (!acEl.hidden && acInput) showAutocomplete(acInput); }, { passive: true });

buildLayout();
recalc();
loadModuleData();
