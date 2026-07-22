import { COLUMNS, SEVERITY_ROW_ACCENT } from '../lib/constants.js';
import { formatTimestamp } from '../lib/format.js';
import { SeverityBadge, StatusBadge } from './Badge.jsx';

function SortIndicator({ active, order }) {
  if (!active) {
    return (
      <span aria-hidden="true" className="ml-1 text-slate-700 group-hover:text-slate-500">
        ↕
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="ml-1 text-sky-400">
      {order === 'asc' ? '↑' : '↓'}
    </span>
  );
}

function HeaderCell({ column, sort, order, onSort }) {
  const isActive = sort === column.key;

  return (
    <th
      scope="col"
      // aria-sort tells a screen reader what the current ordering is — without
      // it, a sortable table is just a table that changes for no stated reason.
      aria-sort={isActive ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`${column.width} sticky top-0 z-10 border-b border-slate-800 bg-slate-900/95 backdrop-blur`}
    >
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className="group flex w-full items-center px-3 py-2 text-left text-[11px] font-semibold
                   uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-100"
      >
        {column.label}
        <SortIndicator active={isActive} order={order} />
      </button>
    </th>
  );
}

function Row({ log, isSelected, onSelect }) {
  return (
    <tr
      tabIndex={0}
      role="button"
      aria-label={`Open details for ${log.action} by ${log.actor}`}
      onClick={() => onSelect(log.id)}
      // The table is keyboard-navigable: an investigator working through a
      // triage queue should never need to reach for the mouse.
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(log.id);
        }
      }}
      className={`cursor-pointer border-l-2 border-b border-slate-900 transition-colors
                  ${SEVERITY_ROW_ACCENT[log.severity] ?? ''}
                  ${isSelected ? 'bg-sky-950/40' : 'hover:bg-slate-900/70'}`}
    >
      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-slate-400">
        {formatTimestamp(log.timestamp)}
      </td>
      <td className="px-3 py-1.5">
        <SeverityBadge value={log.severity} />
      </td>
      <td className="px-3 py-1.5">
        <StatusBadge value={log.status} />
      </td>
      <td className="max-w-56 truncate px-3 py-1.5 font-mono text-xs text-slate-200" title={log.actor}>
        {log.actor}
      </td>
      <td className="px-3 py-1.5 text-xs text-slate-400">{log.role}</td>
      <td className="px-3 py-1.5 font-mono text-xs text-slate-300">{log.action}</td>
      <td className="px-3 py-1.5 text-xs text-slate-400">{log.resourceType}</td>
      <td
        className="max-w-64 truncate px-3 py-1.5 font-mono text-xs text-slate-400"
        title={log.resource}
      >
        {log.resource}
      </td>
      <td className="px-3 py-1.5 font-mono text-xs text-slate-400">{log.ipAddress}</td>
      <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{log.region}</td>
    </tr>
  );
}

function SkeletonRows({ rows }) {
  return Array.from({ length: rows }, (_, index) => (
    <tr key={index} className="border-b border-slate-900">
      {COLUMNS.map((column) => (
        <td key={column.key} className="px-3 py-2">
          <div className="h-3 animate-pulse rounded bg-slate-800/70" />
        </td>
      ))}
    </tr>
  ));
}

export function LogTable({
  logs,
  sort,
  order,
  onSort,
  onSelect,
  selectedId,
  isLoading,
  isFetching,
  pageSize,
}) {
  return (
    <div className="relative flex-1 overflow-auto">
      {/* A thin progress bar for refetches, so the table never blanks out
          mid-investigation but the user still knows data is in flight. */}
      {isFetching && !isLoading && (
        <div className="absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-sky-950">
          <div className="h-full w-1/3 animate-[slide_1.1s_ease-in-out_infinite] bg-sky-500" />
        </div>
      )}

      <table className="w-full border-collapse text-left">
        <caption className="sr-only">
          Audit log records, sorted by {sort} {order === 'asc' ? 'ascending' : 'descending'}
        </caption>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <HeaderCell
                key={column.key}
                column={column}
                sort={sort}
                order={order}
                onSort={onSort}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <SkeletonRows rows={Math.min(pageSize, 12)} />
          ) : (
            logs.map((log) => (
              <Row
                key={log.id}
                log={log}
                isSelected={log.id === selectedId}
                onSelect={onSelect}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
