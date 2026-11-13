// Project sheet departments: one canonical spelling for combined values.
// Parts are split on , + & /, de-duplicated, sorted A-Z and joined by " + ":
//   "Des,Dev", "Des, Dev", "Dev + Des" -> "Des + Dev"
//   "Dev + Admin"                      -> "Admin + Dev"
// Mirrors normalizeDepartment in client/src/components/projects/constants.js.
// (Unrelated to departmentMap.js, which is for attendance employees.)
const BASE_DEPARTMENTS = ['Des', 'Dev', 'Admin', 'DM', 'Strategy'];

const normalizeProjectDepartment = (department) =>
  Array.from(new Set(String(department ?? '').split(/\s*[,+&/]\s*/).map((d) => d.trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .join(' + ');

module.exports = { BASE_DEPARTMENTS, normalizeProjectDepartment };
