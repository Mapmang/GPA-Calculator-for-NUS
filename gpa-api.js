export const GRADE_SCALE = {
    'A+': 5.0,
    A: 5.0,
    'A-': 4.5,
    'B+': 4.0,
    B: 3.5,
    'B-': 3.0,
    'C+': 2.5,
    C: 2.0,
    'D+': 1.5,
    D: 1.0,
    F: 0.0
};

export const SEMESTERS = [
    { key: 'Y1_S1', label: 'Y1 S1', year: 1 },
    { key: 'Y1_S2', label: 'Y1 S2', year: 1 },
    { key: 'Y2_S1', label: 'Y2 S1', year: 2 },
    { key: 'Y2_S2', label: 'Y2 S2', year: 2 },
    { key: 'Y3_S1', label: 'Y3 S1', year: 3 },
    { key: 'Y3_S2', label: 'Y3 S2', year: 3 },
    { key: 'Y4_S1', label: 'Y4 S1', year: 4 },
    { key: 'Y4_S2', label: 'Y4 S2', year: 4 }
];

export const YEARS = [
    { id: 1, name: 'Year 1', semesters: [{ id: 'S1', name: 'Semester 1' }, { id: 'S2', name: 'Semester 2' }] },
    { id: 2, name: 'Year 2', semesters: [{ id: 'S1', name: 'Semester 1' }, { id: 'S2', name: 'Semester 2' }] },
    { id: 3, name: 'Year 3', semesters: [{ id: 'S1', name: 'Semester 1' }, { id: 'S2', name: 'Semester 2' }] },
    { id: 4, name: 'Year 4', semesters: [{ id: 'S1', name: 'Semester 1' }, { id: 'S2', name: 'Semester 2' }] }
];

export function createBlankData(rowsPerSemester = 4) {
    const data = {};

    SEMESTERS.forEach(({ key }) => {
        data[key] = Array.from({ length: rowsPerSemester }, () => ({
            name: '',
            grade: '',
            credits: null,
            su: false
        }));
    });

    return data;
}

export function calculateGpa(data = {}) {
    const totals = {
        qualityPoints: 0,
        gpaCredits: 0,
        earnedCredits: 0,
        suCredits: 0
    };
    const semesters = {};
    const years = {
        1: { qualityPoints: 0, gpaCredits: 0, gpa: null },
        2: { qualityPoints: 0, gpaCredits: 0, gpa: null },
        3: { qualityPoints: 0, gpaCredits: 0, gpa: null },
        4: { qualityPoints: 0, gpaCredits: 0, gpa: null }
    };
    const trend = [];

    SEMESTERS.forEach(({ key, label, year }) => {
        const semester = calculateSemester(data[key] || []);
        semesters[key] = semester;

        totals.qualityPoints += semester.qualityPoints;
        totals.gpaCredits += semester.gpaCredits;
        totals.earnedCredits += semester.earnedCredits;
        totals.suCredits += semester.suCredits;

        years[year].qualityPoints += semester.qualityPoints;
        years[year].gpaCredits += semester.gpaCredits;
        trend.push({ label, gpa: semester.gpa });
    });

    Object.values(years).forEach(year => {
        year.gpa = divideOrNull(year.qualityPoints, year.gpaCredits);
    });

    const cumulativeGpa = divideOrNull(totals.qualityPoints, totals.gpaCredits);

    return {
        semesters,
        years,
        trend,
        totals,
        cumulativeGpa: cumulativeGpa ?? 0,
        classification: getClassification(cumulativeGpa, totals.gpaCredits)
    };
}

function calculateSemester(modules) {
    const result = {
        qualityPoints: 0,
        gpaCredits: 0,
        earnedCredits: 0,
        suCredits: 0,
        gpa: null
    };

    modules.forEach(module => {
        const credits = Number.parseFloat(module.credits);
        if (Number.isNaN(credits) || credits <= 0) return;

        if (module.su) {
            result.suCredits += credits;
            if (Object.prototype.hasOwnProperty.call(GRADE_SCALE, module.grade) && module.grade !== 'F') {
                result.earnedCredits += credits;
            }
            return;
        }

        const hasGrade = Object.prototype.hasOwnProperty.call(GRADE_SCALE, module.grade);
        if (!hasGrade) return;

        result.gpaCredits += credits;
        result.qualityPoints += GRADE_SCALE[module.grade] * credits;
        if (module.grade !== 'F') result.earnedCredits += credits;
    });

    result.gpa = divideOrNull(result.qualityPoints, result.gpaCredits);
    return result;
}

function divideOrNull(numerator, denominator) {
    return denominator > 0 ? numerator / denominator : null;
}

function getClassification(gpa, gpaCredits) {
    if (gpaCredits === 0) return { label: 'Classification: -', tone: 'empty' };
    if (gpa >= 4.5) return { label: 'Highest Distinction', tone: 'excellent' };
    if (gpa >= 4.0) return { label: 'Distinction', tone: 'strong' };
    if (gpa >= 3.5) return { label: 'Merit', tone: 'good' };
    if (gpa >= 3.0) return { label: 'Honours', tone: 'warning' };
    if (gpa >= 2.0) return { label: 'Pass', tone: 'neutral' };
    return { label: 'Fail / No Class', tone: 'danger' };
}
