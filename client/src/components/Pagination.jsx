import { formatNumber } from '../lib/format.js';

/** Compact page list with ellipses, so the control stays one line at any depth. */
function pageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const pages = new Set([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);

  const withGaps = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) withGaps.push('…');
    withGaps.push(page);
  });
  return withGaps;
}

export function Pagination({ meta, pageSizeOptions, onChange, isFetching }) {
  const { page, limit, total, totalPages, hasPreviousPage, hasNextPage } = meta;

  const firstRow = total === 0 ? 0 : (page - 1) * limit + 1;
  const lastRow = Math.min(page * limit, total);

  const buttonClass =
    'rounded border border-slate-800 px-2 py-1 text-xs text-slate-300 transition-colors ' +
    'hover:border-slate-700 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-35';

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800
                 bg-slate-950 px-4 py-2.5"
    >
      <p className="text-xs text-slate-500" aria-live="polite">
        {total === 0 ? (
          'No matching records'
        ) : (
          <>
            Showing <span className="text-slate-300">{formatNumber(firstRow)}</span>–
            <span className="text-slate-300">{formatNumber(lastRow)}</span> of{' '}
            <span className="text-slate-300">{formatNumber(total)}</span>
          </>
        )}
        {isFetching && <span className="ml-2 text-slate-600">updating…</span>}
      </p>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          Rows
          <select
            value={limit}
            onChange={(event) => onChange({ limit: Number(event.target.value) })}
            className="rounded border border-slate-800 bg-slate-900 px-1.5 py-1 text-xs text-slate-200"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className={buttonClass}
            disabled={!hasPreviousPage}
            onClick={() => onChange({ page: page - 1 })}
          >
            Prev
          </button>

          {pageNumbers(page, totalPages).map((entry, index) =>
            entry === '…' ? (
              <span key={`gap-${index}`} className="px-1 text-xs text-slate-700">
                …
              </span>
            ) : (
              <button
                key={entry}
                type="button"
                aria-current={entry === page ? 'page' : undefined}
                onClick={() => onChange({ page: entry })}
                className={
                  entry === page
                    ? 'rounded border border-sky-700 bg-sky-950 px-2 py-1 text-xs text-sky-300'
                    : buttonClass
                }
              >
                {entry}
              </button>
            )
          )}

          <button
            type="button"
            className={buttonClass}
            disabled={!hasNextPage}
            onClick={() => onChange({ page: page + 1 })}
          >
            Next
          </button>
        </div>
      </div>
    </nav>
  );
}
