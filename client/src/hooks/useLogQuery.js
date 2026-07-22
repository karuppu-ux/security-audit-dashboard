import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DEFAULT_LIMIT, ENUM_FILTERS, TEXT_FILTERS } from '../lib/constants.js';

/**
 * The URL is the single source of truth for the entire query.
 *
 * Every filter, the search term, the sort, and the page live in the query
 * string — so an investigator can bookmark a view, send a teammate a link that
 * reproduces exactly what they are looking at, and use the browser's back
 * button to step back through their own investigation. Holding this in a
 * component `useState` (or Redux) would throw all of that away and add a second
 * source of truth to keep in sync with the address bar.
 */
export function useLogQuery() {
  const [searchParams, setSearchParams] = useSearchParams();

  /** The shape the API expects. Recomputed from the URL, never stored. */
  const query = useMemo(() => {
    const next = {
      page: Number(searchParams.get('page')) || 1,
      limit: Number(searchParams.get('limit')) || DEFAULT_LIMIT,
      sort: searchParams.get('sort') || 'timestamp',
      order: searchParams.get('order') || 'desc',
    };

    for (const key of ENUM_FILTERS) {
      const values = searchParams.getAll(key);
      if (values.length) next[key] = values;
    }

    for (const key of [...TEXT_FILTERS, 'q', 'from', 'to']) {
      const value = searchParams.get(key);
      if (value) next[key] = value;
    }

    return next;
  }, [searchParams]);

  /**
   * Apply a patch to the query string. Changing anything other than the page
   * resets to page 1 — staying on page 7 of a result set you just narrowed to
   * two rows shows an empty table and looks like a bug.
   */
  const updateQuery = useCallback(
    (patch, { resetPage = true } = {}) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);

          for (const [key, value] of Object.entries(patch)) {
            next.delete(key);
            if (value === undefined || value === null || value === '') continue;
            if (Array.isArray(value)) value.forEach((item) => next.append(key, item));
            else next.set(key, String(value));
          }

          if (resetPage && !('page' in patch)) next.delete('page');
          return next;
        },
        // Filter changes replace the entry so the back button steps through
        // meaningful states, not every keystroke. Paging pushes, so "back"
        // returns to the previous page as a user expects.
        { replace: !('page' in patch) }
      );
    },
    [setSearchParams]
  );

  /** Toggle a column's sort: same column flips direction, new column starts descending. */
  const toggleSort = useCallback(
    (field) => {
      const isSameField = query.sort === field;
      updateQuery({
        sort: field,
        order: isSameField && query.order === 'desc' ? 'asc' : 'desc',
      });
    },
    [query.sort, query.order, updateQuery]
  );

  const clearFilters = useCallback(() => {
    // Page size and sort are display preferences, not filters — keep them.
    setSearchParams(
      (current) => {
        const next = new URLSearchParams();
        for (const key of ['limit', 'sort', 'order']) {
          if (current.get(key)) next.set(key, current.get(key));
        }
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  /** Chips shown above the table, so no filter is ever active but invisible. */
  const activeFilters = useMemo(() => {
    const chips = [];
    for (const key of ENUM_FILTERS) {
      (query[key] ?? []).forEach((value) => chips.push({ key, value, label: `${key}: ${value}` }));
    }
    for (const key of [...TEXT_FILTERS, 'q']) {
      if (query[key]) chips.push({ key, value: query[key], label: `${key}: ${query[key]}` });
    }
    if (query.from) chips.push({ key: 'from', value: query.from, label: `from: ${query.from}` });
    if (query.to) chips.push({ key: 'to', value: query.to, label: `to: ${query.to}` });
    return chips;
  }, [query]);

  /** Remove one value from a filter without disturbing the others. */
  const removeFilter = useCallback(
    ({ key, value }) => {
      if (ENUM_FILTERS.includes(key)) {
        updateQuery({ [key]: (query[key] ?? []).filter((item) => item !== value) });
      } else {
        updateQuery({ [key]: '' });
      }
    },
    [query, updateQuery]
  );

  return { query, updateQuery, toggleSort, clearFilters, activeFilters, removeFilter };
}
