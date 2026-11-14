import { monthIndex, NO_STATUS_LABEL, normalizeDepartment, getFullMonthName } from './constants';

// View-model for the Projects page (grouped lists, "All items" table and the
// Hierarchy tree). Pure functions over the already-filtered records, so the
// numbers here always agree with the filters / export.
//
// Naming: in the saved data `taskName` is the PROJECT (e.g. "Website Work")
// and `description` is the TASK (the work itself). The UI says "Project" and
// "Task" accordingly; see projectOf / taskOf.

export const projectOf = (r) => String(r.taskName ?? '').trim();
export const taskOf = (r) => String(r.description ?? '').trim();
export const TASK_MISSING = 'Task name not uploaded';

// Display order of the status chips, progress-bar segments and the Status
// sort (workflow order).
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

// "Group by" options. 'task' is the Projects grouping (id kept for old links).
export const GROUPS = [
  { id: 'task', label: 'Projects', unit: 'projects', head: 'Project' },
  { id: 'brand', label: 'Brand', unit: 'brands', head: 'Brand' },
  { id: 'category', label: 'Category', unit: 'categories', head: 'Category' },
  { id: 'status', label: 'Status', unit: 'statuses', head: 'Status' },
  { id: 'items', label: 'All items', unit: 'items', head: 'Project' },
  { id: 'tree', label: 'Hierarchy', unit: 'items', head: '' },
];
export const GROUP_IDS = GROUPS.map((g) => g.id);

// Year*12 + month, so months sort across years. Unknown month sorts first.
const rec = (r) => (Number(r.year) || 0) * 12 + Math.min(monthIndex(r.month), 11);
const weekNum = (r) => parseInt(r.weekNo, 10) || 0;
const byText = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
const uniq = (arr) => Array.from(new Set(arr.filter((v) => v !== '' && v != null)));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// "3 - Lit Wholesale" -> "Lit Wholesale" (brand codes are "<n> - <name>").
export const shortBrand = (b) => String(b ?? '').split(' - ')[1] || String(b ?? '');
// Round badge text for a brand: initials of its short name, max 3.
export const brandInitials = (b) => shortBrand(b).split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
export const deptText = (r) => normalizeDepartment(r.department) || '—';
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
export const segmentsOf = (records) => {
  const counts = statusCounts(records);
  return STATUS_ORDER.filter((s) => counts[s]).map((s) => ({ status: s, width: `${(counts[s] / records.length) * 100}%`, color: STATUS_COLORS[s] }));
};

// "x of y delivered · n no status". No status never counts as delivered.
const progressText = (records) => {
  const counts = statusCounts(records);
  const none = counts[NO_STATUS_LABEL] || 0;
  return `${counts.Delivered || 0} of ${records.length} delivered${none ? ` · ${none} no status` : ''}`;
};

const groupBy = (records, keyOf) => {
  const map = new Map();
  records.forEach((r) => {
    const key = keyOf(r);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  });
  return map;
};
// Biggest first, then A-Z.
const bySize = (map) => Array.from(map.entries()).sort((x, y) => y[1].length - x[1].length || byText(x[0], y[0]));

const keyFns = {
  task: projectOf,
  brand: (r) => r.brand,
  category: (r) => r.category,
  status: (r) => statusLabel(statusOf(r)),
};

// Outer rows: one per project / brand / category / status.
export const buildGroups = (records, group, sort) => {
  const groups = Array.from(groupBy(records, keyFns[group]).entries()).map(([key, items]) => {
    const brands = uniq(items.map((r) => r.brand));
    const cats = uniq(items.map((r) => r.category));
    const projects = uniq(items.map(projectOf));
    let sub;
    if (group === 'task') sub = `${plural(brands.length, 'brand', 'brands')} · ${plural(cats.length, 'category', 'categories')}`;
    else if (group === 'brand') sub = `${plural(cats.length, 'category', 'categories')} · ${plural(projects.length, 'project', 'projects')}`;
    else if (group === 'category') sub = `${plural(brands.length, 'brand', 'brands')} · ${plural(projects.length, 'project', 'projects')}`;
    else sub = `${plural(brands.length, 'brand', 'brands')} · ${plural(cats.length, 'category', 'categories')}`;
    const period = periodOf(items);
    return {
      key,
      name: key,
      sub,
      records: items,
      count: items.length,
      period: period.text,
      span: period.span,
      last: period.last,
      segments: segmentsOf(items),
      statusText: progressText(items),
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

const isOn = (value) => value != null && value !== 'All';

// Level 2 under an outer row, biggest first:
//   Projects -> brand + category pair     Brand    -> project
//   Category -> project                   Status   -> project (not split by brand)
//
// Under Projects, a Brand / Category filter already fixes that part of the
// pair, so it isn't repeated:
//   Brand filter only     -> one row per category
//   Category filter only  -> one row per brand
//   both                  -> no level 2
// and when a filter leaves just one such row, the tasks show directly.
// Returns null when the outer row should open straight to its tasks.
export const buildChildren = (outer, group, filters = {}) => {
  let keyOf = projectOf;
  let splitBy = null;
  if (group === 'task') {
    const brandOn = isOn(filters.brand);
    const catOn = isOn(filters.category);
    if (brandOn && catOn) return null;
    splitBy = brandOn ? 'category' : catOn ? 'brand' : 'pair';
    keyOf = splitBy === 'pair' ? (r) => `${r.brand}|${r.category}` : (r) => r[splitBy];
  }
  const entries = bySize(groupBy(outer.records, keyOf));
  if (splitBy && splitBy !== 'pair' && entries.length === 1) return null;
  return entries.map(([key, items]) => {
    // A-Z, so the subtitle doesn't depend on row order.
    const brands = uniq(items.map((r) => shortBrand(r.brand))).sort(byText).join(', ');
    const cats = uniq(items.map((r) => r.category)).sort(byText).join(', ');
    let title;
    let sub;
    if (splitBy === 'category') {
      title = items[0].category;
      sub = '';
    } else if (splitBy === 'brand') {
      title = items[0].brand;
      sub = '';
    } else if (group === 'task') {
      title = items[0].brand;
      sub = items[0].category;
    } else {
      title = key;
      if (group === 'brand') sub = cats;
      else if (group === 'category') sub = brands;
      else sub = `${brands} · ${cats}`;
    }
    return {
      key: `${outer.key}>${key}`,
      title,
      sub,
      period: periodOf(items).text,
      frequencyText: uniq(items.map((r) => r.frequency)).join(', ') || 'No frequency',
      count: items.length,
      segments: segmentsOf(items),
      statusText: progressText(items),
      records: items,
    };
  });
};

// Task-row sort keys (header click: asc first, then desc).
const ITEM_SORT = {
  week: (r) => parseInt(r.weekNo, 10) || 99,
  task: (r) => taskOf(r).toLowerCase() || '￿', // blanks last
  brand: (r) => shortBrand(r.brand).toLowerCase(),
  category: (r) => String(r.category ?? '').toLowerCase(),
  dept: (r) => normalizeDepartment(r.department).toLowerCase(),
  month: (r) => rec(r) * 100 + weekNum(r),
  status: (r) => STATUS_ORDER.indexOf(statusOf(r)),
};
export const sortItems = (records, isort) => {
  const fn = ITEM_SORT[isort.key] || ITEM_SORT.month;
  return records.slice().sort((x, y) => {
    const a = fn(x);
    const b = fn(y);
    const c = typeof a === 'number' ? a - b : byText(a, b);
    return isort.dir * c || rec(y) - rec(x) || weekNum(y) - weekNum(x);
  });
};

// Task-row columns per grouping. A Brand / Category column is left out
// while that filter is on - every row would show the same value.
export const itemColumnsFor = (group, filters = {}) => {
  let cols;
  if (group === 'status') cols = ['week', 'task', 'brand', 'category', 'dept', 'month', 'status', 'link'];
  else if (group === 'category') cols = ['week', 'task', 'brand', 'dept', 'month', 'status', 'link'];
  else cols = ['week', 'task', 'category', 'dept', 'month', 'status', 'link'];
  return cols.filter((c) => !(c === 'brand' && isOn(filters.brand)) && !(c === 'category' && isOn(filters.category)));
};

// "All items" table order.
export const sortTable = (records, sort) => {
  const { key: k, dir } = sort;
  return records.slice().sort((x, y) => {
    if (k === 'task') return dir * byText(projectOf(x), projectOf(y));
    if (k === 'brand') return dir * byText(x.brand, y.brand);
    return dir * (rec(x) - rec(y) || weekNum(x) - weekNum(y));
  });
};

// Hierarchy: Year -> Month -> Brand -> Category -> Project -> Task.
// Years newest first, months in calendar order, everything else biggest
// first. Node keys are paths ("2026|Mar|brand|cat|project").
export const buildTree = (records) => {
  const years = Array.from(groupBy(records, (r) => String(r.year)).entries()).sort((a, b) => Number(b[0]) - Number(a[0]));
  return years.map(([y, ya]) => ({
    key: y,
    label: y,
    count: ya.length,
    months: Array.from(groupBy(ya, (r) => r.month).entries())
      .sort((a, b) => monthIndex(a[0]) - monthIndex(b[0]))
      .map(([m, ma]) => {
        const mk = `${y}|${m}`;
        return {
          key: mk,
          label: `${getFullMonthName(m)} ${y}`,
          count: ma.length,
          brands: bySize(groupBy(ma, (r) => r.brand)).map(([b, ba]) => {
            const bk = `${mk}|${b}`;
            return {
              key: bk,
              label: b,
              badge: brandInitials(b),
              count: ba.length,
              categories: bySize(groupBy(ba, (r) => r.category)).map(([c, ca]) => {
                const ck = `${bk}|${c}`;
                return {
                  key: ck,
                  label: c,
                  count: ca.length,
                  projects: bySize(groupBy(ca, projectOf)).map(([p, pa]) => ({
                    key: `${ck}|${p}`,
                    label: p,
                    count: pa.length,
                    segments: segmentsOf(pa),
                    tasks: pa.slice().sort((a, b) => weekNum(a) - weekNum(b) || byText(taskOf(a), taskOf(b))),
                  })),
                };
              }),
            };
          }),
        };
      }),
  }));
};

// Default open path: latest year -> its first month -> largest brand ->
// largest category -> the biggest project that has task text.
export const defaultTreeOpen = (tree) => {
  const open = {};
  const Y = tree[0];
  if (!Y) return open;
  open[Y.key] = true;
  const M = Y.months[0];
  if (!M) return open;
  open[M.key] = true;
  const B = M.brands[0];
  if (!B) return open;
  open[B.key] = true;
  const C = B.categories[0];
  if (!C) return open;
  open[C.key] = true;
  const P = C.projects.find((p) => p.tasks.some((t) => taskOf(t))) || C.projects[0];
  if (P) open[P.key] = true;
  return open;
};

export const allTreeOpen = (tree) => {
  const open = {};
  tree.forEach((Y) => {
    open[Y.key] = true;
    Y.months.forEach((M) => {
      open[M.key] = true;
      M.brands.forEach((B) => {
        open[B.key] = true;
        B.categories.forEach((C) => {
          open[C.key] = true;
          C.projects.forEach((P) => { open[P.key] = true; });
        });
      });
    });
  });
  return open;
};
