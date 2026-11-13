// Run with: npm test (node --test). Builds real .xlsx files in a temp folder
// and parses them; no database needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const xlsx = require('xlsx');
const parser = require('../services/projectExcelParser.service');
const { normalizeProjectDepartment } = require('../utils/projectDepartments');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tal-parser-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
const writeBook = (tabs) => {
  const wb = xlsx.utils.book_new();
  Object.entries(tabs).forEach(([name, rows]) => xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(rows), name));
  const file = path.join(tmp, `book${(n += 1)}.xlsx`);
  xlsx.writeFile(wb, file);
  return file;
};

const NEW_HEADER = ['Year', 'Brand', 'Category', 'Department', 'Week No.', 'Month', 'Project Name', 'Task Name', 'Links', 'Status', 'Frequency'];

test('department normalization: canonical, de-duplicated, sorted', () => {
  assert.equal(normalizeProjectDepartment('Des,Dev'), 'Des + Dev');
  assert.equal(normalizeProjectDepartment('Des, Dev'), 'Des + Dev');
  assert.equal(normalizeProjectDepartment('Dev + Des'), 'Des + Dev');
  assert.equal(normalizeProjectDepartment('Dev + Admin'), 'Admin + Dev');
  assert.equal(normalizeProjectDepartment('Des,Dev + Strategy'), 'Des + Dev + Strategy');
  assert.equal(normalizeProjectDepartment('Dev, Dev'), 'Dev');
  assert.equal(normalizeProjectDepartment('DM'), 'DM');
  assert.equal(normalizeProjectDepartment(''), '');
});

test('new template, several tabs: reads every Year tab, skips Lists, combines rows', () => {
  const file = writeBook({
    'IVY - Projects': [
      NEW_HEADER,
      ['2026.0', '2 - Ivy Ana', 'Website', 'Dev,Des', '31.0', 'Aug', 'Website Work', 'Check website and make live', 'https://a.example/x', 'Review', ''],
      [2026, '2 - Ivy Ana', 'Website', 'Dev', 32, 'Aug', 'Website Work', 'Sitemap Update', 'Preview: https://b.example\nhttps://c.example', 'Delivered', 'Weekly'],
      [2026, '2 - Ivy Ana', 'Website', 'Dev', 32, 'Aug', 'Website Work', '', '', '', ''],
    ],
    'WA - Projects': [
      NEW_HEADER,
      [2026, '2 - WA', 'UI/UX Design', 'Des', 40, 'Oct', 'Wireframe & Design', 'Home wireframe', '', 'Delivered', 'One-time'],
      ['', '', '', '', '', '', '', '', '', '', ''],
    ],
    Lists: [['Brand', 'Category'], ['2 - WA', 'Website']],
  });
  const { records, invalidCount, info } = parser.parseProjectsExcel(file);
  assert.deepEqual(info.tabs, ['IVY - Projects', 'WA - Projects']);
  assert.deepEqual(info.ignoredTabs, ['Lists']);
  assert.deepEqual(info.mappings.map((m) => m.mode), ['new', 'new']);
  assert.equal(records.length, 4);
  assert.equal(invalidCount, 0);

  const [first, second, third, fourth] = records;
  // Numeric text cells -> integers.
  assert.equal(first.year, 2026);
  assert.equal(first.weekNo, '31');
  // Project Name -> taskName (project), Task Name -> description (task).
  assert.equal(first.taskName, 'Website Work');
  assert.equal(first.description, 'Check website and make live');
  assert.equal(first.department, 'Des + Dev');
  assert.deepEqual(first.links, [{ label: 'Link', url: 'https://a.example/x' }]);
  assert.equal(first.status, 'Review');
  assert.equal(second.links.length, 2);
  assert.equal(second.frequency, 'Weekly');
  // Empty task name and status stay empty (shown as "Task name not uploaded" / "No status").
  assert.equal(third.description, '');
  assert.equal(third.status, '');
  assert.equal(fourth.sheet, 'WA - Projects');
});

test('several tasks of one project in the same month are not duplicates', () => {
  const file = writeBook({
    Projects: [
      NEW_HEADER,
      [2026, 'B', 'Website', 'Dev', 32, 'Aug', 'Website Work', 'Task A', '', '', ''],
      [2026, 'B', 'Website', 'Dev', 32, 'Aug', 'Website Work', 'Task B', '', '', ''],
      [2026, 'B', 'Website', 'Dev', 33, 'Aug', 'Website Work', 'Task B', '', '', ''],
      [2026, 'B', 'Website', 'Dev', 33, 'Aug', 'Website Work', 'Task B', '', '', ''],
    ],
  });
  const { records, duplicateCount } = parser.parseProjectsExcel(file);
  assert.equal(duplicateCount, 2);
  assert.deepEqual(records.map((r) => r.isDuplicate), [false, false, true, true]);
});

test('dedupe key treats department spellings and 31 / 31.0 as the same', () => {
  const base = { year: 2026, brand: 'B', category: 'C', month: 'Aug', taskName: 'P', description: 'T' };
  assert.equal(
    parser.buildDedupeKey({ ...base, department: 'Des,Dev', weekNo: '31' }),
    parser.buildDedupeKey({ ...base, department: 'Dev + Des', weekNo: '31.0' }),
  );
  assert.notEqual(parser.buildDedupeKey({ ...base, department: 'Des', weekNo: '31' }), parser.buildDedupeKey({ ...base, department: 'Des', weekNo: '32' }));
});

test('old template: Task Name -> project, Description -> task, with a mapping message', () => {
  const file = writeBook({
    Sheet1: [
      ['Year', 'Brand', 'Category', 'Department', 'Week', 'Month', 'Task Name', 'Link', 'Status', 'Description'],
      [2025, 'Brand X', 'Social Media', 'Des', 5, 'Feb', 'Instagram Posts', '', 'Delivered', 'Valentine post'],
    ],
  });
  const { records, info } = parser.parseProjectsExcel(file);
  assert.equal(info.mappings[0].mode, 'old');
  assert.match(info.mappings[0].message, /Task Name" was read as the Project Name/);
  assert.equal(records[0].taskName, 'Instagram Posts');
  assert.equal(records[0].description, 'Valentine post');
  assert.equal(records[0].weekNo, '5');
  // No Frequency column: warned, left blank.
  assert.ok(info.warnings.some((w) => w.includes('"Frequency"')));
  assert.equal(records[0].frequency, '');
});

test('oldest template (no Category column): Project Name -> category', () => {
  const file = writeBook({
    Sheet1: [
      ['Year', 'Brand', 'Project Name', 'Department', 'Month', 'Task Name'],
      [2025, 'Brand X', 'Social Media', 'Des', 'Jan', 'Instagram Posts'],
    ],
  });
  const { records, info } = parser.parseProjectsExcel(file);
  assert.equal(info.mappings[0].mode, 'legacy');
  assert.equal(records[0].category, 'Social Media');
  assert.equal(records[0].taskName, 'Instagram Posts');
  assert.equal(records[0].description, '');
});

test('rows without a Project Name are skipped and counted', () => {
  const file = writeBook({
    Projects: [
      NEW_HEADER,
      [2026, 'B', 'Website', 'Dev', 1, 'Jan', '', 'orphan task', '', '', ''],
      [2026, 'B', 'Website', 'Dev', 1, 'Jan', 'Website Work', 'real task', '', '', ''],
    ],
  });
  const { records, info } = parser.parseProjectsExcel(file);
  assert.equal(records.length, 1);
  assert.equal(info.skippedNoProject, 1);
});

test('rows missing a required value are invalid, not dropped', () => {
  const file = writeBook({ Projects: [NEW_HEADER, [2026, '', 'Website', 'Dev', 1, 'Jan', 'Website Work', 'x', '', '', '']] });
  const { records, invalidCount } = parser.parseProjectsExcel(file);
  assert.equal(invalidCount, 1);
  assert.deepEqual(records[0].missingFields, ['Brand']);
});

test('no project and no task column is an error', () => {
  const file = writeBook({ Projects: [['Year', 'Brand', 'Category', 'Department', 'Month'], [2026, 'B', 'C', 'Dev', 'Jan']] });
  assert.throws(() => parser.parseProjectsExcel(file), (err) => err.code === 'INVALID_HEADERS' && /neither a "Project Name" nor a "Task Name"/.test(err.message));
});

test('no tab with a Year header is an error', () => {
  const file = writeBook({ Notes: [['Hello'], ['world']] });
  assert.throws(() => parser.parseProjectsExcel(file), (err) => err.code === 'INVALID_HEADERS');
});

test('header matching ignores case and spaces', () => {
  const file = writeBook({
    Projects: [
      ['  YEAR ', 'brand', 'Category', 'DEPARTMENT', 'week  no.', 'Month', 'project   name', 'TASK NAME', 'links', 'status', 'frequency'],
      [2026, 'B', 'C', 'Dev', 3, 'Jan', 'P', 'T', '', 'delivered', ''],
    ],
  });
  const { records } = parser.parseProjectsExcel(file);
  assert.equal(records[0].taskName, 'P');
  assert.equal(records[0].description, 'T');
  assert.equal(records[0].weekNo, '3');
  assert.equal(records[0].status, 'Delivered');
});

test('possible duplicate names are reported, not merged', () => {
  const pairs = parser.findSimilarNames(['Wireframe & Design', 'Logo'], ['Wireframing & Design', 'Logo', 'Website Work']);
  assert.deepEqual(pairs, [{ a: 'Wireframe & Design', b: 'Wireframing & Design', where: 'saved' }]);
  assert.deepEqual(parser.findSimilarNames(['Website Work', 'website  work'], []), [{ a: 'Website Work', b: 'website  work', where: 'file' }]);
  assert.equal(parser.isSimilar('AWS Optimisation', 'AWS optimization'), true);
  assert.equal(parser.isSimilar('Audit and Maintainance', 'Audit and Maintenance'), true);
  // Monthly editions are different work, not duplicates.
  assert.equal(parser.isSimilar('April Promo Flyers and Banners', 'June Promo Flyers and Banners'), false);
  assert.equal(parser.isSimilar('MayPromo Flyers and Banners', 'April Promo Flyers and Banners'), false);
  assert.equal(parser.isSimilar('Logo', 'Blog'), false);
  assert.equal(parser.isSimilar('Website Work', 'Social Media'), false);
});
