import { NUS } from './nus-api.js';
import { GRADE_SCALE, YEARS, calculateGpa, createBlankData } from './gpa-api.js';

const GITHUB_REPO_URL = 'https://github.com/Mapmang/GPA-Calculator-for-NUS';
const STORAGE_KEY = 'university_gpa_su_data_v2';
const PLACEHOLDERS = { name: 'e.g. CS1010E', credits: '4' };

let appData = {};
window.appData = appData;

document.addEventListener('DOMContentLoaded', init);

function init() {
    appData = loadData();
    window.appData = appData;

    document.getElementById('github-profile-btn').href = GITHUB_REPO_URL;
    document.getElementById('clear-all').addEventListener('click', clearAll);
    document.getElementById('acad-year').addEventListener('change', event => NUS.setYear(event.target.value));

    renderGradeScale();
    renderStructure();
    updateSummary();
    NUS.init().catch(() => {});
}

function loadData() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return createBlankData();

    try {
        return JSON.parse(saved);
    } catch (_) {
        return createBlankData();
    }
}

function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
}

function renderGradeScale() {
    const gradeGrid = document.getElementById('grade-grid');
    gradeGrid.innerHTML = '';

    Object.entries(GRADE_SCALE).forEach(([grade, point]) => {
        const badge = document.createElement('div');
        badge.className = 'grade-badge';
        badge.innerHTML = `${grade} <span>${point.toFixed(1)}</span>`;
        gradeGrid.appendChild(badge);
    });
}

function renderStructure() {
    const container = document.getElementById('years-container');
    container.innerHTML = '';

    YEARS.forEach(year => {
        const yearSection = document.createElement('section');
        yearSection.className = 'year-section';
        yearSection.id = `year-${year.id}`;

        yearSection.innerHTML = `
            <div class="year-header">
                <span>${year.name}</span>
                <span class="year-summary-badge" id="year-${year.id}-gpa">Year GPA: -</span>
            </div>
            <div class="semesters-grid"></div>
        `;

        const semesterGrid = yearSection.querySelector('.semesters-grid');
        year.semesters.forEach(semester => {
            const semesterKey = `Y${year.id}_${semester.id}`;
            semesterGrid.appendChild(createSemesterBox(semesterKey, semester.name));
        });

        container.appendChild(yearSection);
    });

    YEARS.forEach(year => {
        year.semesters.forEach(semester => {
            const semesterKey = `Y${year.id}_${semester.id}`;
            (appData[semesterKey] || []).forEach((module, index) => insertRow(semesterKey, module, index));
        });
    });
}

function createSemesterBox(semesterKey, semesterName) {
    const box = document.createElement('div');
    box.className = 'semester-box';
    box.id = `box-${semesterKey}`;

    box.innerHTML = `
        <div class="semester-title-bar">
            <span class="semester-title">${semesterName}</span>
            <span class="sem-gpa-badge" id="badge-${semesterKey}">-</span>
        </div>
        <table>
            <thead>
                <tr>
                    <th style="width: 40%;">Module</th>
                    <th style="width: 20%;">Grade</th>
                    <th style="width: 18%;">Credits</th>
                    <th style="width: 12%; text-align: center;">S/U</th>
                    <th style="width: 10%;"></th>
                </tr>
            </thead>
            <tbody id="tbody-${semesterKey}"></tbody>
        </table>
        <button class="btn-add" type="button" data-action="add-module" data-semester="${semesterKey}">Add Module</button>
        <div class="sem-footer">
            <span id="footer-credits-${semesterKey}">GPA Credits: 0</span>
            <span id="footer-qp-${semesterKey}">QP: 0</span>
        </div>
    `;

    box.querySelector('[data-action="add-module"]').addEventListener('click', () => addModuleRow(semesterKey));
    return box;
}

function insertRow(semesterKey, module, index) {
    const tbody = document.getElementById(`tbody-${semesterKey}`);
    const row = document.createElement('tr');

    row.innerHTML = `
        <td>
            <div class="mod-wrap">
                <input type="text" value="${escapeAttribute(module.name || '')}" placeholder="${index === 0 ? PLACEHOLDERS.name : ''}" autocomplete="off" spellcheck="false">
                <div class="mod-spin"></div>
                <div class="mod-drop"></div>
            </div>
        </td>
        <td>${createGradeSelect(module.grade)}</td>
        <td>
            <input type="text" value="${module.credits ?? ''}" placeholder="${index === 0 ? PLACEHOLDERS.credits : ''}" style="text-align:center;">
        </td>
        <td style="text-align:center;">
            <label class="su-toggle">
                <input type="checkbox" ${module.su ? 'checked' : ''}>
                <span class="slider"></span>
            </label>
        </td>
        <td>
            <button class="btn-delete" type="button" title="Remove Module" aria-label="Remove Module">&times;</button>
        </td>
    `;

    const [nameInput, creditInput] = row.querySelectorAll('input[type="text"]');
    const gradeSelect = row.querySelector('select');
    const suCheckbox = row.querySelector('input[type="checkbox"]');

    nameInput.addEventListener('input', () => updateRowData(semesterKey, row, 'name', nameInput.value));
    gradeSelect.addEventListener('change', () => updateRowData(semesterKey, row, 'grade', gradeSelect.value));
    creditInput.addEventListener('input', () => updateRowData(semesterKey, row, 'credits', normalizeCredits(creditInput.value)));
    suCheckbox.addEventListener('change', () => updateRowData(semesterKey, row, 'su', suCheckbox.checked));
    row.querySelector('.btn-delete').addEventListener('click', () => deleteRow(row, semesterKey));

    tbody.appendChild(row);
    NUS.attach(row, semesterKey);
}

function createGradeSelect(selectedGrade) {
    const options = ['<option value="">-</option>'];

    Object.keys(GRADE_SCALE).forEach(grade => {
        options.push(`<option value="${grade}" ${selectedGrade === grade ? 'selected' : ''}>${grade}</option>`);
    });

    return `<select>${options.join('')}</select>`;
}

function addModuleRow(semesterKey) {
    if (!appData[semesterKey]) appData[semesterKey] = [];

    const module = { name: '', grade: '', credits: null, su: false };
    appData[semesterKey].push(module);
    insertRow(semesterKey, module, appData[semesterKey].length - 1);
    saveData();
    updateSummary();
}

function deleteRow(row, semesterKey) {
    const tbody = document.getElementById(`tbody-${semesterKey}`);
    const index = Array.from(tbody.children).indexOf(row);
    if (index === -1) return;

    appData[semesterKey].splice(index, 1);
    renderStructure();
    saveData();
    updateSummary();
}

function updateRowData(semesterKey, row, field, value) {
    const tbody = document.getElementById(`tbody-${semesterKey}`);
    const index = Array.from(tbody.children).indexOf(row);
    if (index === -1) return;

    appData[semesterKey][index][field] = value;
    saveData();
    updateSummary();
}

function updateSummary() {
    const report = calculateGpa(appData);

    document.getElementById('cum-gpa').innerText = report.totals.gpaCredits > 0
        ? report.cumulativeGpa.toFixed(5)
        : '0.00';
    document.getElementById('total-gpa-credits').innerText = report.totals.gpaCredits;
    document.getElementById('total-earned-credits').innerText = report.totals.earnedCredits;
    document.getElementById('total-qp').innerText = report.totals.qualityPoints.toFixed(1);
    document.getElementById('total-su-credits').innerText = report.totals.suCredits;

    updateClassification(report.classification);
    updateSemesterSummaries(report.semesters);
    updateYearSummaries(report.years);
    renderChart(report.trend);
}

function updateClassification(classification) {
    const badge = document.getElementById('honors-classification');
    const styles = {
        empty: ['#f1f5f9', 'var(--text-main)'],
        excellent: ['#d1fae5', '#065f46'],
        strong: ['#dbeafe', '#1e40af'],
        good: ['#e0e7ff', '#3730a3'],
        warning: ['#fef3c7', '#92400e'],
        neutral: ['#f3f4f6', '#374151'],
        danger: ['#fee2e2', '#991b1b']
    };
    const [background, color] = styles[classification.tone] || styles.empty;

    badge.innerText = classification.label;
    badge.style.backgroundColor = background;
    badge.style.color = color;
}

function updateSemesterSummaries(semesters) {
    Object.entries(semesters).forEach(([semesterKey, semester]) => {
        const badge = document.getElementById(`badge-${semesterKey}`);
        if (badge) {
            badge.innerText = semester.gpa !== null ? semester.gpa.toFixed(2) : '-';
            badge.style.backgroundColor = getGpaColor(semester.gpa);
        }

        document.getElementById(`footer-credits-${semesterKey}`).innerText = `GPA Credits: ${semester.gpaCredits}`;
        document.getElementById(`footer-qp-${semesterKey}`).innerText = `QP: ${semester.qualityPoints.toFixed(1)}`;
    });
}

function updateYearSummaries(years) {
    Object.entries(years).forEach(([year, summary]) => {
        const badge = document.getElementById(`year-${year}-gpa`);
        if (badge) badge.innerText = summary.gpa !== null ? `Year GPA: ${summary.gpa.toFixed(2)}` : 'Year GPA: -';
    });
}

function renderChart(trendData) {
    const chart = document.getElementById('trend-chart');
    chart.innerHTML = '';

    trendData.forEach(item => {
        const wrapper = document.createElement('div');
        wrapper.className = 'bar-wrapper';
        const value = item.gpa ?? 0;

        wrapper.innerHTML = `
            <div class="bar-tooltip">${item.gpa !== null ? item.gpa.toFixed(2) : '-'}</div>
            <div class="bar" style="height: ${(value / 5) * 100}%; ${item.gpa === null ? 'background-color: #cbd5e1;' : ''}"></div>
            <div class="bar-label">${item.label}</div>
        `;
        chart.appendChild(wrapper);
    });
}

function clearAll() {
    if (!confirm('Are you sure you want to clear all data? This will wipe your inputs clean.')) return;

    appData = createBlankData();
    window.appData = appData;
    saveData();
    renderStructure();
    updateSummary();
}

function normalizeCredits(value) {
    return value.trim() === '' ? null : Number.parseFloat(value);
}

function getGpaColor(gpa) {
    if (gpa === null) return '#94a3b8';
    if (gpa >= 4.5) return '#10b981';
    if (gpa >= 3.5) return '#3b82f6';
    if (gpa >= 2.0) return '#f59e0b';
    return '#ef4444';
}

function escapeAttribute(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

window.calculateGPA = updateSummary;
