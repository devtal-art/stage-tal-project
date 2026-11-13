import React from 'react';
import { FileSpreadsheet, Info, AlertTriangle, Copy } from 'lucide-react';


function Stat({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone || 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

// Upload preview summary: how the file was read (tabs, header mapping),
// what it contains, possible duplicate names and the first rows. Saved
// field names: taskName = the project, description = the task.
export default function UploadSummary({ summary }) {
  if (!summary) return null;
  const pct = (n) => (summary.validCount ? ` (${Math.round((n / summary.validCount) * 100)}%)` : '');
  const mapped = summary.mappings.filter((m) => m.mode !== 'new');

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <FileSpreadsheet className="h-4 w-4 text-green-600" /> How the file was read
        </div>
        <ul className="space-y-1.5 text-sm text-gray-700">
          {summary.mappings.map((m) => (
            <li key={m.sheet}>
              <span className="font-medium">Tab “{m.sheet}”</span> — {m.message}
            </li>
          ))}
          {summary.ignoredTabs.length > 0 && (
            <li className="text-gray-500">Not read: {summary.ignoredTabs.map((t) => `“${t}”`).join(', ')} (no Year header, or the Lists tab).</li>
          )}
        </ul>
        {mapped.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>This file uses the old column names. The old “Task Name” is saved as the Project Name and “Description” as the Task Name.</span>
          </div>
        )}
        {summary.warnings.length > 0 && (
          <ul className="space-y-1 text-sm text-amber-800">
            {summary.warnings.map((w) => (
              <li key={w} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Rows read" value={summary.rowCount} />
        <Stat label="Valid rows" value={summary.validCount} />
        <Stat label="Distinct projects" value={summary.projectCount} />
        <Stat label="Without Task Name" value={`${summary.noTaskCount}${pct(summary.noTaskCount)}`} tone={summary.noTaskCount ? 'text-amber-700' : undefined} />
        <Stat label="Without status" value={`${summary.noStatusCount}${pct(summary.noStatusCount)}`} tone={summary.noStatusCount ? 'text-amber-700' : undefined} />
      </div>

      {summary.possibleDuplicates.length > 0 && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-orange-900">
            <Copy className="h-4 w-4" /> {summary.possibleDuplicates.length} possible duplicate name(s) — check the spelling; they are saved as written, not merged
          </div>
          <div className="max-h-56 overflow-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs text-orange-700">
                  <th className="py-1 pr-3 font-medium">Type</th>
                  <th className="py-1 pr-3 font-medium">In this file</th>
                  <th className="py-1 pr-3 font-medium">Similar to</th>
                  <th className="py-1 font-medium">Where</th>
                </tr>
              </thead>
              <tbody>
                {summary.possibleDuplicates.map((d) => (
                  <tr key={`${d.kind}|${d.a}|${d.b}`} className="border-t border-orange-100 text-orange-950">
                    <td className="py-1 pr-3">{d.kind}</td>
                    <td className="py-1 pr-3">{d.a}</td>
                    <td className="py-1 pr-3">{d.b}</td>
                    <td className="py-1">{d.where === 'saved' ? 'Already saved' : 'This file'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {summary.sampleRows.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-3 text-sm font-semibold text-gray-900">First {summary.sampleRows.length} rows</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  {['Year', 'Brand', 'Category', 'Dept', 'Week', 'Month', 'Project Name', 'Task Name', 'Status', 'Frequency'].map((h) => (
                    <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.sampleRows.map((r) => (
                  <tr key={`${r.sheet}|${r.rowNumber}`} className="border-t border-gray-100 align-top">
                    <td className="py-1.5 pr-3 tabular-nums">{r.year}</td>
                    <td className="py-1.5 pr-3">{r.brand}</td>
                    <td className="py-1.5 pr-3">{r.category}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{r.department}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{r.weekNo || '—'}</td>
                    <td className="py-1.5 pr-3">{r.month}</td>
                    <td className="py-1.5 pr-3 font-medium">{r.taskName}</td>
                    <td className="py-1.5 pr-3 max-w-[22rem]">
                      {r.description ? <span className="line-clamp-2" title={r.description}>{r.description}</span> : <span className="italic text-gray-400">Task name not uploaded</span>}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{r.status || <span className="text-gray-400">No status</span>}</td>
                    <td className="py-1.5">{r.frequency || <span className="text-gray-400">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
