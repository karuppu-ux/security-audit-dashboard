/* eslint-disable no-console */

/**
 * Deliberately tiny. A real deployment would swap this for pino/winston with
 * structured output shipped to the log pipeline; the point of routing every
 * message through one module is that the swap is a one-file change.
 */
const isTest = process.env.NODE_ENV === 'test';

function emit(level, args) {
  if (isTest && level !== 'error') return;
  const line = `${new Date().toISOString()} [${level.toUpperCase()}]`;
  console[level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'log'](line, ...args);
}

export const logger = {
  info: (...args) => emit('info', args),
  warn: (...args) => emit('warn', args),
  error: (...args) => emit('error', args),
};
