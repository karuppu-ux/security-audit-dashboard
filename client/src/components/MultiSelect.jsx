import { useEffect, useRef, useState } from 'react';

/**
 * A checkbox dropdown rather than a native `<select multiple>`: enum filters
 * are genuinely multi-value ("show me HIGH *and* CRITICAL"), and a native
 * multi-select requires ctrl-clicking, which most people never discover.
 */
export function MultiSelect({ label, options, selected = [], onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setIsOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const toggle = (option) => {
    onChange(
      selected.includes(option)
        ? selected.filter((item) => item !== option)
        : [...selected, option]
    );
  };

  const summary =
    selected.length === 0
      ? 'Any'
      : selected.length === 1
        ? selected[0]
        : `${selected.length} selected`;

  return (
    <div ref={containerRef} className="relative">
      <span className="field-label">{label}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className={`field-input flex items-center justify-between text-left
                    ${selected.length ? 'text-slate-100' : 'text-slate-500'}`}
      >
        <span className="truncate">{summary}</span>
        <span aria-hidden="true" className="ml-2 shrink-0 text-slate-600">
          ▾
        </span>
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-multiselectable="true"
          aria-label={label}
          className="absolute z-30 mt-1 max-h-64 w-full min-w-max overflow-auto rounded-md border
                     border-slate-800 bg-slate-900 py-1 shadow-xl shadow-black/50"
        >
          {options.map((option) => {
            const isChecked = selected.includes(option);
            return (
              <label
                key={option}
                role="option"
                aria-selected={isChecked}
                className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm
                           text-slate-300 hover:bg-slate-800"
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggle(option)}
                  className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 accent-sky-500"
                />
                <span className="whitespace-nowrap">{option}</span>
              </label>
            );
          })}

          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full border-t border-slate-800 px-2.5 pt-1.5 pb-1 text-left
                         text-xs text-slate-500 hover:text-slate-300"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
