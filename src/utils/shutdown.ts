export function shutdown(exitCode: number = 0, reason?: string): void {
  if (reason) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Shutting down...${reason ? ` (reason: ${reason})` : ''}`);
    console.log(`${'='.repeat(60)}\n`);
  }

  process.exitCode = exitCode;

  setTimeout(() => {
    console.log('Forcing shutdown...');
    process.exit(exitCode);
  }, 400).unref();
}
