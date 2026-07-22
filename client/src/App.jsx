import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchFilterMetadata, fetchLogs } from './api/logs.js';
import { useLogQuery } from './hooks/useLogQuery.js';
import { FilterPanel } from './components/FilterPanel.jsx';
import { LogTable } from './components/LogTable.jsx';
import { Pagination } from './components/Pagination.jsx';
import { LogDetailDrawer } from './components/LogDetailDrawer.jsx';
import { DebouncedInput } from './components/DebouncedInput.jsx';
import { EmptyState, ErrorState } from './components/States.jsx';
import { formatNumber } from './lib/format.js';
import { DEFAULT_LIMIT } from './lib/constants.js';

export default function App() {
  const { query, updateQuery, toggleSort, clearFilters, activeFilters, removeFilter } =
    useLogQuery();
  const [selectedId, setSelectedId] = useState(null);

  // Enum vocabularies for the filter dropdowns. They change only when the API
  // is redeployed, so they are cached for the session rather than refetched.
  const metadata = useQuery({
    queryKey: ['log-metadata'],
    queryFn: ({ signal }) => fetchFilterMetadata({ signal }),
    staleTime: Infinity,
  });

  /**
   * The one and only data fetch. `query` is the URL state verbatim, so it
   * doubles as the cache key: any change to a filter, the sort, or the page is
   * a new server request — there is no client-side array being filtered or
   * sliced anywhere in this application.
   */
  const logs = useQuery({
    queryKey: ['logs', query],
    queryFn: ({ signal }) => fetchLogs(query, { signal }),
  });

  const handlePivot = useCallback(
    (patch) => {
      updateQuery(patch);
      setSelectedId(null);
    },
    [updateQuery]
  );

  const enums = metadata.data?.data?.enums ?? {};
  const pageSizeOptions = metadata.data?.data?.pageSizeOptions ?? [DEFAULT_LIMIT, 50, 100];
  const totalStored = metadata.data?.data?.totalRecords;

  const items = logs.data?.data ?? [];
  const meta = logs.data?.meta;
  const hasFilters = activeFilters.length > 0;

  return (
    <div className="flex h-screen flex-col bg-slate-950">
      <header className="flex items-center gap-4 border-b border-slate-800 px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <h1 className="text-sm font-semibold tracking-tight text-slate-100">Audit Log Console</h1>
          {totalStored !== undefined && (
            <span className="text-xs text-slate-600">
              {formatNumber(totalStored)} records stored
            </span>
          )}
        </div>

        <div className="ml-auto w-96">
          <DebouncedInput
            label="Search"
            value={query.q ?? ''}
            onChange={(value) => updateQuery({ q: value })}
            placeholder="Search actor, action, resource…"
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <FilterPanel
          query={query}
          enums={enums}
          onChange={updateQuery}
          onClear={clearFilters}
          activeFilters={activeFilters}
          onRemoveFilter={removeFilter}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          {logs.isError ? (
            <ErrorState error={logs.error} onRetry={() => logs.refetch()} />
          ) : (
            <>
              {!logs.isLoading && items.length === 0 ? (
                <EmptyState hasFilters={hasFilters} onClear={clearFilters} />
              ) : (
                <LogTable
                  logs={items}
                  sort={query.sort}
                  order={query.order}
                  onSort={toggleSort}
                  onSelect={setSelectedId}
                  selectedId={selectedId}
                  isLoading={logs.isLoading}
                  isFetching={logs.isFetching}
                  pageSize={query.limit}
                />
              )}

              {meta && (
                <Pagination
                  meta={meta}
                  pageSizeOptions={pageSizeOptions}
                  onChange={updateQuery}
                  isFetching={logs.isFetching && !logs.isLoading}
                />
              )}
            </>
          )}
        </main>
      </div>

      {selectedId && (
        <LogDetailDrawer
          logId={selectedId}
          onClose={() => setSelectedId(null)}
          onPivot={handlePivot}
        />
      )}
    </div>
  );
}
