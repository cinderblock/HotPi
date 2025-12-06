#!/usr/bin/env bun

/**
 * Build Script
 *
 * Builds the project using Bun.build() API.
 * Can be used programmatically or as a CLI.
 *
 * Usage:
 *   import { build } from './build';           // Programmatic (in-memory)
 *   bun run build                              // CLI (writes to disk)
 */

import { mkdir, readdir, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { shutdown } from '../utils/shutdown';

export interface BuildOutput {
  filename: string;
  content: string;
}

export interface BuildResult {
  setup: string;
  server: BuildOutput[];
}

/**
 * Build setup bundle only
 */
export async function buildSetup(): Promise<string> {
  console.log('📦 Building setup bundle...');
  const setupResult = await Bun.build({
    entrypoints: ['./src/run/setup.ts'],
    target: 'bun',
    minify: false,
    sourcemap: 'inline',
  });

  if (!setupResult.success) {
    console.error('Setup build errors:', setupResult.logs);
    throw new Error('Failed to build setup bundle');
  }

  if (setupResult.outputs.length !== 1) {
    throw new Error(
      `Expected 1 setup output, got ${setupResult.outputs.length}: ${setupResult.outputs.map(output => output.path).join(', ')}`
    );
  }

  const setupContent = await setupResult.outputs[0].text();
  console.log('✅ Setup bundle built');

  return setupContent;
}

/**
 * Build server bundle only
 */
export async function buildServer(): Promise<BuildOutput[]> {
  console.log('📦 Building server bundle...');
  const serverResult = await Bun.build({
    entrypoints: ['./src/server/index.ts'],
    target: 'bun',
    minify: false,
    sourcemap: 'inline',
    naming: {
      // default values
      // entry: '[dir]/[name].[ext]',
      entry: '[name].[ext]',
      chunk: '[name]-[hash].[ext]',
      asset: '[name]-[hash].[ext]',
    },
  });

  if (!serverResult.success) {
    console.error('Server build errors:', serverResult.logs);
    throw new Error('Failed to build server bundle');
  }

  // Collect all server outputs
  const serverOutputs: BuildOutput[] = [];
  for (const output of serverResult.outputs) {
    const content = await output.text();
    if (dirname(output.path) !== '.') {
      throw new Error(`Output path ${output.path} is not a top level file`);
    }
    const filename = basename(output.path);
    serverOutputs.push({ filename, content });
    console.log(`  ✅ ${filename}`);
  }

  console.log(`✅ Server bundle built (${serverOutputs.length} file${serverOutputs.length !== 1 ? 's' : ''})`);

  return serverOutputs;
}

/**
 * Build all project bundles in memory (in parallel)
 */
export async function build(): Promise<BuildResult> {
  console.log('🔨 Building project...\n');

  const [setup, server] = await Promise.all([buildSetup(), buildServer()]);

  console.log('\n✨ Build complete!\n');

  return {
    setup,
    server,
  };
}

/**
 * CLI mode: Build and write to disk
 */
async function buildToDisk(outDir = 'build') {
  console.log(`📁 Output directory: ${outDir}\n`);

  // Create build directory
  await mkdir(outDir, { recursive: true });

  // Build project
  const result = await build();

  // Track generated files
  const generatedFiles = new Set<string>();

  // Write files to disk
  console.log('💾 Writing files...');
  await Bun.write(`${outDir}/setup.js`, result.setup);
  generatedFiles.add('setup.js');
  console.log(`  ✅ ${outDir}/setup.js`);

  for (const output of result.server) {
    await Bun.write(`${outDir}/${output.filename}`, output.content);
    generatedFiles.add(output.filename);
    console.log(`  ✅ ${outDir}/${output.filename}`);
  }

  // Clean up stale files
  const existingFiles = await readdir(outDir);
  const staleFiles = existingFiles.filter(file => !generatedFiles.has(file));

  if (staleFiles.length > 0) {
    console.log('\n🧹 Cleaning stale files...');
    await Promise.all(
      staleFiles.map(async file => {
        const filePath = join(outDir, file);
        await rm(filePath, { recursive: true, force: true });
        console.log(`  🗑️  ${file}`);
      })
    );
  }

  console.log('\n🎉 Build complete! Files written to disk.\n');
}

// Run as CLI if executed directly
if (import.meta.main) {
  buildToDisk(process.argv[2]).catch(error => {
    console.error('❌ Build failed:', error);
    shutdown(1);
  });
}
