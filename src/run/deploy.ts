#!/usr/bin/env bun

/**
 * Development Deployment Script
 *
 * Runs on development machine. Builds project in memory, transfers to Pi via SSH,
 * starts dev service with --watch, and monitors for changes.
 *
 * Usage:
 *   bun start                   # Deploy and watch for changes
 *   bun start --once            # Deploy once without watching
 */

import { watch } from 'node:fs';
import { shutdown } from '../utils/shutdown';
import { type BuildOutput, build } from './build';
import {
  DeployAppDir,
  DeployBunBin,
  DeployDevServiceName,
  DeployHost,
  DeployKey,
  DeployPort,
  DeploySetupHome,
  DeploySetupPath,
  DeployUser,
} from './config';
import {
  checkSSHConnection,
  closeSSHConnection,
  readdir,
  type SSHConfig,
  sshExec,
  unlink,
  writeRemoteFile,
} from './ssh';

interface DeployConfig {
  sshConfig: SSHConfig;
}

async function loadConfig(): Promise<DeployConfig> {
  return {
    sshConfig: {
      host: DeployHost,
      user: DeployUser,
      keyPath: DeployKey,
      port: DeployPort,
    },
  };
}

function log(message: string, emoji = '📦') {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] ${emoji} ${message}`);
}

async function ensureBunInstalled(config: DeployConfig, signal?: AbortSignal): Promise<void> {
  log('Checking if Bun is installed on remote...', '🔍');

  try {
    const version = await sshExec(config.sshConfig, DeployBunBin, ['--version'], signal);
    log(`Bun ${version.trim()} already installed`, '✅');
    return;
  } catch {
    log('Bun not found, installing...', '📥');
  }

  signal?.throwIfAborted();

  // Install Bun using official installer
  log('Downloading and installing Bun...', '⬇️');
  await sshExec(config.sshConfig, 'curl -fsSL https://bun.sh/install | bash', [], signal);

  signal?.throwIfAborted();

  // Verify installation
  try {
    const version = await sshExec(config.sshConfig, DeployBunBin, ['--version'], signal);
    log(`Bun ${version.trim()} installed successfully`, '✅');
  } catch {
    throw new Error('Failed to install Bun on remote host');
  }
}

async function deploySetupBundle(config: DeployConfig, setupBundle: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  log('Transferring setup bundle to Pi...', '📤');

  // Write directly to home directory
  await writeRemoteFile(config.sshConfig, setupBundle, DeploySetupPath, false, signal);

  log('Setup bundle deployed', '✅');
}

async function runSetup(config: DeployConfig, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  log('Running setup on Pi...', '⚙️');

  // Setup script calls sudo internally for privileged operations
  await runBunOnRemote(config, [DeploySetupPath], DeploySetupHome, signal, true);

  log('Setup completed', '✅');
}

async function deployPackageFiles(config: DeployConfig, signal?: AbortSignal): Promise<void> {
  log('Transferring package files...', '📤');

  // Read and transfer both files in parallel
  await Promise.all([
    Bun.file('package.json')
      .text()
      .then(content => writeRemoteFile(config.sshConfig, content, `${DeployAppDir}/package.json`, false, signal)),
    Bun.file('bun.lock')
      .text()
      .then(content => writeRemoteFile(config.sshConfig, content, `${DeployAppDir}/bun.lock`, false, signal)),
  ]);

  log('Package files deployed', '✅');
}

async function runBunOnRemote(
  config: DeployConfig,
  command: string[],
  cwd = DeployAppDir,
  signal?: AbortSignal,
  streamToTerminal = false
): Promise<void> {
  log(`Running command ${command.join(' ')} on remote...`, '📤');
  await sshExec(
    config.sshConfig,
    DeployBunBin,
    ['--smol', ...command, '--cwd', cwd].filter(Boolean),
    signal,
    streamToTerminal
  );
}

async function installRemoteDependencies(config: DeployConfig, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  log('Installing dependencies on remote...', '📦');

  // Install production dependencies in app directory
  await runBunOnRemote(config, ['install', '--production'], DeployAppDir, signal, true);

  log('Dependencies installed', '✅');
}

async function deployServer(config: DeployConfig, outputs: BuildOutput[], signal?: AbortSignal): Promise<void> {
  log('Transferring server files...', '📤');

  // Write all output files to app dir in parallel
  await Promise.all(
    outputs.map(output =>
      writeRemoteFile(config.sshConfig, output.content, `${DeployAppDir}/${output.filename}`, false, signal).then(
        () => {
          log(`  ✅ ${output.filename}`, '');
        }
      )
    )
  );

  const files = (await readdir(config.sshConfig, DeployAppDir, signal))
    .filter(file => file.attrs.isFile())
    .map(file => file.filename);

  const sourceFiles = files.filter(file => file !== 'package.json' && file !== 'bun.lock');

  const extraFiles = sourceFiles.filter(file => !outputs.some(output => output.filename === file));

  if (extraFiles.length > 0) {
    log(`Extra files: ${extraFiles.join(', ')}`, '⚠️');
    await Promise.all(extraFiles.map(file => unlink(config.sshConfig, `${DeployAppDir}/${file}`, signal)));
  }

  log(`Server deployed (${outputs.length} file${outputs.length !== 1 ? 's' : ''})`, '✅');
}

async function restartService(config: DeployConfig, signal?: AbortSignal): Promise<void> {
  // Always use dev service when deploying from dev machine
  const serviceName = DeployDevServiceName;
  log(`Restarting ${serviceName} service...`, '🔄');
  signal?.throwIfAborted();

  try {
    // Start service
    await sshExec(config.sshConfig, 'sudo systemctl restart', [serviceName], signal);

    log('Service restarted', '✅');
  } catch (error: unknown) {
    console.error('Failed to restart service:', error);
    log('Checking service status...', 'ℹ️');
    await sshExec(config.sshConfig, 'journalctl', ['-u', serviceName, '-n', '20', '--no-pager'], signal);
    throw error;
  }

  signal?.throwIfAborted();
}

async function checkStatus(
  config: DeployConfig,
  signal?: AbortSignal,
  serviceName = DeployDevServiceName
): Promise<void> {
  signal?.throwIfAborted();
  log('Checking deployment status...', '📊');

  try {
    await sshExec(config.sshConfig, 'systemctl status', [serviceName], signal);
  } catch (_error) {
    console.error('⚠️  Service may not be running properly');
  }
}

async function performDeploy(config: DeployConfig, isUpdate = false, signal?: AbortSignal): Promise<void> {
  const action = isUpdate ? 'UPDATE' : 'DEPLOY';
  console.log(`\n${'='.repeat(60)}`);
  log(`Starting ${action}...`, '🚀');
  console.log(`${'='.repeat(60)}\n`);

  // Check SSH connection
  signal?.throwIfAborted();
  log('Checking SSH connection...', '🔌');
  if (!(await checkSSHConnection(config.sshConfig))) {
    throw new Error(`Cannot connect to ${config.sshConfig.user}@${config.sshConfig.host}`);
  }
  log('SSH connection OK', '✅');

  // Ensure Bun is installed on remote
  await ensureBunInstalled(config, signal);

  // Build project
  signal?.throwIfAborted();
  log('Building project...', '🔨');
  const buildResult = await build();

  // Deploy setup bundle
  await deploySetupBundle(config, buildResult.setup, signal);

  // Run setup (only on first deploy or if explicitly requested)
  // Setup creates directories, installs system deps, configures services
  if (!isUpdate || process.argv.includes('--setup')) {
    await runSetup(config, signal);
  }

  // Deploy package files and install dependencies
  await deployPackageFiles(config, signal);
  await installRemoteDependencies(config, signal);

  // Deploy server bundle
  await deployServer(config, buildResult.server, signal);

  // Restart service
  await restartService(config, signal);

  // Check status
  await checkStatus(config, signal);

  console.log(`\n${'='.repeat(60)}`);
  log(`${action} COMPLETE!`, '🎉');
  console.log(`${'='.repeat(60)}\n`);
}

async function watchMode(config: DeployConfig): Promise<void> {
  console.log('\n👀 Watching for changes...\n');
  console.log('Monitoring: src/ (.ts, .tsx, .css files)\n');
  console.log('Press Ctrl+C to stop\n');

  let currentBuildId = 0;
  let currentAbortController: AbortController | null = null;
  let isDeploying = false;

  // Track changes by area
  let changeCount = {
    frontend: 0,
    server: 0,
    run: 0,
  };

  const triggerDeploy = debounce(async () => {
    // Abort any in-progress deploy
    if (currentAbortController) {
      log('Aborting previous build...', '🛑');
      currentAbortController.abort();
    }

    // Wait for previous deploy to finish cleaning up
    while (isDeploying) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Capture counts for this build
    const buildChanges = { ...changeCount };
    const totalChanges = buildChanges.frontend + buildChanges.server + buildChanges.run;

    // Start new deploy with fresh abort controller
    const buildId = ++currentBuildId;
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;
    isDeploying = true;

    try {
      await performDeploy(config, true, signal);

      // Only log success if we weren't aborted
      if (buildId !== currentBuildId || signal.aborted) return;

      // Reset counters for next build
      changeCount = { frontend: 0, server: 0, run: 0 };

      const parts: string[] = [];
      if (buildChanges.frontend > 0) parts.push(`${buildChanges.frontend} frontend`);
      if (buildChanges.server > 0) parts.push(`${buildChanges.server} server`);
      if (buildChanges.run > 0) parts.push(`${buildChanges.run} build`);
      const changesSummary = parts.join(', ');
      log(`Deploy completed: ${totalChanges} change${totalChanges !== 1 ? 's' : ''} (${changesSummary})`, '✅');
    } catch (error) {
      // Only log errors if we weren't aborted and are still current
      if (buildId === currentBuildId && !signal.aborted) {
        console.error('Deploy error:', error);
      } else if (signal.aborted) {
        log('Build aborted, superseded by new changes', '⏭️');
      }
    } finally {
      isDeploying = false;
      // Clear abort controller if we're still the current build
      if (buildId === currentBuildId) currentAbortController = null;
    }
  }, 50);

  const logFileChanges = debounce((accumulated: string[]) => {
    log(`Changed: ${accumulated[0]} 🔄${accumulated.length > 1 ? ` and ${accumulated.length - 1} others` : ''}`);
  }, 10);

  console.log(`PWD: ${process.cwd()}`);

  // Watch source directory
  const watcher = watch('src', { recursive: true, persistent: true }, (_eventType, filename) => {
    if (!filename) {
      console.log('[DEBUG] Event received but no filename');
      return;
    }

    // Normalize path separators for Windows
    const normalizedFilename = filename.replace(/\\/g, '/');
    console.log(`[DEBUG] Event: ${_eventType}, File: ${normalizedFilename}`);

    let area: keyof typeof changeCount | undefined;

    if (normalizedFilename.match(/^server\/.*\.ts$/)) area = 'server';
    if (normalizedFilename.match(/^frontend\/.*\.(tsx?|css)$/)) area = 'frontend';
    if (normalizedFilename.match(/^run\/.*\.ts$/)) area = 'run';

    if (area) {
      changeCount[area]++;
      logFileChanges(normalizedFilename);
      triggerDeploy(null);
    } else {
      console.log(`[DEBUG] File ${normalizedFilename} did not match any area pattern`);
    }
  });

  // Keep process alive
  process.on('SIGINT', async () => {
    console.log('\n\n👋 Stopping watch mode...\n');
    watcher.close();
    await closeSSHConnection();
    shutdown(0);
  });
}

/**
 * Run a function after a delay, but skip if the function is called again within the delay.
 * @param fn - The function to debounce.
 * @param delay - The delay in milliseconds.
 * @returns A function that can be called to debounce the input value.
 */
function debounce<T>(fn: (accumulated: T[]) => void, delay: number) {
  let timeout: NodeJS.Timeout;
  const skips: T[] = [];
  return (value: T) => {
    skips.push(value);
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      fn(skips);
      skips.length = 0;
    }, delay);
  };
}

async function main() {
  const config = await loadConfig();
  const onceMode = process.argv.includes('--once');

  console.log('🔧 Battery Controller - Development Deployment');
  console.log(`📡 Target: ${config.sshConfig.user}@${config.sshConfig.host}`);
  console.log(`📂 App Dir: ${DeployAppDir}`);
  if (onceMode) {
    console.log('🎯 Mode: Deploy once (no watch)');
  }
  console.log('\n');

  // Perform initial deployment
  try {
    await performDeploy(config);
  } catch (error) {
    console.error('\n❌ Initial deployment failed:', error);
    await closeSSHConnection();
    shutdown(1);
  }

  // Watch for changes unless --once flag is set
  if (!onceMode) {
    await watchMode(config);
  } else {
    console.log('✅ Deployment complete! Exiting (--once mode)\n');
    await closeSSHConnection();
  }
}

main().catch(async error => {
  console.error('❌ Deployment failed:', error);
  await closeSSHConnection();
  shutdown(1);
});
