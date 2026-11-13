import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, FolderKanban, Upload as UploadIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { getProjects } from '../../services/projectsApi';
import { DEFAULT_FILTERS, filterRecords, getCascadingFilterOptions, sanitizeFilters, formatLinksForExport, validateProjectFilters } from '../../components/projects/dataUtils';
import { normalizeDepartment } from '../../components/projects/constants';
import CustomizeViewMenu from '../../components/projects/CustomizeViewMenu';
import LinksModal from '../../components/projects/LinksModal';
import useProjectViewPrefs from '../../components/projects/viewPrefs';
import useUrlFilters from '../../lib/useUrlFilters';
import {
  GROUPS, GROUP_IDS, STATUS_ORDER, STATUS_COLORS, TASK_MISSING, statusOf, statusLabel, shortBrand, deptText, weekText,
  monthYear, whenText, projectOf, taskOf, buildGroups, buildChildren, sortItems, itemColumnsFor, sortTable,
  buildTree, defaultTreeOpen, allTreeOpen,
} from '../../components/projects/projectsView';
import './ProjectsList.css';

// Projects page (design: refference/TAL Projects (Standalone) (1).html).
// "Group by" is the only switcher: Projects | Brand | Category | Status |
// All items | Hierarchy. Filters and the grouping live in the URL (shareable
// links, Dashboard deep links keep working); open rows, sort and paging are
// per visit.
//
// Data naming: saved `taskName` = the Project, `description` = the Task.
const GROUP_PAGE = 30;
const TABLE_PAGE = 40;
// Expand the whole tree for a search with at most this many results.
const TREE_AUTO_EXPAND = 300;

// `view` is only read, to turn links from the old Table / Hierarchy /
// Compact switcher into the matching grouping; it is never written back.
const URL_DEFAULTS = { ...DEFAULT_FILTERS, group: 'task', view: '' };
const validateUrlState = (state) => {
  let group = GROUP_IDS.includes(state.group) ? state.group : 'task';
  if (state.view === 'hierarchy') group = 'tree';
  else if (state.view === 'table') group = 'items';
  return { ...validateProjectFilters(state), group, view: '' };
};
// Query param from an earlier Compact view (By Category / Task / Status).
const LEGACY_KEYS = ['by'];

const defaultSort = (group) => (group === 'items' ? { key: 'recent', dir: -1 } : { key: 'count', dir: -1 });
const DEFAULT_ITEM_SORT = { key: 'month', dir: -1 };

// Filter dropdowns, in the reference's order. `options` key is from
// getCascadingFilterOptions; `label` formats an option for display.
const FILTER_DEFS = [
  { id: 'year', all: 'All years', options: 'years', sort: (a) => a.slice().sort((x, y) => Number(y) - Number(x)) },
  { id: 'quarter', all: 'All quarters', options: 'quarters' },
  { id: 'month', all: 'All months', options: 'months' },
  { id: 'week', all: 'All weeks', options: 'weeks', label: (o) => `Week ${o}` },
  { id: 'brand', all: 'All brands', options: 'brands' },
  { id: 'category', all: 'All categories', options: 'categories' },
  { id: 'department', all: 'All departments', options: 'departments' },
  { id: 'frequency', all: 'All frequencies', options: 'frequencies' },
];

// Task-row columns: width, header, sort key and the Customize-view id.
const ITEM_COLS = {
  week: { w: '64px', head: 'Week', sort: 'week', pref: 'i_week' },
  task: { w: 'minmax(220px,1.8fr)', head: 'Task', sort: 'task' },
  brand: { w: 'minmax(110px,0.8fr)', head: 'Brand', sort: 'brand', pref: 'i_brand' },
  category: { w: 'minmax(120px,0.9fr)', head: 'Category', sort: 'category', pref: 'i_category' },
  dept: { w: '96px', head: 'Dept', sort: 'dept', pref: 'i_dept' },
  month: { w: '92px', head: 'Month', sort: 'month', pref: 'i_month' },
  status: { w: '118px', head: 'Status', sort: 'status', pref: 'i_status' },
  link: { w: '96px', head: 'Link', pref: 'i_link' },
};

const onActivate = (fn) => (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
};

function ProgressBar({ segments, text, small }) {
  return (
    <div>
      <div className={`pv-bar${small ? ' sm' : ''}`}>
        {segments.map((s) => <div key={s.status} style={{ width: s.width, background: s.color }} title={statusLabel(s.status)} />)}
      </div>
      {text && <div className={`pv-bar-text${small ? ' sm' : ''}`}>{text}</div>}
    </div>
  );
}

function StatusCell({ record }) {
  const s = statusOf(record);
  return (
    <span className="pv-status">
      <span className="pv-dot" style={{ background: STATUS_COLORS[s] }} />
      {statusLabel(s)}
    </span>
  );
}

// The task text, or a muted "Task name not uploaded" (never the project name).
function TaskText({ record, className = '' }) {
  const text = taskOf(record);
  return text
    ? <span className={`${className} pv-ellipsis`} title={text}>{text}</span>
    : <span className={`${className} pv-ellipsis pv-missing`}>{TASK_MISSING}</span>;
}

// One link opens directly; several open the links popup.
function ItemLink({ links, compact }) {
  const [open, setOpen] = useState(false);
  const list = (links || []).filter((l) => l && l.url);
  if (list.length === 0) return <span />;
  if (list.length === 1) {
    return (
      <span>
        <a className="pv-open-link" href={list[0].url} target="_blank" rel="noopener noreferrer" title={list[0].label || list[0].url} onClick={(e) => e.stopPropagation()}>
          {compact ? 'Link ↗' : 'Open ↗'}
        </a>
      </span>
    );
  }
  return (
    <span>
      <button type="button" className="pv-open-link" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>{list.length} links</button>
      {open && <LinksModal links={list} onClose={() => setOpen(false)} />}
    </span>
  );
}

function SortHead({ col, sort, onSort, className }) {
  const on = col.sort && sort.key === col.sort;
  return (
    <button
      type="button"
      disabled={!col.sort}
      onClick={col.sort ? () => onSort(col.sort) : undefined}
      className={`${className}${col.sort ? ' sortable' : ''}${on ? ' is-on' : ''}${col.right ? ' right' : ''}`}
      aria-sort={on ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}
    >
      {col.head}{on ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}
    </button>
  );
}

// Task rows (the leaf level of every grouping) + their sortable header.
function ItemRows({ records, group, shown, isort, onSort }) {
  const cols = itemColumnsFor(group)
    .filter((id) => !ITEM_COLS[id].pref || shown(ITEM_COLS[id].pref))
    .map((id) => ({ id, ...ITEM_COLS[id] }));
  const template = cols.map((c) => c.w).join(' ');
  const cell = (id, r) => {
    switch (id) {
      case 'week': return <span key={id} className="wk">{weekText(r)}</span>;
      case 'task': return <TaskText key={id} record={r} className="task" />;
      case 'brand': return <span key={id} className="detail pv-ellipsis" title={r.brand}>{shortBrand(r.brand)}</span>;
      case 'category': return <span key={id} className="detail pv-ellipsis" title={r.category}>{r.category}</span>;
      case 'dept': return <span key={id} className="dept">{deptText(r)}</span>;
      case 'month': return <span key={id} className="month">{monthYear(r)}</span>;
      case 'status': return <StatusCell key={id} record={r} />;
      case 'link': return <ItemLink key={id} links={r.links} />;
      default: return null;
    }
  };
  return (
    <>
      <div className="pv-items-head" style={{ gridTemplateColumns: template }}>
        {cols.map((c) => <SortHead key={c.id} col={c} sort={isort} onSort={onSort} className="pv-ith" />)}
      </div>
      {sortItems(records, isort).map((r) => (
        <div key={r._id} className="pv-item" style={{ gridTemplateColumns: template }}>
          {cols.map((c) => cell(c.id, r))}
        </div>
      ))}
    </>
  );
}

export default function ProjectsList() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [urlState, setUrlState] = useUrlFilters(URL_DEFAULTS, { validate: validateUrlState, dropKeys: LEGACY_KEYS });
  const group = urlState.group;
  const filters = useMemo(() => {
    const rest = { ...urlState };
    delete rest.group;
    delete rest.view;
    return rest;
  }, [urlState]);
  const setFilters = (next) => setUrlState((prev) => ({ ...next, group: prev.group, view: '' }));

  const prefsKey = 'list';
  const { prefs, toggle: togglePref, reset: resetPrefs, move: moveColumn } = useProjectViewPrefs(prefsKey);
  const shown = (id) => !prefs.hiddenColumns.includes(id);
  const hiddenFilters = prefs.hiddenFilters;

  const [sort, setSort] = useState(() => defaultSort(group));
  const [isort, setIsort] = useState(DEFAULT_ITEM_SORT);
  const [open, setOpen] = useState({});
  // null = the default open path (or everything, for a short search result).
  const [treeOpen, setTreeOpen] = useState(null);
  const [limit, setLimit] = useState(GROUP_PAGE);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        setProjects(await getProjects());
      } catch (error) {
        console.error('Failed to fetch projects', error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // A filter from a shared link that doesn't exist in the data resets to All.
  useEffect(() => {
    if (loading || projects.length === 0) return;
    const fixed = sanitizeFilters(projects, filters);
    if (fixed !== filters) setFilters(fixed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, projects]);

  // A filter switched off in Customize view must not keep narrowing the rows.
  useEffect(() => {
    const stale = hiddenFilters.filter((key) => filters[key] !== DEFAULT_FILTERS[key]);
    if (stale.length === 0) return;
    const next = { ...filters };
    stale.forEach((key) => { next[key] = DEFAULT_FILTERS[key]; });
    setFilters(projects.length ? sanitizeFilters(projects, next) : next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenFilters, filters]);

  // New filters or grouping start again from the first page / default tree.
  const filterKey = JSON.stringify(urlState);
  useEffect(() => {
    setLimit(GROUP_PAGE);
    setPage(0);
    setTreeOpen(null);
  }, [filterKey]);

  const handleFiltersChange = (next) => setFilters(sanitizeFilters(projects, next));
  const setFilter = (key, value) => handleFiltersChange({ ...filters, [key]: value });

  const filterOptions = useMemo(() => getCascadingFilterOptions(projects, filters), [projects, filters]);
  const filtered = useMemo(() => filterRecords(projects, filters), [projects, filters]);
  // Status chip counts ignore the status filter itself.
  const statusBase = useMemo(() => filterRecords(projects, { ...filters, status: 'All' }), [projects, filters]);
  const statusCounts = useMemo(() => {
    const c = {};
    statusBase.forEach((r) => { const s = statusOf(r); c[s] = (c[s] || 0) + 1; });
    return c;
  }, [statusBase]);

  const isTable = group === 'items';
  const isTree = group === 'tree';
  const isGrouped = !isTable && !isTree;
  const groups = useMemo(() => (isGrouped ? buildGroups(filtered, group, sort) : []), [filtered, group, sort, isGrouped]);
  const tableRows = useMemo(() => (isTable ? sortTable(filtered, sort) : []), [filtered, sort, isTable]);
  const tree = useMemo(() => (isTree ? buildTree(filtered) : []), [filtered, isTree]);
  const searchActive = filters.search.trim() !== '';
  const treeOpenNow = useMemo(() => {
    if (!isTree) return {};
    if (treeOpen) return treeOpen;
    return searchActive && filtered.length <= TREE_AUTO_EXPAND ? allTreeOpen(tree) : defaultTreeOpen(tree);
  }, [isTree, treeOpen, tree, searchActive, filtered.length]);

  const pickGroup = (id) => {
    setUrlState((prev) => ({ ...prev, group: id, view: '' }));
    setOpen({});
    setSort(defaultSort(id));
  };
  const toggleOpen = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }));
  const toggleTree = (key) => setTreeOpen({ ...treeOpenNow, [key]: !treeOpenNow[key] });
  const sortBy = (key) => {
    setSort((s) => ({ key, dir: s.key === key ? -s.dir : (['name', 'task', 'brand'].includes(key) ? 1 : -1) }));
    setPage(0);
  };
  const sortItemsBy = (key) => setIsort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }));

  const expandAll = () => {
    if (isTree) {
      setTreeOpen(allTreeOpen(tree));
      return;
    }
    // Outer rows and their level-2 rows, so every task row shows.
    const o = {};
    groups.slice(0, limit).forEach((g) => {
      o[g.key] = true;
      buildChildren(g, group).forEach((ch) => { o[ch.key] = true; });
    });
    setOpen(o);
  };
  const collapseAll = () => (isTree ? setTreeOpen({}) : setOpen({}));

  const hasFilters = searchActive || Object.keys(DEFAULT_FILTERS).some((k) => k !== 'search' && filters[k] !== DEFAULT_FILTERS[k]);

  // The current filtered rows, in the upload template's column order, so an
  // export can be uploaded again as-is.
  const handleExport = () => {
    const rows = filtered.map((r) => ({
      Year: r.year,
      Brand: r.brand,
      Category: r.category,
      Department: normalizeDepartment(r.department),
      'Week No.': r.weekNo || '',
      Month: r.month,
      'Project Name': projectOf(r),
      'Task Name': taskOf(r),
      Links: formatLinksForExport(r.links),
      Status: r.status || '',
      Frequency: r.frequency || '',
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet['!cols'] = [{ wch: 6 }, { wch: 24 }, { wch: 22 }, { wch: 16 }, { wch: 9 }, { wch: 8 }, { wch: 32 }, { wch: 60 }, { wch: 55 }, { wch: 14 }, { wch: 12 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Projects');
    XLSX.writeFile(workbook, `projects_export_${Date.now()}.xlsx`);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full">Loading...</div>;
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <div className="p-4 bg-gray-100 rounded-full mb-4">
          <FolderKanban className="w-12 h-12 text-gray-400" />
        </div>
        <h2 className="text-xl font-semibold text-gray-800">No Projects Found</h2>
        <p className="text-gray-500 mt-2 mb-4">Upload a project sheet to get started.</p>
        <Link to="/projects/upload">
          <Button>
            <UploadIcon className="w-4 h-4 mr-2" /> Upload Project Sheet
          </Button>
        </Link>
      </div>
    );
  }

  const groupDef = GROUPS.find((g) => g.id === group);
  const hasCategoryCol = (group === 'task' || group === 'brand') && shown('g_category');

  // Outer row columns.
  const gCols = [
    { id: 'caret', w: '16px' },
    { id: 'name', w: hasCategoryCol ? 'minmax(0,2.2fr)' : 'minmax(0,2.4fr)', head: groupDef.head, sort: 'name' },
    hasCategoryCol && { id: 'category', w: 'minmax(0,1.5fr)', head: 'Category' },
    shown('g_period') && { id: 'period', w: 'minmax(0,1.4fr)', head: 'Active period', sort: 'latest' },
    shown('g_progress') && { id: 'progress', w: 'minmax(0,1.4fr)', head: 'Progress' },
    shown('g_frequency') && group !== 'status' && { id: 'frequency', w: 'minmax(0,1fr)', head: 'Frequency' },
    shown('g_items') && { id: 'items', w: '56px', head: 'Items', sort: 'count', right: true },
  ].filter(Boolean);
  // "All items" table columns.
  const tCols = [
    { id: 'task', w: 'minmax(0,1.6fr)', head: 'Project', sort: 'task' },
    shown('t_taskname') && { id: 'taskname', w: 'minmax(0,1.9fr)', head: 'Task Name' },
    shown('t_brand') && { id: 'brand', w: 'minmax(0,1.1fr)', head: 'Brand', sort: 'brand' },
    shown('t_category') && { id: 'category', w: 'minmax(0,1.2fr)', head: 'Category' },
    shown('t_when') && { id: 'when', w: '150px', head: 'When', sort: 'recent' },
    shown('t_status') && { id: 'status', w: '118px', head: 'Status' },
    shown('t_dept') && { id: 'dept', w: '96px', head: 'Dept' },
    shown('t_link') && { id: 'link', w: '90px', head: 'Link' },
  ].filter(Boolean);
  const cols = isTable ? tCols : gCols;
  const template = cols.map((c) => c.w).join(' ');
  // Level-2 rows.
  const childTemplate = ['16px', 'minmax(0,2fr)', shown('g_period') && 'minmax(0,1.4fr)', shown('g_progress') && 'minmax(0,1.2fr)', shown('g_items') && '48px'].filter(Boolean).join(' ');

  const total = isTable ? tableRows.length : isTree ? filtered.length : groups.length;
  const shownGroups = groups.slice(0, limit);
  const pageRows = tableRows.slice(page * TABLE_PAGE, page * TABLE_PAGE + TABLE_PAGE);
  const canMore = isTable ? (page + 1) * TABLE_PAGE < total : isGrouped && limit < total;
  let footText = '';
  if (total) {
    if (isTable) footText = `Showing ${page * TABLE_PAGE + 1}–${page * TABLE_PAGE + pageRows.length} of ${total} items`;
    else if (isTree) footText = `${filtered.length} work items`;
    else footText = `Showing ${shownGroups.length} of ${total} ${groupDef.unit} · ${filtered.length} work items`;
  }

  const countText = filtered.length === projects.length
    ? `${projects.length} work items`
    : `${filtered.length} of ${projects.length} work items`;

  const renderGroupCell = (c, g, isOpen) => {
    switch (c.id) {
      case 'caret': return <span key="caret" className={`pv-caret${isOpen ? ' is-open' : ''}`}>▶</span>;
      case 'name':
        return (
          <div key="name" style={{ minWidth: 0 }}>
            <div className="pv-name">{g.name}</div>
            <div className="pv-sub">{g.sub}</div>
            {g.brandChips.length > 0 && (
              <div className="pv-tags">{g.brandChips.map((b) => <span key={b} className="pv-tag">{b}</span>)}</div>
            )}
          </div>
        );
      case 'category': return <div key="category" className="pv-cell">{g.categoryText}</div>;
      case 'period': return <div key="period" className="pv-cell">{g.period}<small>{g.span}</small></div>;
      case 'progress': return <ProgressBar key="progress" segments={g.segments} text={g.statusText} />;
      case 'frequency': return <div key="frequency" className="pv-freq">{g.frequencies.map((f) => <span key={f}>{f}</span>)}</div>;
      case 'items': return <span key="items" className="pv-count">{g.count}</span>;
      default: return null;
    }
  };

  const renderTableCell = (c, r) => {
    switch (c.id) {
      case 'task': return <span key="task" className="t pv-ellipsis" title={projectOf(r)}>{projectOf(r)}</span>;
      case 'taskname': return <TaskText key="taskname" record={r} className="c" />;
      case 'brand': return <span key="brand" className="c pv-ellipsis" title={r.brand}>{r.brand}</span>;
      case 'category': return <span key="category" className="c pv-ellipsis" title={r.category}>{r.category}</span>;
      case 'when': return <span key="when" className="when">{whenText(r)}</span>;
      case 'status': return <StatusCell key="status" record={r} />;
      case 'dept': return <span key="dept" className="c">{deptText(r)}</span>;
      case 'link': return <ItemLink key="link" links={r.links} />;
      default: return null;
    }
  };

  // Hierarchy as a flat list of rows (only the open branches).
  const treeRows = [];
  if (isTree) {
    const node = (key, depth, content, { count, toggle = true, cls = '' } = {}) => {
      const isOpen = !!treeOpenNow[key];
      treeRows.push(
        <div
          key={key}
          className={`pv-tree-row d${depth}${cls}${isOpen ? ' is-open' : ''}`}
          {...(toggle ? {
            role: 'button', tabIndex: 0, 'aria-expanded': isOpen, onClick: () => toggleTree(key), onKeyDown: onActivate(() => toggleTree(key)),
          } : {})}
        >
          <span className={`pv-caret${isOpen ? ' is-open' : ''}`} style={toggle ? undefined : { visibility: 'hidden' }}>▶</span>
          {content}
          <span className="pv-spacer" />
          {count != null && <span className="pv-tree-count">{count}</span>}
        </div>,
      );
      return isOpen;
    };
    tree.forEach((Y) => {
      if (!node(Y.key, 0, <span className="pv-tree-year">{Y.label}</span>, { count: `${Y.count} items` })) return;
      Y.months.forEach((M) => {
        if (!node(M.key, 1, <span className="pv-tree-month">{M.label}</span>, { count: M.count })) return;
        M.brands.forEach((B) => {
          const content = (<><span className="pv-badge" aria-hidden="true">{B.badge}</span><span className="pv-tree-label" title={B.label}>{B.label}</span></>);
          if (!node(B.key, 2, content, { count: B.count, cls: ' is-brand' })) return;
          B.categories.forEach((C) => {
            if (!node(C.key, 3, <span className="pv-cat-chip">{C.label}</span>, { count: C.count })) return;
            C.projects.forEach((P) => {
              const pc = (<><span className="pv-tree-label strong" title={P.label}>{P.label}</span><span className="pv-mini-bar">{P.segments.map((s) => <span key={s.status} style={{ width: s.width, background: s.color }} />)}</span></>);
              if (!node(P.key, 4, pc, { count: `${P.count} ${P.count === 1 ? 'task' : 'tasks'}` })) return;
              P.tasks.forEach((t) => {
                const s = statusOf(t);
                treeRows.push(
                  <div key={t._id} className="pv-tree-row d5 is-task">
                    <span className="pv-dot" style={{ background: STATUS_COLORS[s] }} />
                    <TaskText record={t} className="pv-tree-task" />
                    <span className="pv-spacer" />
                    {shown('i_status') && <span className="pv-tree-status">{statusLabel(s)}</span>}
                    {shown('i_week') && <span className="pv-week-tag">{String(t.weekNo ?? '').trim() ? `Wk ${String(t.weekNo).trim()}` : 'Wk —'}</span>}
                    {shown('i_dept') && <span className="pv-dept-chip">{deptText(t)}</span>}
                    {shown('i_link') && <span className="pv-tree-link"><ItemLink links={t.links} compact /></span>}
                  </div>,
                );
              });
            });
          });
        });
      });
    });
  }

  return (
    <div className="pv">
      <div className="pv-head">
        <div className="pv-title">
          <h2>Projects</h2>
          <span>{countText}</span>
        </div>
        <div className="pv-actions">
          <CustomizeViewMenu key={prefsKey} view={prefsKey} prefs={prefs} onToggle={togglePref} onReset={resetPrefs} onMove={moveColumn} />
          <Button variant="outline" onClick={handleExport} title={`Export the ${filtered.length} filtered work items`}>
            <Download className="w-4 h-4 mr-2" /> Export
          </Button>
        </div>
      </div>

      <section className="pv-card pv-filters">
        <input
          className="pv-search"
          value={filters.search}
          onChange={(e) => setFilter('search', e.target.value)}
          placeholder="Search project, task, brand or category…"
          aria-label="Search projects"
        />
        <div className="pv-row">
          {FILTER_DEFS.filter((f) => !hiddenFilters.includes(f.id)).map((f) => {
            const raw = filterOptions[f.options] || [];
            const options = f.sort ? f.sort(raw) : raw;
            const value = filters[f.id];
            return (
              <select
                key={f.id}
                aria-label={f.all}
                className={`pv-select${value !== 'All' ? ' is-on' : ''}`}
                value={value}
                onChange={(e) => setFilter(f.id, e.target.value)}
              >
                <option value="All">{f.all}</option>
                {options.map((o) => <option key={o} value={o}>{f.label ? f.label(o) : o}</option>)}
              </select>
            );
          })}
          {hasFilters && (
            <button type="button" className="pv-link-btn" onClick={() => setFilters(DEFAULT_FILTERS)}>Clear all</button>
          )}
        </div>
        {!hiddenFilters.includes('status') && (
          <div className="pv-row pv-chips" role="group" aria-label="Status">
            {[{ value: 'All', name: 'All', n: statusBase.length, dot: '#1c1b19' },
              ...STATUS_ORDER.map((s) => ({ value: s, name: statusLabel(s), n: statusCounts[s] || 0, dot: STATUS_COLORS[s] })),
            ].map((c) => {
              const on = filters.status === c.value;
              return (
                <button key={c.value} type="button" aria-pressed={on} className={`pv-chip${on ? ' is-on' : ''}`} onClick={() => setFilter('status', c.value)}>
                  <span className="pv-dot" style={{ background: c.dot }} />
                  {c.name}
                  <span className="n">{c.n}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <div className="pv-toolbar">
        <div className="pv-row" style={{ gap: 10 }}>
          <span className="pv-seg-label">Group by</span>
          <div className="pv-seg" role="group" aria-label="Group by">
            {GROUPS.map((g) => (
              <button key={g.id} type="button" aria-pressed={group === g.id} className={group === g.id ? 'is-on' : ''} onClick={() => pickGroup(g.id)}>
                {g.label}
              </button>
            ))}
          </div>
        </div>
        {!isTable && (
          <div className="pv-row" style={{ gap: 12 }}>
            <button type="button" className="pv-plain-btn" onClick={expandAll}>Expand all</button>
            <button type="button" className="pv-plain-btn" onClick={collapseAll}>Collapse all</button>
          </div>
        )}
      </div>

      <section className="pv-card pv-list">
        <div className="pv-scroll">
          <div className={`pv-scroll-inner${isTree ? ' is-tree' : ''}`}>
            {!isTree && (
              <div className="pv-grid pv-thead" style={{ gridTemplateColumns: template }}>
                {cols.map((c) => (c.id === 'caret'
                  ? <span key="caret" />
                  : <SortHead key={c.id} col={c} sort={sort} onSort={sortBy} className="pv-th" />))}
              </div>
            )}

            {isGrouped && shownGroups.map((g) => {
              const isOpen = !!open[g.key];
              return (
                <div key={g.key} className="pv-group">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    className={`pv-grid pv-group-row${isOpen ? ' is-open' : ''}`}
                    style={{ gridTemplateColumns: template }}
                    onClick={() => toggleOpen(g.key)}
                    onKeyDown={onActivate(() => toggleOpen(g.key))}
                  >
                    {cols.map((c) => renderGroupCell(c, g, isOpen))}
                  </div>
                  {isOpen && (
                    <div className="pv-open">
                      {buildChildren(g, group).map((ch) => {
                        const childOpen = !!open[ch.key];
                        return (
                          <div key={ch.key} className="pv-child">
                            <div
                              role="button"
                              tabIndex={0}
                              aria-expanded={childOpen}
                              className="pv-child-row"
                              style={{ gridTemplateColumns: childTemplate }}
                              onClick={() => toggleOpen(ch.key)}
                              onKeyDown={onActivate(() => toggleOpen(ch.key))}
                            >
                              <span className={`pv-caret${childOpen ? ' is-open' : ''}`} style={{ fontSize: 11 }}>▶</span>
                              <div style={{ minWidth: 0 }}>
                                <div className="pv-child-name">{ch.title}</div>
                                <div className="pv-child-sub">{ch.sub}</div>
                              </div>
                              {shown('g_period') && <div className="pv-cell pv-child-period">{ch.period}<small>{ch.frequencyText}</small></div>}
                              {shown('g_progress') && <ProgressBar small segments={ch.segments} text={ch.statusText} />}
                              {shown('g_items') && <span className="pv-count sm">{ch.count}</span>}
                            </div>
                            {childOpen && (
                              <div className="pv-child-items">
                                <ItemRows records={ch.records} group={group} shown={shown} isort={isort} onSort={sortItemsBy} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {isTable && pageRows.map((r) => (
              <div key={r._id} className="pv-grid pv-trow" style={{ gridTemplateColumns: template }}>
                {cols.map((c) => renderTableCell(c, r))}
              </div>
            ))}

            {isTree && treeRows}

            {!total && <div className="pv-empty">No projects match these filters.</div>}
          </div>
        </div>

        <div className="pv-foot">
          <span>{footText}</span>
          <div className="pv-row">
            {isTable && page > 0 && <button type="button" className="pv-btn" onClick={() => setPage(page - 1)}>Previous</button>}
            {canMore && (
              <button type="button" className="pv-btn dark" onClick={() => (isTable ? setPage(page + 1) : setLimit(limit + GROUP_PAGE))}>
                {isTable ? 'Next' : `Show ${GROUP_PAGE} more`}
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
