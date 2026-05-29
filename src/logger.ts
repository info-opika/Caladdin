type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogFields {
  requestId?: string;
  userId?: string;
  intent?: string;
  [key: string]: unknown;
}

function log(level: LogLevel, message: string, fields?: LogFields): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (message: string, fields?: LogFields) => log('info', message, fields),
  warn: (message: string, fields?: LogFields) => log('warn', message, fields),
  error: (message: string, fields?: LogFields) => log('error', message, fields),
  debug: (message: string, fields?: LogFields) => log('debug', message, fields),
};
