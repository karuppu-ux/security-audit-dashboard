import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchLogById } from '../api/logs.js';
import { formatRelative, formatTimestamp } from '../lib/format.js';
import { SeverityBadge, StatusBadge } from './Badge.jsx';

function Field({ label, value, mono = false, onPivot, pivotLabel }) {
  return (
    <div className="border-b border-slate-900 py-2.5">
      <dt className="text-[11px] uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-1 flex items-start justify-between gap-2">
        <span className={`text-sm text-slate-200 ${mono ? 'font-mono break-all' : ''}`}>
          {value ?? '—'}
        </span>
        {onPivot && (
          <button
            type="button"
            onClick={onPivot}
            title={pivotLabel}
            className="shrink-0 rounded border border-slate-800 px-1.5 py-0.5 text-[10px]
                       text-slate-400 transition-colors hover:border-sky-800 hover:text-sky-300"
          >
            Filter
          </button>
        )}
      </dd>
    </div>
  );
}

export function LogDetailDrawer({ logId, onClose, onPivot }) {
  const [copied, setCopied] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['log', logId],
    queryFn: ({ signal }) => fetchLogById(logId, { signal }),
    enabled: Boolean(logId),
  });

  // Escape closes the drawer — expected of any overlay, and this one is opened
  // from a keyboard-navigable table.
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    setCopied(false);
  }, [logId]);

  const log = data?.data;

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(log, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied (insecure origin, permissions policy).
      // Failing silently would look like a broken button.
      setCopied('failed');
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Audit log detail"
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l
                   border-slate-800 bg-slate-950 shadow-2xl shadow-black/60"
      >
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-200">Log detail</h2>
          <div className="flex items-center gap-2">
            {log && (
              <button
                type="button"
                onClick={copyJson}
                className="rounded border border-slate-800 px-2 py-1 text-xs text-slate-400
                           transition-colors hover:border-slate-700 hover:text-slate-200"
              >
                {copied === true ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy JSON'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close detail panel"
              className="rounded px-2 py-1 text-slate-500 transition-colors hover:text-slate-200"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4">
          {isLoading && (
            <div className="space-y-3 py-4">
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="h-8 animate-pulse rounded bg-slate-900" />
              ))}
            </div>
          )}

          {isError && (
            <div className="mt-6 rounded border border-red-900/60 bg-red-950/30 p-4">
              <p className="text-sm text-red-300">{error.message}</p>
              <button
                type="button"
                onClick={() => refetch()}
                className="mt-3 rounded border border-red-800 px-2 py-1 text-xs text-red-200
                           transition-colors hover:bg-red-900/40"
              >
                Retry
              </button>
            </div>
          )}

          {log && (
            <>
              <div className="flex items-center gap-2 py-4">
                <SeverityBadge value={log.severity} />
                <StatusBadge value={log.status} />
              </div>

              <dl>
                <Field
                  label="Event time (UTC)"
                  mono
                  value={`${formatTimestamp(log.timestamp)}  ·  ${formatRelative(log.timestamp)}`}
                />
                <Field label="Action" mono value={log.action} />
                <Field
                  label="Actor"
                  mono
                  value={log.actor}
                  pivotLabel="Show every event from this actor"
                  onPivot={() => onPivot({ actor: log.actor })}
                />
                <Field label="Role" value={log.role} />
                <Field label="Resource" mono value={log.resource} />
                <Field label="Resource type" value={log.resourceType} />
                <Field
                  label="IP address"
                  mono
                  value={log.ipAddress}
                  pivotLabel="Show every event from this IP"
                  onPivot={() => onPivot({ ipAddress: log.ipAddress })}
                />
                <Field label="Region" value={log.region} />
                <Field
                  label="Ingested at (UTC)"
                  mono
                  value={formatTimestamp(log.ingestedAt)}
                />
                <Field label="Record ID" mono value={log.id} />
              </dl>

              <details className="my-4">
                <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300">
                  Raw JSON
                </summary>
                <pre className="mt-2 overflow-x-auto rounded border border-slate-900 bg-slate-900/60
                                p-3 font-mono text-[11px] leading-relaxed text-slate-400">
                  {JSON.stringify(log, null, 2)}
                </pre>
              </details>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
