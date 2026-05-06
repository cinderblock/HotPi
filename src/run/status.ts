#!/usr/bin/env bun

/**
 * Status Check Script
 *
 * Runs on development machine to check remote Pi status via SSH
 *
 * Usage:
 *   bun run status
 */

import { logger } from '../utils/logger.ts';
import { shutdown } from '../utils/shutdown.ts';
import { DeployHost, DeployKey, DeployUser } from './config.ts';
import { checkSSHConnection, type SSHConfig, sshExec } from './ssh.ts';

async function loadConfig(): Promise<SSHConfig> {
  return {
    host: DeployHost,
    user: DeployUser,
    keyPath: DeployKey,
  };
}

function log(message: string, emoji = 'ℹ️') {
  logger.info(`${emoji} ${message}`);
}

async function checkRemoteStatus(config: SSHConfig) {
  logger.info('📊 HotPi Reflow Oven Controller - Remote Status');
  logger.info('======================================\n');
  logger.info(`Target: ${config.user}@${config.host}\n`);

  log('Checking SSH connection...', '🔌');
  if (!(await checkSSHConnection(config))) {
    logger.error(`❌ Cannot connect to ${config.user}@${config.host}`);
    logger.error('\nPlease check:');
    logger.error('  - Host is reachable');
    logger.error('  - SSH is configured');
    logger.error(`  - DEPLOY_HOST in .env is correct (currently: ${config.host})`);
    shutdown(1);
  }
  log('SSH connection OK', '✅');

  try {
    logger.info(`\n${'='.repeat(60)}`);
    logger.info('🔧 Systemd Service Status');
    logger.info(`${'='.repeat(60)}\n`);
    await sshExec(config, 'sudo systemctl status hotpi --no-pager -l || echo "Service not found"');

    logger.info(`\n${'='.repeat(60)}`);
    logger.info('📝 Recent Logs (last 30 lines)');
    logger.info(`${'='.repeat(60)}\n`);
    await sshExec(config, 'sudo journalctl -u hotpi -n 30 --no-pager || echo "No logs available"');

    logger.info(`\n${'='.repeat(60)}`);
    logger.info('🌐 Network Information');
    logger.info(`${'='.repeat(60)}\n`);
    await sshExec(config, 'echo "Hostname: $(hostname)" && echo "IP: $(hostname -I | awk \'{print $1}\')"');

    logger.info(`\n${'='.repeat(60)}`);
    logger.info('💾 Disk Usage');
    logger.info(`${'='.repeat(60)}\n`);
    await sshExec(config, 'df -h /opt/hotpi 2>/dev/null || df -h /');

    logger.info(`\n${'='.repeat(60)}`);
    logger.info(`🌐 Web Interface: http://${config.host}`);
    logger.info(`${'='.repeat(60)}\n`);

    logger.info('Commands:');
    logger.info(`  View live logs: ssh ${config.user}@${config.host} "sudo journalctl -u hotpi -f"`);
    logger.info(`  Restart: ssh ${config.user}@${config.host} "sudo systemctl restart hotpi"`);
    logger.info('  Redeploy: bun run deploy\n');
  } catch (error) {
    logger.error('\n❌ Failed to fetch status:', error);
    shutdown(1);
  }
}

async function main() {
  const config = await loadConfig();
  await checkRemoteStatus(config);
}

main().catch(error => {
  logger.error('❌ Status check failed:', error);
  shutdown(1);
});
