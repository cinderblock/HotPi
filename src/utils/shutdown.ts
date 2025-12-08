import { logger } from './logger.ts';

export function shutdown(exitCode: number = 0, reason?: string): void {
  if (reason) {
    logger.info(`\n${'='.repeat(60)}`);
    logger.info(`Shutting down...${reason ? ` (reason: ${reason})` : ''}`);
    logger.info(`${'='.repeat(60)}\n`);
  }

  process.exitCode = exitCode;

  setTimeout(() => {
    logger.info('Forcing shutdown...');
    process.exit(exitCode);
  }, 400).unref();
}
