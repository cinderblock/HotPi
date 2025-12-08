import winston from 'winston';

/**
 * Winston logger configuration
 * Provides structured logging with different levels and formats
 */

// const logLevel = process.env.LOG_LEVEL || 'info';

// Custom format that preserves emojis and messages
const customFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
  const timestampStr = timestamp ? `[${timestamp}]` : '';
  const metaStr = Object.keys(metadata).length ? JSON.stringify(metadata) : '';
  return `${timestampStr} ${message}${metaStr ? ' ' + metaStr : ''}`;
});

// Create the logger
export const logger = winston.createLogger({
  //   level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    customFormat
  ),
  defaultMeta: {},
  transports: [
    // Write all logs to console
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), customFormat),
    }),
  ],
});

// Export convenience methods that match console API
export const log = {
  info: (message: string, ...args: unknown[]) => logger.info(message, ...args),
  error: (message: string, ...args: unknown[]) => logger.error(message, ...args),
  warn: (message: string, ...args: unknown[]) => logger.warn(message, ...args),
  debug: (message: string, ...args: unknown[]) => logger.debug(message, ...args),
};
