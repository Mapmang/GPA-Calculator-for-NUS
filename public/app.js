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
const GRADES = Object.keys(GRADE_POINTS);
const S_THRESHOLD = 2; // S requires a C (2.0) or better

const SEMESTERS = [];
for (let y = 1; y <= 4; y++) {
  for (let s = 1; s <= 2; s++) {
    SEMESTERS.push({ id: `y${y}s${s}`, year: y, sem: s });
  }
}

const STORAGE_KEY = 'nus-gpa-calc-v1';
const DEFAULT_ROWS = 4;     // empty module rows each semester starts with
const GRADUATION_MCS = 160; // standard 4-year honours degree requirement

// ---------- Module data (from /api/modules, refreshed daily at 6 AM SGT) ----------

let moduleMap = new Map();   // code -> { title, credits, su }
let searchList = [];         // [{ code, title, titleLower, credits, su }]
let dataInfo = null;

async function loadModuleData() {
  const statusEl = document.getElementById('data-status');
  try {
    const res = await fetch('/api/modules');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    moduleMap = new Map();
    searchList = [];
    for (const [code, title, credits, su] of data.modules) {
      const entry = { code, title, titleLower: title.toLowerCase(), credits, su: su === 1 };
      moduleMap.set(code, entry);
      searchList.push(entry);
    }
    dataInfo = data;
    const fetched = new Date(data.fetchedAt);
    statusEl.textContent =
      `AY${data.acadYear} · ${data.count.toLocaleString()} modules from NUSMods ` +
      `· refreshed daily at 6:00 AM SGT (last update: ${fetched.toLocaleString(undefined, {
        day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
      })})`;
    statusEl.classList.remove('error');
    // Re-resolve anything restored from a previous visit
    document.querySelectorAll('.row').forEach((rowEl) => resolveModule(rowEl, false));
    recalc();
  } catch (err) {
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
  for (const s of SEMESTERS) {
    rows[s.id] = Array.from({ length: DEFAULT_ROWS }, emptyRow);
  }
  return { rows };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const state = defaultState();
    for (const s of SEMESTERS) {
      if (Array.isArray(parsed.rows?.[s.id]) && parsed.rows[s.id].length) {
        state.rows[s.id] = parsed.rows[s.id].map((r) => ({
          m: typeof r.m === 'string' ? r.m : '',
          g: GRADE_POINTS[r.g] !== undefined ? r.g : '',
          c: Number.isFinite(r.c) ? r.c : null,
          su: r.su === true,
        }));
        while (state.rows[s.id].length < DEFAULT_ROWS) state.rows[s.id].push(emptyRow());
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
      card.dataset.sem = semId;
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

  const gradeSel = rowEl.querySelector('.grade-select');
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = '–';
  gradeSel.appendChild(ph);
  for (const g of GRADES) {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = g;
    gradeSel.appendChild(opt);
  }

  const row = state.rows[semId][index];
  const modInput = rowEl.querySelector('.module-input');
  const credInput = rowEl.querySelector('.credits-input');
  const suCheck = rowEl.querySelector('.su-check');

  // example code only on the first row of each semester
  if (index > 0) modInput.placeholder = '';

  modInput.value = row.m;
  gradeSel.value = row.g;
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

  gradeSel.addEventListener('change', () => {
    getRow(rowEl).g = gradeSel.value;
    recalc();
    saveState();
  });

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
  rowEl.querySelector('.grade-select').focus();
}

// ---------- GPA calculation (Excel "Backend" sheet logic) ----------

function classification(gpa) {
  if (gpa >= 4.5) return 'Honours (Highest Distinction)';
  if (gpa >= 4.0) return 'Honours (Distinction)';
  if (gpa >= 3.5) return 'Honours (Merit)';
  if (gpa >= 3.0) return 'Honours';
  return 'Pass';
}

function recalc() {
  let totalQp = 0;
  let totalCredits = 0;
  let suCredits = 0;
  let earnedMcs = 0;

  for (const s of SEMESTERS) {
    let qp = 0;
    let credits = 0;
    state.rows[s.id].forEach((row, i) => {
      const gp = GRADE_POINTS[row.g];
      const hasGrade = gp !== undefined;
      const c = row.c ?? 0;
      const rowEl = semEls[s.id].rowsEl.children[i];

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

    const gpaEl = semEls[s.id].gpaEl;
    if (credits > 0) {
      const semGpa = qp / credits;
      gpaEl.innerHTML = '';
      gpaEl.append('GPA ');
      const b = document.createElement('b');
      b.textContent = semGpa.toFixed(2);
      gpaEl.appendChild(b);
      gpaEl.append(` · ${fmtMc(credits)} MCs`);
    } else {
      gpaEl.textContent = '–';
    }

    totalQp += qp;
    totalCredits += credits;
  }

  const cumEl = document.getElementById('cum-gpa');
  const classEl = document.getElementById('cum-class');
  if (totalCredits > 0) {
    const gpa = totalQp / totalCredits;
    cumEl.textContent = gpa.toFixed(2);
    classEl.textContent = classification(gpa);
  } else {
    cumEl.textContent = '–';
    classEl.textContent = '';
  }
  document.getElementById('stat-total').textContent = fmtMc(earnedMcs);
  document.getElementById('stat-su').textContent = fmtMc(suCredits);
  const left = Math.max(0, GRADUATION_MCS - earnedMcs);
  document.getElementById('stat-total-label').textContent =
    left > 0 ? `Total MCs · ${fmtMc(left)} to graduation` : 'Total MCs · requirement met';
  document.getElementById('mc-progress-fill').style.width =
    `${Math.min(100, (earnedMcs / GRADUATION_MCS) * 100)}%`;
}

function fmtMc(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ---------- Init ----------

document.getElementById('reset-btn').addEventListener('click', () => {
  if (!confirm('Clear all modules and grades?')) return;
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
