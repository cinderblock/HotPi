#!/usr/bin/env bun

import { watch } from 'node:fs';

console.log('Watching src/ directory...');
console.log('Make a change to any file in src/ to see events\n');

const watcher = watch('src', { recursive: true }, (eventType, filename) => {
  console.log(`[${new Date().toLocaleTimeString()}] Event: ${eventType}, File: ${filename || '(no filename)'}`);
});

console.log('Watcher started. Press Ctrl+C to stop.\n');

process.on('SIGINT', () => {
  console.log('\nStopping watcher...');
  watcher.close();
  process.exit(0);
});
