import { useEffect, useRef, useState } from 'react';

/**
 * A text input that keeps typing responsive locally and only publishes upward
 * after the user pauses. Every keystroke would otherwise become a URL update
 * and an API request; at 10k+ records that is both wasteful and visibly janky.
 *
 * The `value` prop stays authoritative: when the URL changes from elsewhere
 * (a filter chip removed, "clear all", the back button) the local draft is
 * replaced rather than fighting it.
 */
export function DebouncedInput({ label, value = '', onChange, placeholder, delay = 300, hint }) {
  const [draft, setDraft] = useState(value);
  const isEditing = useRef(false);

  useEffect(() => {
    if (!isEditing.current) setDraft(value);
  }, [value]);

  useEffect(() => {
    if (draft === value) return undefined;

    const timer = setTimeout(() => {
      isEditing.current = false;
      onChange(draft);
    }, delay);

    return () => clearTimeout(timer);
  }, [draft, value, delay, onChange]);

  return (
    <div>
      <label className="field-label" htmlFor={`filter-${label}`}>
        {label}
      </label>
      <input
        id={`filter-${label}`}
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(event) => {
          isEditing.current = true;
          setDraft(event.target.value);
        }}
        className="field-input font-mono"
      />
      {hint && <p className="mt-1 text-[10px] text-slate-600">{hint}</p>}
    </div>
  );
}
