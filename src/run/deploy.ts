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

import { join } from 'node:path';
import { logger } from '../utils/logger.ts';
import { shutdown } from '../utils/shutdown.ts';
import { buildWatch } from './build.ts';
import {
  DeployAppDir,
  DeployBunBin,
  DeployDevServiceName,
  DeployHost,
  DeployKey,
  DeployPort,
  DeployServiceName,
  DeploySetupHome,
  DeploySetupPath,
  DeployUser,
} from './config.ts';
import {
  checkSSHConnection,
  closeSSHConnection,
  readdir,
  type SSHConfig,
  sshExec,
  unlink,
  writeRemoteFile,
} from './ssh.ts';

interface DeployConfig {
  sshConfig: SSHConfig;
}

/**
 * Check if an error is an abort error (expected when operations are cancelled)
 */
function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message === 'File write aborted' || error.message === 'SSH command aborted';
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
  logger.info(`${emoji} ${message}`);
}

async function ensureBunInstalled(config: DeployConfig, signal?: AbortSignal): Promise<void> {
  logger.debug('Checking if Bun is installed on remote...');

  try {
    const version = await sshExec(config.sshConfig, DeployBunBin, ['--version'], signal);
    logger.debug(`Bun ${version.trim()} already installed`);
    return;
  } catch {
    logger.debug('Bun not found, installing...');
  }

  signal?.throwIfAborted();

  // Install Bun using official installer
  logger.debug('Downloading and installing Bun...');
  await sshExec(config.sshConfig, 'curl -fsSL https://bun.sh/install | bash', [], signal);

  signal?.throwIfAborted();

  // Verify installation
  try {
    const version = await sshExec(config.sshConfig, DeployBunBin, ['--version'], signal);
    logger.debug(`Bun ${version.trim()} installed successfully`);
  } catch {
    throw new Error('Failed to install Bun on remote host');
  }
}

async function deploySetupBundle(config: DeployConfig, setupBundle: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  logger.debug('Transferring setup bundle to Pi...');

  // Write directly to home directory
  await writeRemoteFile(config.sshConfig, setupBundle, DeploySetupPath, false, signal);

  logger.debug('Setup bundle deployed');
}

async function runSetup(config: DeployConfig, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  log('Running setup on Pi...', '⚙️');

  // Setup script calls sudo internally for privileged operations
  await runBunOnRemote(config, [DeploySetupPath], DeploySetupHome, signal, true);
}

async function deployPackageFiles(config: DeployConfig, signal?: AbortSignal): Promise<void> {
  logger.debug('Transferring package files...');

  // Read and transfer server package.json
  const content = await Bun.file('src/server/package.json').text();
  await writeRemoteFile(config.sshConfig, content, `${DeployAppDir}/package.json`, false, signal);

  logger.debug('Package files deployed');
}

async function runBunOnRemote(
  config: DeployConfig,
  command: string[],
  cwd = DeployAppDir,
  signal?: AbortSignal,
  streamToTerminal = false,
  env?: Record<string, string>
): Promise<void> {
  logger.debug(`Running command ${command.join(' ')} on remote...`);

  // Prefix with env exports when provided to override remote defaults (e.g., frozen lockfile)
  const envArgs = env ? Object.entries(env).map(([key, value]) => `${key}=${value}`) : [];
  const baseArgs = ['--smol', ...command, '--cwd', cwd].filter(Boolean);

  const isEnvCall = envArgs.length > 0;
  const execCommand = isEnvCall ? 'env' : DeployBunBin;
  const params = isEnvCall ? [...envArgs, DeployBunBin, ...baseArgs] : baseArgs;

  await sshExec(config.sshConfig, execCommand, params, signal, streamToTerminal);
}

async function installRemoteDependencies(config: DeployConfig, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  logger.debug('Installing dependencies on remote...');

  // Install production dependencies in app directory
  await runBunOnRemote(config, ['install', '--production'], DeployAppDir, signal, true, {
    BUN_INSTALL_FROZEN_LOCKFILE: '0',
  });

  logger.debug('Dependencies installed');
}

async function deployBuildFiles(
  config: DeployConfig,
  files: string[],
  buildDir: string,
  signal?: AbortSignal,
  cleanup = false
): Promise<void> {
  if (files.length === 0) return;

  // Sort files: assets first (CSS, hashed bundles), then source files
  const sortedFiles = [...files].sort((a, b) => {
    // Assets: CSS files and files with hash in name (e.g., index-abc123.js)
    const aIsAsset = a.endsWith('.css') || /^[^-]+-[^-]+\.(js|css)$/.test(a);
    const bIsAsset = b.endsWith('.css') || /^[^-]+-[^-]+\.(js|css)$/.test(b);

    if (aIsAsset && !bIsAsset) return -1; // assets first
    if (!aIsAsset && bIsAsset) return 1;
    return a.localeCompare(b); // alphabetical within same category
  });

  logger.debug(`Transferring ${files.length} file${files.length !== 1 ? 's' : ''}...`);

  // Upload files sequentially to avoid SSH channel exhaustion
  // Assets first, then source files
  for (const filename of sortedFiles) {
    const localPath = join(buildDir, filename);
    const content = await Bun.file(localPath).text();
    await writeRemoteFile(config.sshConfig, content, `${DeployAppDir}/${filename}`, false, signal);
    logger.debug(`  ✅ ${filename}`);
  }

  // Clean up old files last if requested
  if (cleanup) {
    const fs = await import('node:fs/promises');
    const localBuildFiles: string[] = [];
    try {
      const entries = await fs.readdir(buildDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          localBuildFiles.push(entry.name);
        }
      }
    } catch {
      // If we can't read the directory, skip cleanup
      return;
    }

    const remoteFiles = (await readdir(config.sshConfig, DeployAppDir, signal))
      .filter(file => file.attrs.isFile())
      .map(file => file.filename);

    const sourceFiles = remoteFiles.filter(file => file !== 'package.json');
    const extraFiles = sourceFiles.filter(file => !localBuildFiles.includes(file));

    if (extraFiles.length > 0) {
      logger.debug(`Cleaning up ${extraFiles.length} extra file${extraFiles.length !== 1 ? 's' : ''}...`);
      // Cleanup sequentially as well
      for (const file of extraFiles) {
        await unlink(config.sshConfig, `${DeployAppDir}/${file}`, signal);
      }
    }
  }
}

async function deployAllBuildFiles(config: DeployConfig, buildDir: string, signal?: AbortSignal): Promise<void> {
  logger.debug('Transferring all build files...');

  // Read local build directory
  const fs = await import('node:fs/promises');
  const localBuildFiles: string[] = [];
  try {
    const entries = await fs.readdir(buildDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        localBuildFiles.push(entry.name);
      }
    }
  } catch (error) {
    throw new Error(`Failed to read build directory: ${error}`);
  }

  if (localBuildFiles.length === 0) {
    throw new Error(`No files found in build directory: ${buildDir}`);
  }

  await deployBuildFiles(config, localBuildFiles, buildDir, signal);

  // Clean up extra files on remote
  const remoteFiles = (await readdir(config.sshConfig, DeployAppDir, signal))
    .filter(file => file.attrs.isFile())
    .map(file => file.filename);

  const sourceFiles = remoteFiles.filter(file => file !== 'package.json' && file !== 'bun.lock');
  const extraFiles = sourceFiles.filter(file => !localBuildFiles.includes(file));

  if (extraFiles.length > 0) {
    logger.debug(`Cleaning up ${extraFiles.length} extra file${extraFiles.length !== 1 ? 's' : ''}...`);
    await Promise.all(extraFiles.map(file => unlink(config.sshConfig, `${DeployAppDir}/${file}`, signal)));
  }

  log(`Files deployed (${localBuildFiles.length} file${localBuildFiles.length !== 1 ? 's' : ''})`, '✅');
}

async function startService(config: DeployConfig, serviceName: string, signal?: AbortSignal): Promise<void> {
  logger.debug(`Starting ${serviceName} service...`);
  signal?.throwIfAborted();

  try {
    // Start service (systemd will handle if already running)
    await sshExec(config.sshConfig, 'sudo systemctl start', [serviceName], signal);

    logger.debug(`${serviceName} started`);
  } catch (error: unknown) {
    logErrorMessage(`Failed to start ${serviceName}:`, error);
    logger.debug('Checking service status...');
    await sshExec(config.sshConfig, 'journalctl', ['-u', serviceName, '-n', '20', '--no-pager'], signal);
    throw error;
  }

  signal?.throwIfAborted();
}

async function stopService(config: DeployConfig, serviceName: string, signal?: AbortSignal): Promise<void> {
  try {
    await sshExec(config.sshConfig, 'sudo systemctl stop', [serviceName], signal);
    logger.debug(`${serviceName} stopped`);
  } catch {
    // Service might not be running, that's ok
    logger.debug(`${serviceName} was not running`);
  }
}

async function checkStatus(
  config: DeployConfig,
  signal?: AbortSignal,
  serviceName = DeployDevServiceName
): Promise<void> {
  signal?.throwIfAborted();
  logger.debug('Checking deployment status...');

  try {
    await sshExec(config.sshConfig, 'systemctl status', [serviceName], signal);
  } catch (_error) {
    logger.warn('⚠️  Service may not be running properly');
  }
}

async function performInitialDeploy(config: DeployConfig, buildDir: string, signal?: AbortSignal): Promise<void> {
  log('Starting initial deployment...', '🚀');

  // Check SSH connection
  signal?.throwIfAborted();
  logger.debug('Checking SSH connection...');
  if (!(await checkSSHConnection(config.sshConfig))) {
    throw new Error(`Cannot connect to ${config.sshConfig.user}@${config.sshConfig.host}`);
  }
  logger.debug('SSH connection OK');

  // Ensure Bun is installed on remote
  await ensureBunInstalled(config, signal);

  // Read setup bundle from build directory
  signal?.throwIfAborted();
  const setupContent = await Bun.file(`${buildDir}/setup.js`).text();
  await deploySetupBundle(config, setupContent, signal);

  // Run setup (creates directories, installs system deps, configures services)
  await runSetup(config, signal);

  // Deploy package files and install dependencies
  await deployPackageFiles(config, signal);
  await installRemoteDependencies(config, signal);

  // Deploy all build files
  await deployAllBuildFiles(config, buildDir, signal);

  // Start dev service (systemd handles if already running)
  await startService(config, DeployDevServiceName, signal);

  // Check status
  await checkStatus(config, signal);

  log('Initial deployment complete!', '🎉');
}

function logErrorMessage(prefix: string, err: unknown): void {
  if (err instanceof Error) {
    logger.error(`${prefix} ${err.message}`);
    if (err.stack) {
      logger.debug(err.stack);
    }
  } else {
    logger.error(`${prefix} ${String(err)}`);
  }
}

async function watchMode(config: DeployConfig, buildDir = 'build'): Promise<void> {
  log('Starting watch mode...', '👀');
  logger.debug(`Monitoring: ${buildDir}/ for file changes`);

  let currentUploadId = 0;
  let currentAbortController: AbortController | null = null;
  let isUploading = false;

  const triggerUpload = async (files: string[], enableCleanup = false) => {
    // Abort any in-progress upload
    if (currentAbortController) {
      logger.debug('Aborting previous upload...');
      currentAbortController.abort();
    }

    // Wait for previous upload to finish cleaning up
    while (isUploading) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Capture files for this upload
    const filesToUpload = [...files];
    if (filesToUpload.length === 0) return;

    // Start new upload with fresh abort controller
    const uploadId = ++currentUploadId;
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;
    isUploading = true;

    try {
      await deployBuildFiles(config, filesToUpload, buildDir, signal, enableCleanup);

      // Only log success if we weren't aborted
      if (uploadId === currentUploadId && !signal.aborted) {
        logger.debug(`Upload complete: ${filesToUpload.length} file${filesToUpload.length !== 1 ? 's' : ''}`);
      }
    } catch (err) {
      // Only log errors if we weren't aborted and are still current
      if (uploadId === currentUploadId && !signal.aborted && !isAbortError(err)) {
        logErrorMessage('Upload error:', err);
      } else if (signal.aborted || isAbortError(err)) {
        logger.debug('Upload aborted, superseded by new changes');
      }
    } finally {
      isUploading = false;
      // Clear abort controller if we're still the current upload
      if (uploadId === currentUploadId) currentAbortController = null;
    }
  };

  // Debounced upload to batch rapid build completions
  const debouncedUpload = debounce((files: string[], cleanup: boolean) => {
    triggerUpload(files, cleanup);
  }, 100);

  // Start build watch process - this is the single source of truth
  // Skip initial build since we just built and deployed
  const buildCleanup = await buildWatch(
    buildDir,
    builtFiles => {
      // When build completes, upload all built files with cleanup enabled
      const filesArray = [...builtFiles];
      logger.debug(`Build complete: ${filesArray.length} file${filesArray.length !== 1 ? 's' : ''}`);
      debouncedUpload(filesArray, true);
    },
    true // skipInitialBuild: true
  );

  // Exit handler: start main service and stop dev service
  const exitHandler = async () => {
    log('Stopping watch mode...', '👋');

    buildCleanup();

    try {
      logger.debug('Stopping dev service...');
      await stopService(config, DeployDevServiceName);

      logger.debug('Starting main service...');
      await startService(config, DeployServiceName);
    } catch (error) {
      logErrorMessage('Error during cleanup:', error);
    }

    await closeSSHConnection();
    shutdown(0);
  };

  process.on('SIGINT', exitHandler);
  process.on('SIGTERM', exitHandler);
}

/**
 * Run a function after a delay, but skip if the function is called again within the delay.
 * @param fn - The function to debounce.
 * @param delay - The delay in milliseconds.
 * @returns A function that can be called to debounce the input value.
 */
function debounce<T extends unknown[]>(fn: (...args: T) => void, delay: number) {
  let timeout: NodeJS.Timeout;
  return (...args: T) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      fn(...args);
    }, delay);
  };
}

async function main() {
  const config = await loadConfig();
  const onceMode = process.argv.includes('--once');
  const buildDir = 'build';

  log('Battery Charge & Discharge Controller - Development Deployment', '🔧');
  logger.debug(`📡 Target: ${config.sshConfig.user}@${config.sshConfig.host}`);
  logger.debug(`📂 App Dir: ${DeployAppDir}`);
  logger.debug(`📁 Build Dir: ${buildDir}`);
  if (onceMode) {
    logger.debug('🎯 Mode: Deploy once (no watch)');
  }

  // Clean and build to disk
  const fs = await import('node:fs/promises');
  const { rm } = await import('node:fs/promises');
  try {
    // Clean up build directory at startup
    const buildExists = await fs.stat(buildDir).catch(() => null);
    if (buildExists) {
      logger.debug('Cleaning build directory...');
      await rm(buildDir, { recursive: true, force: true });
    }

    // Always build fresh
    log('Building project...', '🔨');
    const buildModule = await import('./build');
    await buildModule.buildToDisk({ setup: true, server: true }, buildDir);
  } catch (err) {
    logger.error('❌ Build failed:');
    if (err instanceof Error) {
      logger.error('Error:', err.message);
      if (err.stack) {
        logger.error('Stack:', err.stack);
      }
    } else {
      logger.error('Error:', err);
    }
    shutdown(1);
  }

  // Perform initial deployment
  try {
    await performInitialDeploy(config, buildDir);
  } catch (err) {
    logErrorMessage('❌ Initial deployment failed:', err);
    await closeSSHConnection();
    shutdown(1);
  }

  // Watch for changes unless --once flag is set
  if (!onceMode) {
    await watchMode(config, buildDir);
  } else {
    log('Deployment complete! Exiting (--once mode)', '✅');
    await closeSSHConnection();
  }
}

main().catch(async error => {
  logErrorMessage('❌ Deployment failed:', error);
  await closeSSHConnection();
  shutdown(1);
});
