import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, FolderKanban, Upload as UploadIcon, Table2, ListTree, LayoutList } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { getProjects } from '../../services/projectsApi';
import { DEFAULT_FILTERS, filterRecords, getCascadingFilterOptions, sanitizeFilters, formatLinksForExport, validateProjectFilters } from '../../components/projects/dataUtils';
import { splitDepartments } from '../../components/projects/constants';
import CustomizeViewMenu from '../../components/projects/CustomizeViewMenu';
import ProjectsSimpleTable from '../../components/projects/ProjectsSimpleTable';
import HierarchyTree from '../../components/projects/HierarchyTree';
import LinksModal from '../../components/projects/LinksModal';
import useProjectViewPrefs from '../../components/projects/viewPrefs';
import useUrlFilters from '../../lib/useUrlFilters';
import {
  GROUPS, GROUP_IDS, STATUS_ORDER, STATUS_COLORS, statusOf, statusLabel, shortBrand, deptText, weekText,
  monthYear, whenText, buildGroups, buildChildren, sortItemsRecent, sortTable,
} from '../../components/projects/projectsView';
import './ProjectsList.css';

// Three views share one filter bar:
//   Table / Hierarchy - the original components (ProjectsSimpleTable, HierarchyTree)
//   Compact           - design from refference/TAL Projects (Standalone).html
// Filters, view and "Group by" live in the URL (shareable links, Dashboard deep
// links keep working); open rows, sort and paging are per visit.
const VIEWS = [
  { id: 'table', label: 'Table view', Icon: Table2 },
  { id: 'hierarchy', label: 'Hierarchy view', Icon: ListTree },
  { id: 'compact', label: 'Compact view', Icon: LayoutList },
];
const VIEW_IDS = VIEWS.map((v) => v.id);
// Customize-view preferences key per view ('list' = the new Compact design;
// the old 'compact' prefs belonged to the previous compact cards).
const PREFS_KEY = { table: 'table', hierarchy: 'hierarchy', compact: 'list' };
const GROUP_PAGE = 30;
const TABLE_PAGE = 40;

const URL_DEFAULTS = { ...DEFAULT_FILTERS, view: 'table', group: 'task' };
const validateUrlState = (state) => ({
  ...validateProjectFilters(state),
  view: VIEW_IDS.includes(state.view) ? state.view : 'table',
  group: GROUP_IDS.includes(state.group) ? state.group : 'task',
});
// Query param from the previous Compact view (By Category / Task / Status).
const LEGACY_KEYS = ['by'];

const defaultSort = (group) => (group === 'items' ? { key: 'recent', dir: -1 } : { key: 'count', dir: -1 });

// Filter dropdowns, in the reference's order. `options` key is from
// getCascadingFilterOptions; `label` formats an option for display.
const FILTER_DEFS = [
  { id: 'year', all: 'All years', options: 'years', sort: (a) => a.slice().sort((x, y) => Number(y) - Number(x)) },
  { id: 'quarter', all: 'All quarters', options: 'quarters' },
  { id: 'month', all: 'All months', options: 'months' },
  { id: 'week', all: 'All weeks', options: 'weeks', label: (o) => `Week ${o}` },
  { id: 'brand', all: 'All brands', options: 'brands' },
  { id: 'category', all: 'All categories', options: 'categories' },
  { id: 'department', all: 'All departments', options: 'departments', label: (o) => splitDepartments(o).join(' + ') || o },
  { id: 'frequency', all: 'All frequencies', options: 'frequencies' },
];

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
        {segments.map((s) => <div key={s.status} style={{ width: s.width, background: s.color }} title={`${statusLabel(s.status)}`} />)}
      </div>
      <div className="pv-bar-text" style={small ? { fontSize: 11.5, marginTop: 4 } : undefined}>{text}</div>
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

// One link opens directly; several open the existing links popup.
function ItemLink({ links }) {
  const [open, setOpen] = useState(false);
  const list = (links || []).filter((l) => l && l.url);
  if (list.length === 0) return <span />;
  if (list.length === 1) {
    return (
      <span>
        <a className="pv-open-link" href={list[0].url} target="_blank" rel="noopener noreferrer" title={list[0].label || list[0].url}>Open ↗</a>
      </span>
    );
  }
  return (
    <span>
      <button type="button" className="pv-open-link" onClick={() => setOpen(true)}>{list.length} links</button>
      {open && <LinksModal links={list} onClose={() => setOpen(false)} />}
    </span>
  );
}

// Work-item rows (inside an opened group / child) + their header.
function ItemRows({ records, detailLabel, detailOf, shown, flat }) {
  const cols = [
    shown('i_week') && { id: 'week', w: '60px', head: 'Week' },
    { id: 'task', w: 'minmax(0,1.8fr)', head: 'Task' },
    shown('i_detail') && { id: 'detail', w: '170px', head: detailLabel },
    shown('i_dept') && { id: 'dept', w: '84px', head: 'Dept' },
    shown('i_month') && { id: 'month', w: '100px', head: 'Month' },
    shown('i_status') && { id: 'status', w: '120px', head: 'Status' },
    shown('i_link') && { id: 'link', w: '90px', head: 'Link' },
  ].filter(Boolean);
  const template = cols.map((c) => c.w).join(' ');
  const cell = (id, r) => {
    switch (id) {
      case 'week': return <span key={id} className="wk">{weekText(r)}</span>;
      case 'task': {
        const text = r.description || r.taskName;
        const title = r.description ? `${r.taskName} — ${r.description}` : r.taskName;
        return <span key={id} className="task pv-ellipsis" title={title}>{text}</span>;
      }
      case 'detail': return <span key={id} className="detail pv-ellipsis" title={detailOf(r)}>{detailOf(r)}</span>;
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
        {cols.map((c) => <span key={c.id}>{c.head}</span>)}
      </div>
      {sortItemsRecent(records).map((r) => (
        <div key={r._id} className={`pv-item${flat ? ' flat' : ''}`} style={{ gridTemplateColumns: template }}>
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
  const view = urlState.view;
  const filters = useMemo(() => {
    const rest = { ...urlState };
    delete rest.group;
    delete rest.view;
    return rest;
  }, [urlState]);
  const setFilters = (next) => setUrlState((prev) => ({ ...next, group: prev.group, view: prev.view }));
  const setView = (id) => setUrlState((prev) => ({ ...prev, view: id }));

  const prefsKey = PREFS_KEY[view];
  const { prefs, toggle: togglePref, reset: resetPrefs, move: moveColumn } = useProjectViewPrefs(prefsKey);
  const shown = (id) => !prefs.hiddenColumns.includes(id);
  const hiddenFilters = prefs.hiddenFilters;

  const [sort, setSort] = useState(() => defaultSort(group));
  const [open, setOpen] = useState({});
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

  // New filters or grouping start again from the first page.
  const filterKey = JSON.stringify(urlState);
  useEffect(() => {
    setLimit(GROUP_PAGE);
    setPage(0);
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

  const isCompact = view === 'compact';
  const isTable = group === 'items';
  const groups = useMemo(() => (isCompact && !isTable ? buildGroups(filtered, group, sort) : []), [filtered, group, sort, isTable, isCompact]);
  const tableRows = useMemo(() => (isCompact && isTable ? sortTable(filtered, sort) : []), [filtered, sort, isTable, isCompact]);

  const pickGroup = (id) => {
    setUrlState((prev) => ({ ...prev, group: id }));
    setOpen({});
    setSort(defaultSort(id));
  };
  const toggleOpen = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }));
  const sortBy = (key) => () => setSort((s) => ({
    key,
    dir: s.key === key ? -s.dir : (['name', 'task', 'brand'].includes(key) ? 1 : -1),
  }));

  const hasFilters = filters.search.trim() !== '' || Object.keys(DEFAULT_FILTERS).some((k) => k !== 'search' && filters[k] !== DEFAULT_FILTERS[k]);

  // Same columns/format as before, so an export can be re-uploaded as-is.
  const handleExport = () => {
    const rows = filtered.map((r) => ({
      Year: r.year,
      Brand: r.brand,
      Category: r.category,
      Department: r.department,
      'Week No.': r.weekNo || '',
      Month: r.month,
      'Task Name': r.taskName,
      Links: formatLinksForExport(r.links),
      Status: r.status || '',
      Frequency: r.frequency || '',
      Description: r.description || '',
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet['!cols'] = [{ wch: 6 }, { wch: 24 }, { wch: 22 }, { wch: 16 }, { wch: 9 }, { wch: 8 }, { wch: 40 }, { wch: 55 }, { wch: 14 }, { wch: 12 }, { wch: 60 }];
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

  // Group row columns.
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
    { id: 'task', w: 'minmax(0,2.2fr)', head: 'Project', sort: 'task' },
    shown('t_brand') && { id: 'brand', w: 'minmax(0,1.3fr)', head: 'Brand', sort: 'brand' },
    shown('t_category') && { id: 'category', w: 'minmax(0,1.5fr)', head: 'Category' },
    shown('t_when') && { id: 'when', w: '150px', head: 'When', sort: 'recent' },
    shown('t_status') && { id: 'status', w: '120px', head: 'Status' },
    shown('t_dept') && { id: 'dept', w: '90px', head: 'Dept' },
    shown('t_link') && { id: 'link', w: '90px', head: 'Link' },
  ].filter(Boolean);
  const cols = isTable ? tCols : gCols;
  const template = cols.map((c) => c.w).join(' ');
  // Child (brand + category) rows under a project.
  const childTemplate = ['16px', 'minmax(0,2fr)', shown('g_period') && 'minmax(0,1.4fr)', shown('g_progress') && 'minmax(0,1.2fr)', shown('g_items') && '48px'].filter(Boolean).join(' ');

  const detailLabel = group === 'category' ? 'Brand' : 'Category';
  const detailOf = (r) => (group === 'category' ? shortBrand(r.brand) : r.category);

  const total = isTable ? tableRows.length : groups.length;
  const shownGroups = groups.slice(0, limit);
  const pageRows = tableRows.slice(page * TABLE_PAGE, page * TABLE_PAGE + TABLE_PAGE);
  const canMore = isTable ? (page + 1) * TABLE_PAGE < total : limit < total;
  let footText = '';
  if (total) {
    footText = isTable
      ? `Showing ${page * TABLE_PAGE + 1}–${page * TABLE_PAGE + pageRows.length} of ${total} items`
      : `Showing ${shownGroups.length} of ${total} ${groupDef.unit} · ${filtered.length} work items`;
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
      case 'task': return <span key="task" className="t pv-ellipsis" title={r.description ? `${r.taskName} — ${r.description}` : r.taskName}>{r.taskName}</span>;
      case 'brand': return <span key="brand" className="c pv-ellipsis" title={r.brand}>{r.brand}</span>;
      case 'category': return <span key="category" className="c pv-ellipsis" title={r.category}>{r.category}</span>;
      case 'when': return <span key="when" className="when">{whenText(r)}</span>;
      case 'status': return <StatusCell key="status" record={r} />;
      case 'dept': return <span key="dept" className="c">{deptText(r)}</span>;
      case 'link': return <ItemLink key="link" links={r.links} />;
      default: return null;
    }
  };

  return (
    <div className="pv">
      <div className="pv-head">
        <div className="pv-title">
          <h2>All Projects</h2>
          <span>{countText}</span>
        </div>
        <div className="pv-actions">
          <CustomizeViewMenu key={prefsKey} view={prefsKey} prefs={prefs} onToggle={togglePref} onReset={resetPrefs} onMove={moveColumn} />
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" /> Export
          </Button>
        </div>
      </div>

      <section className="pv-card pv-filters">
        <input
          className="pv-search"
          value={filters.search}
          onChange={(e) => setFilter('search', e.target.value)}
          placeholder="Search task, brand, category or description…"
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
          <span className="pv-seg-label">View</span>
          <div className="pv-seg" role="group" aria-label="View">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" aria-pressed={view === v.id} className={`pv-view-btn${view === v.id ? ' is-on' : ''}`} onClick={() => setView(v.id)}>
                <v.Icon aria-hidden="true" />
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === 'table' && (
        <section className="pv-card pv-legacy">
          <ProjectsSimpleTable records={filtered} hiddenColumns={prefs.hiddenColumns} columnOrder={prefs.columnOrder} />
        </section>
      )}

      {view === 'hierarchy' && (
        <section className="pv-card pv-legacy">
          <HierarchyTree records={filtered} hiddenDetails={prefs.hiddenColumns} pageScroll searchActive={filters.search.trim() !== ''} totalCount={projects.length} />
        </section>
      )}

      {isCompact && (<>
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
            <button type="button" className="pv-plain-btn" onClick={() => setOpen(Object.fromEntries(groups.map((g) => [g.key, true])))}>Expand all</button>
            <button type="button" className="pv-plain-btn" onClick={() => setOpen({})}>Collapse all</button>
          </div>
        )}
      </div>

      <section className="pv-card pv-list">
        <div className="pv-scroll">
          <div className="pv-scroll-inner">
            <div className="pv-grid pv-thead" style={{ gridTemplateColumns: template }}>
              {cols.map((c) => (c.id === 'caret' ? <span key="caret" /> : (
                <button
                  key={c.id}
                  type="button"
                  disabled={!c.sort}
                  onClick={c.sort ? sortBy(c.sort) : undefined}
                  className={`pv-th${c.sort ? ' sortable' : ''}${sort.key === c.sort ? ' is-on' : ''}${c.right ? ' right' : ''}`}
                >
                  {c.head}{sort.key === c.sort ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}
                </button>
              )))}
            </div>

            {!isTable && shownGroups.map((g) => {
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
                      {group === 'task' ? buildChildren(g).map((ch) => {
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
                                <div className="pv-child-name">{ch.brand}</div>
                                <div className="pv-child-sub">{ch.category}</div>
                              </div>
                              {shown('g_period') && <div className="pv-cell" style={{ fontSize: 12.5 }}>{ch.period}<small style={{ fontSize: 11.5 }}>{ch.frequencyText}</small></div>}
                              {shown('g_progress') && <ProgressBar small segments={ch.segments} text={ch.statusText} />}
                              {shown('g_items') && <span className="pv-count" style={{ fontSize: 13, fontWeight: 400 }}>{ch.count}</span>}
                            </div>
                            {childOpen && (
                              <div className="pv-child-items">
                                <ItemRows records={ch.records} detailLabel="Category" detailOf={(r) => r.category} shown={shown} />
                              </div>
                            )}
                          </div>
                        );
                      }) : (
                        <ItemRows records={g.records} detailLabel={detailLabel} detailOf={detailOf} shown={shown} flat />
                      )}
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
      </>)}
    </div>
  );
}
