const xlsx = require('xlsx');
const { normalizeStatus } = require('../utils/projectStatuses');
const { normalizeFrequency } = require('../utils/projectFrequencies');
const { normalizeProjectDepartment } = require('../utils/projectDepartments');

// Project sheet parser.
//
// Saved field names are unchanged (no data migration): `taskName` holds the
// PROJECT name and `description` holds the TASK. Three header layouts are
// understood, decided per tab:
//
//   new     Year, Brand, Category, Department, Week No., Month, Project Name,
//           Task Name, Links, Status, Frequency
//           -> Project Name = project, Task Name = task
//   old     ... Task Name, Description (no Project Name column)
//           -> Task Name = project, Description = task
//   legacy  ... Project Name, Task Name and NO Category column (the very first
//           sheets used "Project Name" for the category)
//           -> Project Name = category, Task Name = project, Description = task
//
// Every tab whose first row has a "Year" header is read (except one named
// "Lists", which holds the template's dropdown values) and the rows combined.
// Header matching ignores case and extra spaces.

const ALIASES = {
  year: ['year', 'years'],
  brand: ['brand', 'brands'],
  category: ['category', 'categories'],
  department: ['department', 'departments', 'dept'],
  month: ['month', 'months'],
  projectName: ['project name', 'project names', 'project'],
  taskName: ['task name', 'task names', 'task'],
  description: ['description', 'descriptions', 'work description'],
  weekNo: ['week no', 'week no.', 'week number', 'week', 'wk'],
  links: ['links', 'link'],
  status: ['status'],
  frequency: ['frequency', 'frequencies'],
};

// Saved fields every row must have to be valid (taskName = the project).
const REQUIRED_FIELDS = ['year', 'brand', 'category', 'department', 'month', 'taskName'];
const LABELS = {
  year: 'Year',
  brand: 'Brand',
  category: 'Category',
  department: 'Department',
  month: 'Month',
  taskName: 'Project Name',
};
// Columns a tab cannot do without (Category is checked per layout).
const REQUIRED_COLUMNS = ['year', 'brand', 'department', 'month'];
const OPTIONAL_COLUMNS = { weekNo: 'Week No.', links: 'Links', status: 'Status', frequency: 'Frequency' };

const MAPPING_MESSAGES = {
  new: 'New template: "Project Name" = project, "Task Name" = task.',
  old: 'Old template: "Task Name" was read as the Project Name and "Description" as the Task Name.',
  legacy: 'Oldest template (no Category column): "Project Name" was read as the Category, "Task Name" as the Project Name and "Description" as the Task Name.',
};

const normalizeHeader = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const normalizeValue = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
// Excel numbers can arrive as "2026.0" / "31.0" - read them as integers.
const normalizeInteger = (value) => {
  const text = normalizeValue(value);
  return /^\d+(\.0+)?$/.test(text) ? String(parseInt(text, 10)) : text;
};

const parserError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

// Strict-duplicate key: the same project, task and week in the same
// year/month/brand/category/department (case-insensitive, departments in
// canonical form). Shared by the in-file check below and the controller's
// check against what's already saved. Task and week are part of it so that
// several tasks of one project in one month are all kept.
const buildDedupeKey = (record) =>
  [
    record.year,
    record.brand,
    record.category,
    normalizeProjectDepartment(record.department),
    record.month,
    record.taskName,
    record.description,
    normalizeInteger(record.weekNo),
  ]
    .map((value) => normalizeValue(value).toLowerCase())
    .join('|');
exports.buildDedupeKey = buildDedupeKey;

// A Links cell holds one "Label: https://..." (or just a URL) per line. A
// line with no recognizable URL is skipped - Links is optional.
const URL_PATTERN = /(https?:\/\/\S+)/i;
const parseLinks = (cellValue) => {
  const raw = String(cellValue ?? '');
  if (!raw.trim()) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(URL_PATTERN);
      if (!match) return null;
      const url = match[1].trim();
      const label = line.slice(0, match.index).replace(/:\s*$/, '').trim() || 'Link';
      return { label, url };
    })
    .filter(Boolean);
};

const findColumn = (headers, field) => headers.findIndex((h) => ALIASES[field].includes(h));

// Which layout a tab uses and which column feeds each saved field.
const resolveColumns = (headers, sheetName) => {
  const col = {};
  Object.keys(ALIASES).forEach((field) => { col[field] = findColumn(headers, field); });
  const has = (field) => col[field] !== -1;

  let mode;
  const map = {};
  if (has('projectName') && (has('category') || !has('taskName'))) {
    mode = 'new';
    map.category = col.category;
    map.taskName = col.projectName;
    map.description = has('taskName') ? col.taskName : col.description;
  } else if (has('taskName') && !has('projectName')) {
    mode = 'old';
    map.category = col.category;
    map.taskName = col.taskName;
    map.description = col.description;
  } else if (has('projectName') && has('taskName')) {
    mode = 'legacy';
    map.category = col.projectName;
    map.taskName = col.taskName;
    map.description = col.description;
  } else {
    throw parserError('INVALID_HEADERS', `Tab "${sheetName}" has neither a "Project Name" nor a "Task Name" column, so projects can't be read.`);
  }

  const missing = REQUIRED_COLUMNS.filter((f) => !has(f)).map((f) => LABELS[f]);
  if (map.category === -1) missing.push('Category');
  if (missing.length) {
    throw parserError('INVALID_HEADERS', `Tab "${sheetName}" is missing the column(s): ${missing.join(', ')}.`);
  }
  REQUIRED_COLUMNS.forEach((f) => { map[f] = col[f]; });
  Object.keys(OPTIONAL_COLUMNS).forEach((f) => { map[f] = col[f]; });

  const warnings = Object.entries(OPTIONAL_COLUMNS)
    .filter(([f]) => map[f] === -1)
    .map(([, label]) => `Tab "${sheetName}": no "${label}" column - left blank.`);
  if (map.description === -1) {
    warnings.push(`Tab "${sheetName}": no ${mode === 'new' ? '"Task Name"' : '"Description"'} column - task names left blank.`);
  }
  return { mode, map, warnings };
};

const cell = (row, index) => (index === -1 ? '' : row[index]);

exports.parseProjectsExcel = (filePath) => {
  let workbook;
  try {
    workbook = xlsx.readFile(filePath);
  } catch (err) {
    throw parserError('CORRUPTED_FILE', 'The uploaded file could not be read. It may be corrupted or not a valid Excel/CSV file.');
  }
  if (!workbook.SheetNames.length) throw parserError('EMPTY_FILE', 'The uploaded file has no sheets.');

  const tabs = [];
  const ignoredTabs = [];
  workbook.SheetNames.forEach((name) => {
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', blankrows: false });
    const headers = Array.isArray(rows[0]) ? rows[0].map(normalizeHeader) : [];
    if (name.trim().toLowerCase() === 'lists' || !headers.includes('year')) {
      ignoredTabs.push(name);
      return;
    }
    tabs.push({ name, rows, headers });
  });

  if (tabs.length === 0) {
    const anyRows = workbook.SheetNames.some((name) => xlsx.utils.sheet_to_json(workbook.Sheets[name], { header: 1, blankrows: false }).length);
    if (!anyRows) throw parserError('EMPTY_FILE', 'The uploaded file is empty.');
    throw parserError('INVALID_HEADERS', 'No tab has a "Year" header in its first row. Expected columns: Year, Brand, Category, Department, Week No., Month, Project Name, Task Name, Links, Status, Frequency.');
  }

  const records = [];
  const mappings = [];
  const warnings = [];
  let skippedNoProject = 0;

  tabs.forEach(({ name, rows, headers }) => {
    const { mode, map, warnings: tabWarnings } = resolveColumns(headers, name);
    mappings.push({ sheet: name, mode, message: MAPPING_MESSAGES[mode] });
    warnings.push(...tabWarnings);

    rows.slice(1).forEach((row, index) => {
      const record = {
        sheet: name,
        rowNumber: index + 2, // +1 header row, +1 for 1-based numbering
        year: normalizeInteger(cell(row, map.year)),
        brand: normalizeValue(cell(row, map.brand)),
        category: normalizeValue(cell(row, map.category)),
        department: normalizeProjectDepartment(cell(row, map.department)),
        month: normalizeValue(cell(row, map.month)),
        taskName: normalizeValue(cell(row, map.taskName)),
        weekNo: normalizeInteger(cell(row, map.weekNo)),
        links: parseLinks(cell(row, map.links)),
        // Free text: only trimmed, so a multi-line cell keeps its line breaks.
        description: String(cell(row, map.description) ?? '').trim(),
      };

      // A row with no project at all (typically a spacer or note row) is
      // dropped, not reported as invalid.
      if (!record.taskName) {
        const hasAnything = [record.year, record.brand, record.category, record.department, record.month, record.description].some(Boolean);
        if (hasAnything) skippedNoProject += 1;
        return;
      }

      // Status / Frequency: one of the allowed values or blank. Anything
      // else is saved as blank and flagged in the preview.
      const rawStatus = normalizeValue(cell(row, map.status));
      record.status = normalizeStatus(rawStatus);
      record.unrecognizedStatus = rawStatus && !record.status ? rawStatus : '';
      const rawFrequency = normalizeValue(cell(row, map.frequency));
      record.frequency = normalizeFrequency(rawFrequency);
      record.unrecognizedFrequency = rawFrequency && !record.frequency ? rawFrequency : '';

      const yearNum = parseInt(record.year, 10);
      record.year = Number.isNaN(yearNum) ? record.year : yearNum;

      record.missingFields = REQUIRED_FIELDS.filter((field) => record[field] === '' || record[field] == null).map((field) => LABELS[field]);
      record.valid = record.missingFields.length === 0;
      record.isDuplicate = false;
      records.push(record);
    });
  });

  if (skippedNoProject) warnings.push(`${skippedNoProject} row(s) without a Project Name were skipped.`);

  // Exact repeats within the file (valid rows only) - flagged, not removed.
  const duplicateGroups = new Map();
  records.forEach((record) => {
    if (!record.valid) return;
    const key = buildDedupeKey(record);
    if (!duplicateGroups.has(key)) duplicateGroups.set(key, []);
    duplicateGroups.get(key).push(record);
  });
  duplicateGroups.forEach((group) => {
    if (group.length > 1) group.forEach((record) => { record.isDuplicate = true; });
  });

  return {
    records,
    invalidCount: records.filter((r) => !r.valid).length,
    duplicateCount: records.filter((r) => r.isDuplicate).length,
    info: {
      tabs: tabs.map((t) => t.name),
      ignoredTabs,
      mappings,
      warnings,
      skippedNoProject,
    },
  };
};

// ---------------------------------------------------------------------------
// Possible duplicate names (never merged automatically - only reported):
// two names whose letters+digits are equal, or nearly equal
// ("Wireframe & Design" vs "Wireframing & Design").
const squash = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const levenshtein = (a, b) => {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
};

// "April Promo Flyers" vs "June Promo Flyers" are different monthly editions,
// not a typo: names that differ only by a month are never paired.
const MONTH_WORDS = /\b(january|february|march|april|may|june|july|august|september|october|november|december)|\b(jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\b/gi;

const SIMILARITY = 0.8;
const MAX_EDITS = 4;
const isSimilar = (a, b) => {
  const x = squash(a);
  const y = squash(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (squash(String(a).replace(MONTH_WORDS, '')) === squash(String(b).replace(MONTH_WORDS, ''))) return false;
  const longest = Math.max(x.length, y.length);
  if (Math.min(x.length, y.length) < 5 || Math.abs(x.length - y.length) > MAX_EDITS) return false;
  const edits = levenshtein(x, y);
  return edits <= MAX_EDITS && 1 - edits / longest >= SIMILARITY;
};

// Pairs of different names where at least one comes from this upload.
// `saved` = names already in the database.
exports.findSimilarNames = (uploaded, saved = []) => {
  const fromFile = Array.from(new Set(uploaded.filter(Boolean)));
  const savedSet = new Set(saved.filter(Boolean));
  const pairs = [];
  const seen = new Set();
  const add = (a, b, where) => {
    const key = [a, b].sort().join('\u0000');
    if (a === b || seen.has(key)) return;
    seen.add(key);
    pairs.push({ a, b, where });
  };
  fromFile.forEach((name, i) => {
    fromFile.slice(i + 1).forEach((other) => { if (isSimilar(name, other)) add(name, other, 'file'); });
    savedSet.forEach((other) => { if (!fromFile.includes(other) && isSimilar(name, other)) add(name, other, 'saved'); });
  });
  return pairs;
};

exports.normalizeInteger = normalizeInteger;
exports.isSimilar = isSimilar;
