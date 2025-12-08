/**
 * Browser-compatible logger
 * Provides the same API as the winston logger but uses console methods
 */

// Create a logger object that matches the winston logger API
export const logger = {
  info: (message: string, ...args: unknown[]) => {
    console.log(message, ...args);
  },
  error: (message: string, ...args: unknown[]) => {
    console.error(message, ...args);
  },
  warn: (message: string, ...args: unknown[]) => {
    console.warn(message, ...args);
  },
  debug: (message: string, ...args: unknown[]) => {
    console.debug(message, ...args);
  },
};

// Export convenience methods that match console API (for consistency with winston logger)
export const log = {
  info: (message: string, ...args: unknown[]) => logger.info(message, ...args),
  error: (message: string, ...args: unknown[]) => logger.error(message, ...args),
  warn: (message: string, ...args: unknown[]) => logger.warn(message, ...args),
  debug: (message: string, ...args: unknown[]) => logger.debug(message, ...args),
};
