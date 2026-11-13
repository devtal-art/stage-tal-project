const Project = require('../models/Project');
const projectExcelParser = require('../services/projectExcelParser.service');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { PROJECT_STATUSES } = require('../utils/projectStatuses');
const { PROJECT_FREQUENCIES } = require('../utils/projectFrequencies');
const { BASE_DEPARTMENTS, normalizeProjectDepartment } = require('../utils/projectDepartments');

const cleanupFile = (filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

const PARSER_ERROR_CODES = ['INVALID_HEADERS', 'EMPTY_FILE', 'CORRUPTED_FILE'];

// Flags, in place, every valid record whose exact (Year, Brand, Category,
// Department, Month, Project, Task, Week) combination already exists in the database -
// distinct from the parser's own isDuplicate, which only catches repeats
// within the uploaded file itself. Uploads are additive now (see
// uploadProjects below), so a row can be a "new" duplicate of something
// saved by an earlier, unrelated upload, not just of another row in this one.
//
// Also returns the Status backfill plan: for an existing match whose saved
// status is blank (every project from before Status existed) and whose
// uploaded row carries a status, that one blank field is the only thing an
// upload may ever change on an existing project. A saved status is never
// overwritten, and the matching record is flagged updatesExistingStatus so
// the preview can say so.
const markExistingDuplicates = async (records) => {
  const validRecords = records.filter((r) => r.valid);
  if (validRecords.length === 0) return [];

  const existing = await Project.find({}, 'year brand category department month taskName description weekNo status').lean();
  const existingByKey = new Map();
  existing.forEach((p) => {
    const key = projectExcelParser.buildDedupeKey(p);
    if (!existingByKey.has(key)) existingByKey.set(key, []);
    existingByKey.get(key).push(p);
  });

  const claimedIds = new Set();
  const statusUpdates = [];

  validRecords.forEach((r) => {
    const matches = existingByKey.get(projectExcelParser.buildDedupeKey(r));
    r.existsInDatabase = !!matches;
    if (!matches || !r.status) return;

    const blanks = matches.filter((p) => !p.status && !claimedIds.has(String(p._id)));
    if (blanks.length === 0) return;

    r.updatesExistingStatus = true;
    blanks.forEach((p) => {
      claimedIds.add(String(p._id));
      statusUpdates.push({ id: p._id, status: r.status });
    });
  });

  return statusUpdates;
};

// The preview's summary: how the file was read and what it contains. Similar
// project / brand names (in the file, or against what's saved) are listed as
// possible duplicates - never merged automatically.
const buildSummary = async (records, info) => {
  const valid = records.filter((r) => r.valid);
  const [savedProjects, savedBrands] = await Promise.all([Project.distinct('taskName'), Project.distinct('brand')]);
  const possibleDuplicates = [
    ...projectExcelParser.findSimilarNames(valid.map((r) => r.taskName), savedProjects).map((p) => ({ kind: 'Project', ...p })),
    ...projectExcelParser.findSimilarNames(valid.map((r) => r.brand), savedBrands).map((p) => ({ kind: 'Brand', ...p })),
  ];
  return {
    ...info,
    rowCount: records.length,
    validCount: valid.length,
    projectCount: new Set(valid.map((r) => r.taskName.toLowerCase())).size,
    noTaskCount: valid.filter((r) => !r.description).length,
    noStatusCount: valid.filter((r) => !r.status).length,
    possibleDuplicates,
    sampleRows: valid.slice(0, 8),
  };
};

// Added to the save message when a tab used an older header layout.
const mappingNote = (info) => {
  const older = info.mappings.filter((m) => m.mode !== 'new');
  return older.length ? ' ' + older.map((m) => m.sheet + ': ' + m.message).join(' ') : '';
};

const countUnrecognizedStatus = (records) => records.filter((r) => r.valid && r.unrecognizedStatus).length;
const countUnrecognizedFrequency = (records) => records.filter((r) => r.valid && r.unrecognizedFrequency).length;

// Parses the uploaded file and returns the full preview (valid + invalid
// rows, in-file duplicate flags, and now also which valid rows already exist
// in the database) without touching the DB, so the client can show the user
// exactly what will be added before they confirm.
exports.previewProjects = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }

  try {
    const { records, invalidCount, duplicateCount, info } = projectExcelParser.parseProjectsExcel(req.file.path);
    await markExistingDuplicates(records);
    const existingDuplicateCount = records.filter((r) => r.existsInDatabase).length;
    const statusUpdateCount = records.filter((r) => r.updatesExistingStatus).length;
    const unrecognizedStatusCount = countUnrecognizedStatus(records);
    const unrecognizedFrequencyCount = countUnrecognizedFrequency(records);
    const summary = await buildSummary(records, info);
    res.status(200).json({ records, invalidCount, duplicateCount, existingDuplicateCount, statusUpdateCount, unrecognizedStatusCount, unrecognizedFrequencyCount, summary });
  } catch (error) {
    const status = PARSER_ERROR_CODES.includes(error.code) ? 400 : 500;
    res.status(status).json({ message: error.message });
  } finally {
    cleanupFile(req.file.path);
  }
};

// Additive save: existing project records are never deleted or modified.
// Only fully valid rows are persisted, and among those, only rows whose
// exact field combination isn't already saved - so re-uploading a sheet (or
// uploading one that overlaps a prior upload) adds what's new instead of
// creating duplicate entries or wiping unrelated prior data.
exports.uploadProjects = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }

  try {
    const { records, invalidCount, info } = projectExcelParser.parseProjectsExcel(req.file.path);
    const validRecords = records.filter((r) => r.valid);

    if (validRecords.length === 0) {
      return res.status(400).json({ message: 'No valid project rows were found in the uploaded file.' });
    }

    const statusUpdates = await markExistingDuplicates(records);
    const newRecords = validRecords.filter((r) => !r.existsInDatabase);
    const existingDuplicateCount = validRecords.length - newRecords.length;
    const unrecognizedStatusCount = countUnrecognizedStatus(records);
    const unrecognizedFrequencyCount = countUnrecognizedFrequency(records);

    if (newRecords.length === 0 && statusUpdates.length === 0) {
      return res.status(400).json({
        message: `No new project records to add - all ${existingDuplicateCount} valid row(s) already exist in the database.`,
      });
    }

    // The filter re-checks that the saved status is still blank at write
    // time, so even a concurrent change can't be overwritten.
    let statusUpdatedCount = 0;
    if (statusUpdates.length > 0) {
      const result = await Project.bulkWrite(
        statusUpdates.map(({ id, status }) => ({
          updateOne: {
            filter: { _id: id, $or: [{ status: { $exists: false } }, { status: '' }] },
            update: { $set: { status } },
          },
        })),
      );
      statusUpdatedCount = result.modifiedCount || 0;
    }

    if (newRecords.length > 0) {
      await Project.insertMany(newRecords);
    }

    const statusNote = statusUpdatedCount > 0 ? ` Status was filled in for ${statusUpdatedCount} existing project(s) that had none.` : '';
    const unrecognizedNote = unrecognizedStatusCount > 0 ? ` ${unrecognizedStatusCount} row(s) had an unrecognized Status and were saved without one.` : '';
    const unrecognizedFrequencyNote = unrecognizedFrequencyCount > 0 ? ` ${unrecognizedFrequencyCount} row(s) had an unrecognized Frequency and were saved without one.` : '';

    res.status(200).json({
      message: `Added ${newRecords.length} new project record(s). ${existingDuplicateCount} already existed and were skipped. ${invalidCount} invalid row(s) were skipped.${statusNote}${unrecognizedNote}${unrecognizedFrequencyNote}${mappingNote(info)}`,
      count: newRecords.length,
      existingDuplicateCount,
      invalidCount,
      statusUpdatedCount,
      unrecognizedStatusCount,
      unrecognizedFrequencyCount,
    });
  } catch (error) {
    const status = PARSER_ERROR_CODES.includes(error.code) ? 400 : 500;
    res.status(status).json({ message: error.message });
  } finally {
    cleanupFile(req.file.path);
  }
};

exports.getProjects = async (req, res) => {
  try {
    const projects = await Project.find().sort({ createdAt: -1 }).lean();
    res.json(projects);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch projects', error: error.message });
  }
};

// Blank upload template: the "Projects" tab with the new headers, and Brand,
// Category, Department, Month, Status and Frequency as dropdowns whose values
// sit on a "Lists" tab (brands/categories/departments from the saved data).
const TEMPLATE_HEADERS = ['Year', 'Brand', 'Category', 'Department', 'Week No.', 'Month', 'Project Name', 'Task Name', 'Links', 'Status', 'Frequency'];
const TEMPLATE_WIDTHS = [8, 24, 26, 16, 10, 8, 30, 50, 45, 14, 12];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TEMPLATE_ROWS = 1000;
const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

exports.downloadTemplate = async (req, res) => {
  try {
    const [brands, categories, departments] = await Promise.all([
      Project.distinct('brand'),
      Project.distinct('category'),
      Project.distinct('department'),
    ]);
    const lists = {
      Brand: brands.filter(Boolean).sort(byName),
      Category: Array.from(new Set([...categories.filter(Boolean), 'UI/UX Design'])).sort(byName),
      Department: Array.from(new Set([...BASE_DEPARTMENTS, ...departments.map(normalizeProjectDepartment).filter(Boolean)])),
      Month: MONTHS,
      Status: PROJECT_STATUSES,
      Frequency: PROJECT_FREQUENCIES,
    };

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Projects', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = TEMPLATE_HEADERS.map((header, i) => ({ header, width: TEMPLATE_WIDTHS[i] }));
    sheet.getRow(1).font = { bold: true };

    const listSheet = workbook.addWorksheet('Lists');
    Object.entries(lists).forEach(([name, values], i) => {
      const listColumn = listSheet.getColumn(i + 1);
      listColumn.width = 26;
      listSheet.getCell(1, i + 1).value = name;
      listSheet.getCell(1, i + 1).font = { bold: true };
      values.forEach((value, j) => { listSheet.getCell(j + 2, i + 1).value = value; });

      const from = listColumn.letter;
      const target = sheet.getColumn(TEMPLATE_HEADERS.indexOf(name) + 1).letter;
      const formula = 'Lists!$' + from + '$2:$' + from + '$' + (values.length + 1);
      for (let row = 2; row <= TEMPLATE_ROWS; row += 1) {
        sheet.getCell(target + row).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [formula],
          showErrorMessage: true,
          errorTitle: name,
          error: 'Pick a ' + name + ' from the list (Lists tab).',
        };
      }
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="TAL Project Report Template.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ message: 'Failed to build the template', error: error.message });
  }
};
