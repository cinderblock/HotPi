#!/usr/bin/env bun

/**
 * Status Check Script
 *
 * Runs on development machine to check remote Pi status via SSH
 *
 * Usage:
 *   bun run status
 */

import { shutdown } from '../utils/shutdown';
import { DeployHost, DeployKey, DeployUser } from './config';
import { checkSSHConnection, type SSHConfig, sshExec } from './ssh';

async function loadConfig(): Promise<SSHConfig> {
  return {
    host: DeployHost,
    user: DeployUser,
    keyPath: DeployKey,
  };
}

function log(message: string, emoji = 'ℹ️') {
  console.log(`${emoji} ${message}`);
}

async function checkRemoteStatus(config: SSHConfig) {
  console.log('📊 Battery Controller - Remote Status');
  console.log('======================================\n');
  console.log(`Target: ${config.user}@${config.host}\n`);

  log('Checking SSH connection...', '🔌');
  if (!(await checkSSHConnection(config))) {
    console.error(`❌ Cannot connect to ${config.user}@${config.host}`);
    console.error('\nPlease check:');
    console.error('  - Host is reachable');
    console.error('  - SSH is configured');
    console.error(`  - DEPLOY_HOST in .env is correct (currently: ${config.host})`);
    shutdown(1);
  }
  log('SSH connection OK', '✅');

  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log('🔧 Systemd Service Status');
    console.log(`${'='.repeat(60)}\n`);
    await sshExec(config, 'sudo systemctl status battery-controller --no-pager -l || echo "Service not found"');

    console.log(`\n${'='.repeat(60)}`);
    console.log('📝 Recent Logs (last 30 lines)');
    console.log(`${'='.repeat(60)}\n`);
    await sshExec(config, 'sudo journalctl -u battery-controller -n 30 --no-pager || echo "No logs available"');

    console.log(`\n${'='.repeat(60)}`);
    console.log('🌐 Network Information');
    console.log(`${'='.repeat(60)}\n`);
    await sshExec(config, 'echo "Hostname: $(hostname)" && echo "IP: $(hostname -I | awk \'{print $1}\')"');

    console.log(`\n${'='.repeat(60)}`);
    console.log('💾 Disk Usage');
    console.log(`${'='.repeat(60)}\n`);
    await sshExec(config, 'df -h /opt/battery-controller 2>/dev/null || df -h /');

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🌐 Web Interface: http://${config.host}`);
    console.log(`${'='.repeat(60)}\n`);

    console.log('Commands:');
    console.log(`  View live logs: ssh ${config.user}@${config.host} "sudo journalctl -u battery-controller -f"`);
    console.log(`  Restart: ssh ${config.user}@${config.host} "sudo systemctl restart battery-controller"`);
    console.log('  Redeploy: bun run deploy\n');
  } catch (error) {
    console.error('\n❌ Failed to fetch status:', error);
    shutdown(1);
  }
}

async function main() {
  const config = await loadConfig();
  await checkRemoteStatus(config);
}

main().catch(error => {
  console.error('❌ Status check failed:', error);
  shutdown(1);
});
