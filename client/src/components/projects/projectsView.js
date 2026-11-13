import { monthIndex, NO_STATUS_LABEL, splitDepartments } from './constants';

// View-model for the Projects page (grouped list + "All items" table).
// Pure functions over the already-filtered records, so the numbers here always
// agree with the filters / export (same records, just arranged differently).

// Display order of the status chips and progress-bar segments.
export const STATUS_ORDER = ['Delivered', 'In Progress', 'Review', 'Hold', 'Not Started', 'Cancelled', NO_STATUS_LABEL];

export const STATUS_COLORS = {
  Delivered: 'oklch(0.62 0.12 155)',
  'In Progress': 'oklch(0.58 0.15 255)',
  Review: 'oklch(0.76 0.14 80)',
  Hold: 'oklch(0.6 0.1 305)',
  'Not Started': '#a8a49b',
  Cancelled: 'oklch(0.6 0.12 25)',
  [NO_STATUS_LABEL]: '#d9d5cb',
};

export const statusOf = (r) => r.status || NO_STATUS_LABEL;
export const statusLabel = (s) => (s === NO_STATUS_LABEL ? 'No status' : s);

export const GROUPS = [
  { id: 'task', label: 'Projects', unit: 'projects', head: 'Project' },
  { id: 'brand', label: 'Brand', unit: 'brands', head: 'Brand' },
  { id: 'category', label: 'Category', unit: 'categories', head: 'Category' },
  { id: 'status', label: 'Status', unit: 'statuses', head: 'Status' },
  { id: 'items', label: 'All items', unit: 'items', head: 'Project' },
];
export const GROUP_IDS = GROUPS.map((g) => g.id);

// Year*12 + month, so months sort across years. Unknown month sorts first.
const rec = (r) => (Number(r.year) || 0) * 12 + Math.min(monthIndex(r.month), 11);
const weekNum = (r) => parseInt(r.weekNo, 10) || 0;
const byText = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
const uniq = (arr) => Array.from(new Set(arr.filter((v) => v !== '' && v != null)));

// "3 - Lit Wholesale" -> "Lit Wholesale" (brand codes are "<n> - <name>").
export const shortBrand = (b) => String(b ?? '').split(' - ')[1] || String(b ?? '');
export const deptText = (r) => splitDepartments(r.department).sort().join(' + ') || '—';
export const weekText = (r) => (String(r.weekNo ?? '').trim() ? `Wk ${String(r.weekNo).trim()}` : '—');
export const monthYear = (r) => `${r.month} ${r.year}`;
export const whenText = (r) => (String(r.weekNo ?? '').trim() ? `${r.year} · Wk ${String(r.weekNo).trim()} ${r.month}` : `${r.year} · ${r.month}`);

// Active period of a set of records: "Jan – Oct 2026" + "10 active months".
const periodOf = (records) => {
  const sorted = records.slice().sort((x, y) => rec(x) - rec(y));
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  const months = new Set(records.map((r) => `${r.year}-${r.month}`)).size;
  let text;
  if (String(lo.year) === String(hi.year)) {
    text = lo.month === hi.month ? `${lo.month} ${lo.year}` : `${lo.month} – ${hi.month} ${lo.year}`;
  } else {
    text = `${lo.month} ${lo.year} – ${hi.month} ${hi.year}`;
  }
  return { text, span: `${months} active month${months === 1 ? '' : 's'}`, last: rec(hi) };
};

const statusCounts = (records) => {
  const counts = {};
  records.forEach((r) => {
    const s = statusOf(r);
    counts[s] = (counts[s] || 0) + 1;
  });
  return counts;
};

// Stacked progress bar segments (percent widths) in STATUS_ORDER.
const segmentsOf = (counts, total) =>
  STATUS_ORDER.filter((s) => counts[s]).map((s) => ({ status: s, width: `${(counts[s] / total) * 100}%`, color: STATUS_COLORS[s] }));

const progressOf = (records, withNoStatus) => {
  const counts = statusCounts(records);
  const delivered = counts.Delivered || 0;
  const none = counts[NO_STATUS_LABEL] || 0;
  return {
    segments: segmentsOf(counts, records.length),
    text: `${delivered} of ${records.length} delivered${withNoStatus && none ? ` · ${none} no status` : ''}`,
  };
};

// Newest first: month, then week.
export const sortItemsRecent = (records) => records.slice().sort((x, y) => rec(y) - rec(x) || weekNum(y) - weekNum(x));

const keyFns = {
  task: (r) => String(r.taskName ?? '').trim(),
  brand: (r) => r.brand,
  category: (r) => r.category,
  status: (r) => statusLabel(statusOf(r)),
};

// One entry per group (project / brand / category / status). Children (the
// brand + category split under a project) are built lazily by buildChildren.
export const buildGroups = (records, group, sort) => {
  const keyOf = keyFns[group];
  const map = new Map();
  records.forEach((r) => {
    const key = keyOf(r);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  });

  const groups = Array.from(map.entries()).map(([key, items]) => {
    const brands = uniq(items.map((r) => r.brand));
    const cats = uniq(items.map((r) => r.category));
    const tasks = uniq(items.map((r) => String(r.taskName ?? '').trim()));
    let sub;
    if (group === 'task') {
      const pairs = new Set(items.map((r) => `${r.brand}|${r.category}`)).size;
      sub = `${brands.length} brand${brands.length === 1 ? '' : 's'} · ${pairs} task${pairs === 1 ? '' : 's'}`;
    } else if (group === 'brand') {
      sub = `${cats.length} categor${cats.length === 1 ? 'y' : 'ies'} · ${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
    } else if (group === 'category') {
      sub = `${brands.length} brand${brands.length === 1 ? '' : 's'} · ${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
    } else {
      sub = `${brands.length} brand${brands.length === 1 ? '' : 's'} · ${cats.length} categor${cats.length === 1 ? 'y' : 'ies'}`;
    }
    const period = periodOf(items);
    const progress = progressOf(items, true);
    return {
      key,
      name: group === 'task' ? items[0].taskName : key,
      sub,
      records: items,
      count: items.length,
      period: period.text,
      span: period.span,
      last: period.last,
      segments: progress.segments,
      statusText: progress.text,
      categoryText: cats.slice(0, 3).join(', ') + (cats.length > 3 ? ` +${cats.length - 3}` : ''),
      brandChips: group === 'task' || group === 'category' ? uniq(items.map((r) => shortBrand(r.brand))).slice(0, 8) : [],
      frequencies: group === 'status' ? [] : uniq(items.map((r) => r.frequency)),
    };
  });

  const { key: k, dir } = sort;
  groups.sort((x, y) => {
    if (k === 'name') return dir * byText(x.name, y.name);
    if (k === 'latest') return dir * (x.last - y.last) || y.count - x.count;
    return dir * (x.count - y.count) || byText(x.name, y.name);
  });
  return groups;
};

// Under a project: one child per brand + category, biggest first.
export const buildChildren = (group) => {
  const map = new Map();
  group.records.forEach((r) => {
    const key = `${r.brand}|${r.category}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  });
  return Array.from(map.entries())
    .sort((x, y) => y[1].length - x[1].length || byText(x[0], y[0]))
    .map(([key, items]) => {
      const progress = progressOf(items, false);
      return {
        key: `${group.key}>${key}`,
        brand: items[0].brand,
        category: items[0].category,
        period: periodOf(items).text,
        frequencyText: uniq(items.map((r) => r.frequency)).join(', ') || 'No frequency',
        count: items.length,
        segments: progress.segments,
        statusText: progress.text,
        records: items,
      };
    });
};

// "All items" table order.
export const sortTable = (records, sort) => {
  const { key: k, dir } = sort;
  return records.slice().sort((x, y) => {
    if (k === 'task') return dir * byText(x.taskName, y.taskName);
    if (k === 'brand') return dir * byText(x.brand, y.brand);
    return dir * (rec(x) - rec(y) || weekNum(x) - weekNum(y));
  });
};

