import { MultiSelect } from './MultiSelect.jsx';
import { DebouncedInput } from './DebouncedInput.jsx';

/** `<input type="datetime-local">` wants `YYYY-MM-DDTHH:mm`; the API speaks ISO/UTC. */
function toLocalInputValue(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 16);
}

function DateRange({ from, to, onChange }) {
  return (
    <fieldset className="col-span-2">
      <legend className="field-label">Timestamp range (UTC)</legend>
      <div className="flex items-center gap-2">
        <input
          type="datetime-local"
          aria-label="From"
          value={toLocalInputValue(from)}
          onChange={(event) =>
            onChange({ from: event.target.value ? `${event.target.value}:00Z` : '' })
          }
          className="field-input"
        />
        <span aria-hidden="true" className="text-slate-600">
          →
        </span>
        <input
          type="datetime-local"
          aria-label="To"
          value={toLocalInputValue(to)}
          onChange={(event) =>
            onChange({ to: event.target.value ? `${event.target.value}:59Z` : '' })
          }
          className="field-input"
        />
      </div>
    </fieldset>
  );
}

export function FilterPanel({ query, enums, onChange, onClear, activeFilters, onRemoveFilter }) {
  const set = (key) => (value) => onChange({ [key]: value });

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-r border-slate-800 bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Filters</h2>
        {activeFilters.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-sky-400 transition-colors hover:text-sky-300"
          >
            Clear all ({activeFilters.length})
          </button>
        )}
      </div>

      {/* Active filters are always visible as chips. A filter that is applied
          but scrolled out of sight is how an operator misreads a result set. */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-slate-800 px-4 py-3">
          {activeFilters.map((chip) => (
            <button
              key={`${chip.key}:${chip.value}`}
              type="button"
              onClick={() => onRemoveFilter(chip)}
              className="group inline-flex max-w-full items-center gap-1 rounded bg-slate-800 px-1.5
                         py-0.5 text-[11px] text-slate-300 transition-colors hover:bg-slate-700"
              title={`Remove ${chip.label}`}
            >
              <span className="truncate">{chip.label}</span>
              <span aria-hidden="true" className="text-slate-500 group-hover:text-slate-200">
                ✕
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 p-4">
        <MultiSelect
          label="Severity"
          options={enums.severity ?? []}
          selected={query.severity ?? []}
          onChange={set('severity')}
        />
        <MultiSelect
          label="Status"
          options={enums.status ?? []}
          selected={query.status ?? []}
          onChange={set('status')}
        />
        <MultiSelect
          label="Role"
          options={enums.role ?? []}
          selected={query.role ?? []}
          onChange={set('role')}
        />
        <MultiSelect
          label="Resource type"
          options={enums.resourceType ?? []}
          selected={query.resourceType ?? []}
          onChange={set('resourceType')}
        />
        <div className="col-span-2">
          <MultiSelect
            label="Action"
            options={enums.action ?? []}
            selected={query.action ?? []}
            onChange={set('action')}
          />
        </div>
        <div className="col-span-2">
          <MultiSelect
            label="Region"
            options={enums.region ?? []}
            selected={query.region ?? []}
            onChange={set('region')}
          />
        </div>

        <DateRange from={query.from} to={query.to} onChange={onChange} />

        <div className="col-span-2 space-y-3 border-t border-slate-800 pt-3">
          <DebouncedInput
            label="Actor"
            value={query.actor ?? ''}
            onChange={set('actor')}
            placeholder="priya.nair@"
            hint="Matches from the start of the address."
          />
          <DebouncedInput
            label="Resource"
            value={query.resource ?? ''}
            onChange={set('resource')}
            placeholder="/api/users/"
            hint="Matches from the start of the path."
          />
          <DebouncedInput
            label="IP address"
            value={query.ipAddress ?? ''}
            onChange={set('ipAddress')}
            placeholder="192.168.1."
            hint="Prefix match — sweep a whole subnet."
          />
        </div>
      </div>
    </aside>
  );
}
