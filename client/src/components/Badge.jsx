import { SEVERITY_STYLES, STATUS_STYLES } from '../lib/constants.js';

const BASE =
  'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap';

export function SeverityBadge({ value }) {
  return (
    <span className={`${BASE} ${SEVERITY_STYLES[value] ?? SEVERITY_STYLES.LOW}`}>{value}</span>
  );
}

export function StatusBadge({ value }) {
  return (
    <span className={`${BASE} ${STATUS_STYLES[value] ?? STATUS_STYLES['False Positive']}`}>
      {value}
    </span>
  );
}
