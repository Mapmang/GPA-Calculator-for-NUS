const PROXY_BASE = '/api/nusmods';
const TTL_MS = 24 * 60 * 60 * 1000;
const LS_LIST = 'nusmods_list_';
const LS_INFO = 'nusmods_info_';
let year = '2025-2026';
let enabled = false;
let listPromise = null;
const infoMemCache = {};

function lsGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore storage errors */ }
}

async function probe() {
    try {
        const response = await fetch(`${PROXY_BASE}/status`);
        enabled = response.ok;
    } catch (_) {
        enabled = false;
    }
    const banner = document.getElementById('cors-banner');
    if (banner) {
        banner.style.display = enabled ? 'none' : 'block';
    }
    return enabled;
}

async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response.json();
}

async function fetchSharedCache(path, params) {
    const url = new URL(`${PROXY_BASE}/${path}`, window.location.origin);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return fetchJson(url);
}

async function fetchList() {
    return fetchSharedCache('module-list', { year });
}

async function fetchInfo(code) {
    return fetchSharedCache('module-info', { year, code });
}

function isFresh(cached) {
    return cached && cached.ts && (Date.now() - cached.ts < TTL_MS);
}

function setYear(value) {
    year = value;
    listPromise = null;
}

function getList() {
    if (listPromise) return listPromise;

    const cached = lsGet(LS_LIST + year);
    if (isFresh(cached)) {
        listPromise = Promise.resolve(cached.data);
    } else {
        listPromise = fetchList()
            .then(data => {
                lsSet(LS_LIST + year, { ts: Date.now(), data });
                return data;
            })
            .catch(() => cached ? cached.data : []);
    }
    return listPromise;
}

function getInfo(code) {
    const normalizedCode = code.toUpperCase();
    const key = `${LS_INFO}${year}_${normalizedCode}`;
    if (infoMemCache[key]) return infoMemCache[key];

    const cached = lsGet(key);
    if (isFresh(cached)) {
        infoMemCache[key] = Promise.resolve(cached.data);
        return infoMemCache[key];
    }

    infoMemCache[key] = fetchInfo(normalizedCode)
        .then(data => {
            if (data) lsSet(key, { ts: Date.now(), data });
            return data;
        })
        .catch(() => cached ? cached.data : null);
    return infoMemCache[key];
}

function filter(list, raw) {
    const up = raw.trim().toUpperCase();
    const lo = raw.trim().toLowerCase();
    return list.filter(m =>
        m.moduleCode.toUpperCase().includes(up) ||
        m.title.toLowerCase().includes(lo)
    ).slice(0, 10);
}

function attach(tr, semKey) {
    const wrap = tr.querySelector('.mod-wrap');
    const input = wrap.querySelector('input[type="text"]');
    const drop = wrap.querySelector('.mod-drop');

    let timer = null;
    let results = [];
    let hi = -1;

    function rowIdx() {
        return tr.parentElement ? Array.from(tr.parentElement.children).indexOf(tr) : -1;
    }

    function creditEl() {
        return tr.querySelector('td:nth-child(3) input');
    }

    function close() {
        drop.classList.remove('open');
        drop.innerHTML = '';
        results = [];
        hi = -1;
    }

    function setHi(n) {
        hi = n;
        drop.querySelectorAll('.mod-item').forEach((el, i) => {
            el.classList.toggle('hi', i === n);
            if (i === n) el.scrollIntoView({ block: 'nearest' });
        });
    }

    function render(items, query) {
        drop.innerHTML = '';
        results = items;
        hi = -1;

        if (!items.length) {
            const message = document.createElement('div');
            message.className = 'mod-msg';
            message.textContent = `No results for "${query}"`;
            drop.appendChild(message);
        } else {
            items.forEach(m => {
                const option = document.createElement('div');
                option.className = 'mod-item';
                option.innerHTML =
                    `<span class="mod-code">${m.moduleCode}</span>` +
                    `<span class="mod-title">${m.title}</span>` +
                    `<span class="mod-mc">${m._mc != null ? m._mc + ' MC' : ''}</span>`;
                option.addEventListener('mousedown', e => { e.preventDefault(); pick(m); });
                drop.appendChild(option);
            });
        }
        drop.classList.add('open');
    }

    async function pick(m) {
        input.value = m.moduleCode;
        close();

        const idx = rowIdx();
        if (idx > -1 && window.appData) {
            window.appData[semKey][idx].name = m.moduleCode;
            window.appData[semKey][idx].grade = window.appData[semKey][idx].grade || window.appData[semKey][idx].grade;
            localStorage.setItem('university_gpa_su_data_v2', JSON.stringify(window.appData));
        }

        wrap.classList.add('loading');
        const info = await getInfo(m.moduleCode);
        wrap.classList.remove('loading');

        if (info && info.moduleCredit != null) {
            const mc = parseFloat(info.moduleCredit);
            if (!isNaN(mc)) {
                const creditInput = creditEl();
                if (creditInput) creditInput.value = mc;
                if (idx > -1 && window.appData) {
                    window.appData[semKey][idx].credits = mc;
                    localStorage.setItem('university_gpa_su_data_v2', JSON.stringify(window.appData));
                }
            }
        }

        if (window.calculateGPA) window.calculateGPA();
    }

    async function search(raw) {
        if (!enabled || raw.trim().length < 2) { close(); return; }
        wrap.classList.add('loading');
        try {
            const list = await getList();
            const filtered = filter(list, raw);
            filtered.forEach(m => {
                const cached = lsGet(`${LS_INFO}${year}_${m.moduleCode.toUpperCase()}`);
                if (isFresh(cached) && cached.data) {
                    m._mc = parseFloat(cached.data.moduleCredit);
                }
            });
            render(filtered, raw.trim());
        } finally {
            wrap.classList.remove('loading');
        }
    }

    input.addEventListener('input', () => {
        const val = input.value;
        const idx = rowIdx();
        if (idx > -1 && window.appData) {
            window.appData[semKey][idx].name = val;
            localStorage.setItem('university_gpa_su_data_v2', JSON.stringify(window.appData));
            if (window.calculateGPA) window.calculateGPA();
        }
        clearTimeout(timer);
        timer = setTimeout(() => search(val), 280);
    });

    input.addEventListener('keydown', e => {
        if (!drop.classList.contains('open')) return;
        const rows = drop.querySelectorAll('.mod-item');
        if (e.key === 'ArrowDown') { e.preventDefault(); setHi(Math.min(hi + 1, rows.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(hi - 1, 0)); }
        else if (e.key === 'Enter' && hi >= 0) { e.preventDefault(); if (results[hi]) pick(results[hi]); }
        else if (e.key === 'Escape') close();
    });

    input.addEventListener('blur', () => setTimeout(close, 160));
    input.addEventListener('focus', () => {
        if (enabled && input.value.trim().length >= 2) search(input.value);
    });
}

async function init() {
    await probe();
    return { enabled };
}

export const NUS = { setYear, attach, init };
