/**
 * Empty and error are first-class screens, not afterthoughts. An investigator
 * seeing a blank table needs to know *why* it is blank — no data at all, or no
 * data matching their filters — and be given the action that fixes it.
 */

export function EmptyState({ hasFilters, onClear }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-3 text-3xl text-slate-700" aria-hidden="true">
        ⌕
      </div>
      <h3 className="text-sm font-medium text-slate-300">
        {hasFilters ? 'No logs match these filters' : 'No audit logs stored yet'}
      </h3>
      <p className="mt-1 max-w-sm text-xs text-slate-500">
        {hasFilters
          ? 'Try widening the timestamp range, or removing the narrowest filter.'
          : 'Upload records to POST /api/v1/logs/bulk, or run `npm run seed` in the server directory to load 10,000 sample records.'}
      </p>
      {hasFilters && (
        <button
          type="button"
          onClick={onClear}
          className="mt-4 rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300
                     transition-colors hover:bg-slate-800"
        >
          Clear all filters
        </button>
      )}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  const isValidation = error?.status === 400;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-3 text-3xl text-red-500/70" aria-hidden="true">
        ⚠
      </div>
      <h3 className="text-sm font-medium text-red-300">
        {isValidation ? 'The API rejected this query' : 'Could not load audit logs'}
      </h3>
      <p className="mt-1 max-w-md text-xs text-slate-400">{error?.message}</p>

      {/* Field-level detail from the server, so a bad query string is
          diagnosable instead of just "400". */}
      {error?.details?.length > 0 && (
        <ul className="mt-3 max-w-md space-y-1 text-left">
          {error.details.slice(0, 5).map((detail, index) => (
            <li key={index} className="font-mono text-[11px] text-slate-500">
              {detail.path}: {detail.message}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300
                   transition-colors hover:bg-slate-800"
      >
        Retry
      </button>
    </div>
  );
}
