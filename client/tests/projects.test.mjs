// Filter / sort / grouping logic of the Projects page. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDepartment } from '../src/components/projects/constants.js';
import { DEFAULT_FILTERS, filterRecords, getCascadingFilterOptions, computeSummaryCounts } from '../src/components/projects/dataUtils.js';
import {
  buildGroups, buildChildren, sortItems, sortTable, itemColumnsFor, buildTree, defaultTreeOpen, allTreeOpen,
  statusOf, statusLabel, deptText, STATUS_ORDER,
} from '../src/components/projects/projectsView.js';

let id = 0;
// taskName = the project, description = the task (saved field names).
const r = (o) => ({
  _id: String((id += 1)), year: 2026, brand: '2 - Ivy Ana', category: 'Website', department: 'Dev', month: 'Aug', weekNo: '31',
  taskName: 'Website Work', description: '', status: '', frequency: '', links: [], ...o,
});

const DATA = [
  r({ department: 'Des', description: 'Logo sketch', status: 'Delivered', taskName: 'Logo', category: 'Branding', month: 'Jul', weekNo: '27' }),
  r({ department: 'Des,Dev', description: 'Banner', status: 'Review', weekNo: '32' }),
  r({ department: 'Dev + Des', description: 'Footer', status: 'Delivered', brand: '2 - WA', weekNo: '33' }),
  r({ department: 'Dev', description: 'Sitemap', status: 'Delivered', weekNo: '33' }),
  r({ department: 'Dev + Admin', description: '', status: '', brand: '2 - WA', month: 'Sep', weekNo: '36', category: 'Miscellaneous' }),
  r({ department: 'Des', description: 'Wireframe home', status: 'Hold', taskName: 'Wireframe & Design', category: 'UI/UX Design', year: 2025, month: 'Dec', weekNo: '50' }),
];

const filt = (o) => filterRecords(DATA, { ...DEFAULT_FILTERS, ...o });

test('department normalization', () => {
  assert.equal(normalizeDepartment('Des,Dev'), 'Des + Dev');
  assert.equal(normalizeDepartment('Dev + Des'), 'Des + Dev');
  assert.equal(normalizeDepartment('Dev + Admin'), 'Admin + Dev');
  assert.equal(deptText({ department: '' }), '—');
});

test('department filter is an exact match on the canonical form', () => {
  assert.equal(filt({ department: 'Des' }).length, 2); // Des-only rows
  assert.equal(filt({ department: 'Des + Dev' }).length, 2); // "Des,Dev" + "Dev + Des"
  assert.equal(filt({ department: 'Dev' }).length, 1);
  assert.equal(filt({ department: 'Admin + Dev' }).length, 1);
});

test('department options include combinations, most used first', () => {
  const { departments } = getCascadingFilterOptions(DATA, DEFAULT_FILTERS);
  assert.deepEqual(departments, ['Des', 'Des + Dev', 'Admin + Dev', 'Dev']);
});

test('quarter, week and status filters; No status is never Delivered', () => {
  assert.equal(filt({ quarter: 'Q3' }).length, 5);
  assert.equal(filt({ quarter: 'Q4' }).length, 1);
  assert.equal(filt({ week: '33' }).length, 2);
  assert.equal(filt({ status: 'No Status' }).length, 1);
  assert.equal(filt({ status: 'Delivered' }).length, 3);
});

test('search covers project, task, brand and category', () => {
  assert.equal(filt({ search: 'sitemap' }).length, 1); // task
  assert.equal(filt({ search: 'wireframe' }).length, 1); // project + task
  assert.equal(filt({ search: 'ivy' }).length, 4); // brand
  assert.equal(filt({ search: 'branding' }).length, 1); // category
});

test('summary counts: work items vs distinct projects', () => {
  const c = computeSummaryCounts(DATA);
  assert.equal(c.tasks, 6);
  assert.equal(c.projects, 3);
  assert.equal(c.departments, 4);
});

const SORT = { key: 'count', dir: -1 };
const sum = (groups) => groups.reduce((n, g) => n + g.count, 0);

test('every grouping adds up to the filtered row count, at both levels', () => {
  ['task', 'brand', 'category', 'status'].forEach((group) => {
    const groups = buildGroups(DATA, group, SORT);
    assert.equal(sum(groups), DATA.length, `${group} outer`);
    groups.forEach((g) => assert.equal(sum(buildChildren(g, group)), g.count, `${group} level 2 of ${g.name}`));
  });
});

test('level-2 rows per grouping', () => {
  const proj = buildGroups(DATA, 'task', SORT).find((g) => g.name === 'Website Work');
  assert.equal(proj.sub, '2 brands · 2 categories');
  assert.deepEqual(buildChildren(proj, 'task').map((c) => `${c.title}|${c.sub}`), ['2 - Ivy Ana|Website', '2 - WA|Miscellaneous', '2 - WA|Website']);

  const brand = buildGroups(DATA, 'brand', SORT).find((g) => g.name === '2 - WA');
  assert.deepEqual(buildChildren(brand, 'brand').map((c) => c.title), ['Website Work']);

  // Status: one row per project, not split by brand; subtitle = brands · categories.
  const delivered = buildGroups(DATA, 'status', SORT).find((g) => g.name === 'Delivered');
  const ch = buildChildren(delivered, 'status');
  assert.deepEqual(ch.map((c) => c.title), ['Website Work', 'Logo']);
  assert.equal(ch[0].sub, 'Ivy Ana, WA · Website');
});

test('progress text counts no-status rows separately', () => {
  const proj = buildGroups(DATA, 'task', SORT).find((g) => g.name === 'Website Work');
  assert.equal(proj.statusText, '2 of 4 delivered · 1 no status');
});

test('task columns per grouping (Status adds Brand and Category)', () => {
  assert.deepEqual(itemColumnsFor('task'), ['week', 'task', 'category', 'dept', 'month', 'status', 'link']);
  assert.deepEqual(itemColumnsFor('brand'), ['week', 'task', 'category', 'dept', 'month', 'status', 'link']);
  assert.deepEqual(itemColumnsFor('category'), ['week', 'task', 'brand', 'dept', 'month', 'status', 'link']);
  assert.deepEqual(itemColumnsFor('status'), ['week', 'task', 'brand', 'category', 'dept', 'month', 'status', 'link']);
});

test('task row sorting', () => {
  const ids = (key, dir) => sortItems(DATA, { key, dir }).map((x) => x.description || '(none)');
  assert.deepEqual(ids('week', 1), ['Logo sketch', 'Banner', 'Footer', 'Sitemap', '(none)', 'Wireframe home']);
  assert.deepEqual(ids('task', 1).slice(0, 2), ['Banner', 'Footer']);
  assert.equal(ids('task', 1).at(-1), '(none)'); // blank task names last
  // Month: year, then calendar month, then week. Newest first when desc.
  assert.deepEqual(ids('month', -1), ['(none)', 'Footer', 'Sitemap', 'Banner', 'Logo sketch', 'Wireframe home']);
  // Status: workflow order, No status last.
  assert.deepEqual(sortItems(DATA, { key: 'status', dir: 1 }).map(statusOf).map(statusLabel), ['Delivered', 'Delivered', 'Delivered', 'Review', 'Hold', 'No status']);
  assert.deepEqual(STATUS_ORDER.at(-1), 'No Status');
  // Brand sort groups a project's tasks by brand.
  assert.deepEqual(sortItems(DATA, { key: 'brand', dir: 1 }).map((x) => x.brand).slice(-2), ['2 - WA', '2 - WA']);
  assert.deepEqual(sortItems(DATA, { key: 'dept', dir: 1 }).map((x) => deptText(x)), ['Admin + Dev', 'Des', 'Des', 'Des + Dev', 'Des + Dev', 'Dev']);
});

test('All items table sorting', () => {
  assert.deepEqual(sortTable(DATA, { key: 'task', dir: 1 }).map((x) => x.taskName)[0], 'Logo');
  assert.equal(sortTable(DATA, { key: 'recent', dir: -1 })[0].month, 'Sep');
});

test('hierarchy: Year > Month > Brand > Category > Project > Task, counts add up', () => {
  const tree = buildTree(DATA);
  assert.deepEqual(tree.map((y) => y.label), ['2026', '2025']); // newest first
  const y = tree[0];
  assert.equal(y.count, 5);
  assert.deepEqual(y.months.map((m) => m.label), ['July 2026', 'August 2026', 'September 2026']); // calendar order
  y.months.forEach((m) => {
    assert.equal(m.brands.reduce((n, b) => n + b.count, 0), m.count);
    m.brands.forEach((b) => {
      assert.equal(b.categories.reduce((n, c) => n + c.count, 0), b.count);
      b.categories.forEach((c) => {
        assert.equal(c.projects.reduce((n, p) => n + p.count, 0), c.count);
        c.projects.forEach((p) => assert.equal(p.tasks.length, p.count));
      });
    });
  });
  const aug = y.months[1];
  assert.equal(aug.brands[0].label, '2 - Ivy Ana'); // biggest first
  assert.equal(aug.brands[0].badge, 'IA');
});

test('hierarchy default open path and expand all', () => {
  const tree = buildTree(DATA);
  const open = defaultTreeOpen(tree);
  assert.deepEqual(Object.keys(open), ['2026', '2026|Jul', '2026|Jul|2 - Ivy Ana', '2026|Jul|2 - Ivy Ana|Branding', '2026|Jul|2 - Ivy Ana|Branding|Logo']);
  assert.equal(Object.keys(allTreeOpen(tree)).length, 2 + 4 + 5 + 5 + 5); // years, months, brands, categories, projects
  assert.deepEqual(defaultTreeOpen([]), {});
});

test('old links: department spelling from the sheet is read in canonical form', async () => {
  const { validateProjectFilters } = await import('../src/components/projects/dataUtils.js');
  assert.equal(validateProjectFilters({ ...DEFAULT_FILTERS, department: 'Des,Dev' }).department, 'Des + Dev');
  assert.equal(validateProjectFilters({ ...DEFAULT_FILTERS, department: 'All' }).department, 'All');
  assert.equal('department' in validateProjectFilters({ status: 'All', quarter: 'All' }), false);
});
