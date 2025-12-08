/**
 * Utility functions for deployment scripts
 */

import { createInterface as ReadLine } from 'node:readline';
import type { ClientChannel, ConnectConfig, FileEntryWithStats, SFTPWrapper } from 'ssh2';
import { Client } from 'ssh2';
import { logger } from '../utils/logger.ts';

export interface SSHConfig {
  host: string;
  user: string;
  port?: number;
  keyPath?: string;
}

let sshConnection: Client | null = null;
let connectingPromise: Promise<Client> | null = null;

/**
 * Get or create SSH connection
 */
function getSSHConnection(config: SSHConfig): Promise<Client> | Client {
  if (sshConnection) {
    return sshConnection;
  }

  if (connectingPromise) {
    return connectingPromise;
  }

  const sshConfig: ConnectConfig = {
    host: config.host,
    username: config.user,
    port: config.port || 22,
    agent: '\\\\.\\pipe\\openssh-ssh-agent',
    readyTimeout: 15000,
  };

  if (config.keyPath) {
    throw new Error('Private key path is not yet supported');
    // sshConfig.privateKey = await Bun.file(config.keyPath).text();
  }

  connectingPromise = new Promise<Client>((resolve, reject) => {
    const client = new Client();

    const resetState = () => {
      sshConnection = null;
      connectingPromise = null;
    };

    client
      .on('ready', () => {
        sshConnection = client;
        connectingPromise = null;
        client.once('close', resetState);
        client.once('error', resetState);
        resolve(client);
      })
      .on('error', (error: Error) => {
        connectingPromise = null;
        reject(error);
      })
      .connect(sshConfig);
  });

  return connectingPromise;
}

/**
 * Close SSH connection
 */
export async function closeSSHConnection(): Promise<void> {
  if (sshConnection) {
    try {
      sshConnection.end();
    } catch {}
    sshConnection = null;
  }
}

let sftp: Promise<SFTPWrapper> | null = null;
let sftpLock: Promise<unknown> | null = null;

async function doSFTP<T>(
  config: SSHConfig,
  atomic: (sftp: SFTPWrapper) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const client = await getSSHConnection(config);

  sftp ||= new Promise((resolve, reject) => client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp))));

  const s = await sftp;

  // while (sftpLock) await sftpLock;

  signal?.throwIfAborted();

  const result = atomic(s);

  sftpLock = result.then(() => {
    sftpLock = null;
  });

  return result;
}

export async function readdir(config: SSHConfig, path: string, signal?: AbortSignal): Promise<FileEntryWithStats[]> {
  return await doSFTP(
    config,
    sftp => {
      signal?.throwIfAborted();
      return new Promise((resolve, reject) => sftp.readdir(path, (err, files) => (err ? reject(err) : resolve(files))));
    },
    signal
  );
}

export async function unlink(config: SSHConfig, file: string, signal?: AbortSignal): Promise<void> {
  return await doSFTP(
    config,
    sftp => {
      signal?.throwIfAborted();
      logger.debug(`📤 Removing file ${file}`);
      return new Promise((resolve, reject) => sftp.unlink(file, err => (err ? reject(err) : resolve())));
    },
    signal
  );
}

/**
 * Execute command over SSH
 */
export async function sshExec(
  config: SSHConfig,
  command: string,
  params: string[] = [],
  signal?: AbortSignal,
  streamToTerminal = false
): Promise<string> {
  signal?.throwIfAborted();

  const cmd = [command, ...params].join(' ');
  logger.debug(`📤 Executing command ${cmd} on remote...`);

  const execOnce = async (): Promise<string> => {
    const conn = await getSSHConnection(config);

    return new Promise<string>((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      conn.exec(cmd, (err, channel) => {
        if (err) return reject(err);

        const ch = channel as ClientChannel;

        if (streamToTerminal) {
          ReadLine({ input: ch, crlfDelay: Infinity }).on('line', (line: string) => {
            console.log(line);
          });
          ReadLine({ input: ch.stderr, crlfDelay: Infinity }).on('line', (line: string) => {
            console.error(line);
          });
        } else {
          ch.on('data', (data: Buffer | string) => {
            stdout += data.toString();
          });
          ch.stderr.on('data', (data: Buffer | string) => {
            stderr += data.toString();
          });
        }

        const onAbort = () => {
          try {
            ch.close();
          } catch {}
          reject(new Error('SSH command aborted'));
        };
        if (signal) {
          if (signal.aborted) return onAbort();
          signal.addEventListener('abort', onAbort, { once: true });
        }

        ch.on('close', (code: number) => {
          if (signal) signal.removeEventListener('abort', onAbort);
          if (code === 0) resolve(stdout);
          else reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
        });

        ch.on('error', (error: Error) => {
          if (signal) signal.removeEventListener('abort', onAbort);
          reject(error);
        });
      });
    });
  };

  try {
    return await execOnce();
  } catch (_error) {
    sshConnection = null;
    return await execOnce();
  }
}

export async function getTempFile(config: SSHConfig): Promise<string> {
  return await sshExec(config, 'mktemp', ['-t', 'ssh2-promise-XXXXXX']);
}

/**
 * Write file content to remote host via SFTP
 */
export async function writeRemoteFile(
  config: SSHConfig,
  content: string | Uint8Array,
  remotePath: string,
  useSudoMv = false,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();

  const putOnce = async (): Promise<void> => {
    const conn = await getSSHConnection(config);

    const sftp: SFTPWrapper = await new Promise((resolve, reject) => {
      conn.sftp((err, s) => (err ? reject(err) : resolve(s)));
    });

    const readFile = useSudoMv ? await getTempFile(config) : remotePath;

    await new Promise<void>((resolve, reject) => {
      const writeStream = sftp.createWriteStream(readFile);

      const onAbort = () => {
        try {
          writeStream.destroy();
        } catch {}
        reject(new Error('File write aborted'));
      };

      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
      }

      writeStream.on('error', (error: Error) => {
        if (signal) signal.removeEventListener('abort', onAbort);
        reject(error);
      });
      writeStream.on('close', () => {
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      });

      if (typeof content === 'string') {
        writeStream.write(content, 'utf-8');
      } else {
        writeStream.write(content);
      }
      writeStream.end();
    });

    if (useSudoMv) await sshExec(config, 'sudo mv', [readFile, remotePath]);
  };

  try {
    logger.debug(`📝 Writing file ${remotePath}`);
    await putOnce();
    logger.debug(`✅ File ${remotePath} written`);
  } catch (_error) {
    console.log(`Error writing file ${remotePath}: ${_error}`, '❌');
    sshConnection = null;
    await putOnce();
  }
}

/**
 * Check if SSH connection is working
 */
export async function checkSSHConnection(config: SSHConfig): Promise<boolean> {
  try {
    await sshExec(config, 'echo', ['Connection successful']);
    return true;
  } catch (_error) {
    logger.error('SSH connection failed');
    logger.error(_error);
    return false;
  }
}
