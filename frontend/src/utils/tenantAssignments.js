/** Return only records the tenant APIs explicitly mark as active and selectable. */
export function activeAssignableRecords(records) {
  if (!Array.isArray(records)) return [];
  return records.filter((record) => (
    record != null
    && Number.isSafeInteger(Number(record.id))
    && Number(record.id) > 0
    && record.is_active === true
  ));
}

/** Validate controlled Teacher registration rows and identify errors by row. */
export function validateTeacherAssignmentRows(rows = []) {
  const assignments = [];
  const errors = {};
  const seen = new Set();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const classValue = String(row.class_id ?? "").trim();
    const subjectValue = String(row.subject_id ?? "").trim();
    const academicYear = String(row.academic_year ?? "").trim();
    const semesterValue = String(row.semester ?? "").trim();
    const values = [classValue, subjectValue, academicYear, semesterValue];

    if (values.every((value) => value === "")) continue;
    if (values.some((value) => value === "")) {
      errors[index] = "Complete Class, Subject, academic year, and semester, or leave this row empty.";
      continue;
    }

    const classId = Number(classValue);
    const subjectId = Number(subjectValue);
    const semester = Number(semesterValue);
    if (!Number.isSafeInteger(classId) || classId < 1 || !Number.isSafeInteger(subjectId) || subjectId < 1) {
      errors[index] = "Choose a valid Class and Subject.";
      continue;
    }
    if (academicYear.length > 20 || !Number.isInteger(semester) || semester < 1 || semester > 24) {
      errors[index] = "Enter an academic year of at most 20 characters and a semester from 1 to 24.";
      continue;
    }

    const key = JSON.stringify([classId, subjectId, academicYear, semester]);
    if (seen.has(key)) {
      errors[index] = "This duplicates an earlier Class, Subject, academic year, and semester assignment.";
      continue;
    }
    seen.add(key);
    assignments.push({ class_id: classId, subject_id: subjectId, academic_year: academicYear, semester });
  }

  return { assignments: Object.keys(errors).length ? [] : assignments, errors };
}
