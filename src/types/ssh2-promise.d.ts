/**
 * Type declarations for ssh2-promise that override the default any types
 * with proper types from @types/ssh2
 */

declare module 'ssh2-promise' {
  import type { EventEmitter } from 'node:events';
  import type { Server } from 'node:net';
  import type {
    Attributes,
    ClientChannel,
    ConnectConfig,
    ExecOptions,
    InputAttributes,
    ReadStream,
    ReadStreamOptions,
    SFTPWrapper,
    Stats,
    WriteStream,
    WriteStreamOptions,
  } from 'ssh2';
  import type { PathLike } from 'node:fs';
  import type { X11Details } from 'ssh2';

  /**
   * SSH Configuration extending ssh2's ConnectConfig with ssh2-promise specific options
   */
  interface SSHConfig extends ConnectConfig {
    /** Optional Unique ID attached to ssh connection. */
    uniqueId?: string;
    /** Automatic retry to connect, after disconnect. Default true */
    reconnect?: boolean;
    /** Number of reconnect retry, after disconnect. Default 10 */
    reconnectTries?: number;
    /** Delay after which reconnect should be done. Default 5000ms */
    reconnectDelay?: number;
    /** Path to private key */
    identity?: PathLike;
    /** To hop multiple connection using this tool. Default nc. Supported Value are nc, socat, native */
    hoppingTool?: string;
    /** x11 details can srcIP or srcPort, or unix socket string */
    x11?: string | X11Details;
  }

  /**
   * Tunnel configuration for port forwarding
   */
  interface TunnelConfig {
    /** Remote Address to connect */
    remoteAddr?: string;
    /** Local port to bind to. By default, it will bind to a random port, if not passed */
    localPort?: number;
    /** Remote Port to connect */
    remotePort?: number;
    socks?: boolean;
    /** Unique name */
    name?: string;
  }

  /**
   * Tunnel configuration with server instance
   */
  interface TunnelInstance extends TunnelConfig {
    server: Server;
  }

  /**
   * SSHConnection class (internal)
   */
  export class SSHConnection extends EventEmitter {
    config: SSHConfig;
    constructor(options: SSHConfig);
    connect(config?: SSHConfig): Promise<SSHConnection>;
    close(): Promise<void>;
    shell(options?: ExecOptions): Promise<ClientChannel>;
    sftp(createNew: boolean): Promise<SFTPWrapper>;
    subsys(cmd: string): Promise<ClientChannel>;
    spawn(cmd: string, params?: string[], options?: ExecOptions): Promise<ClientChannel>;
    exec(cmd: string, params?: string[], options?: ExecOptions): Promise<string>;
    forwardOut(srcIP: string, srcPort: number, destIP: string, destPort: number): Promise<ClientChannel>;
    getSocksPort(localPort: number): Promise<number>;
    x11(cmd: string): Promise<void>;
    getTunnel(name: string): TunnelInstance | undefined;
    addTunnel(tunnelConfig: TunnelConfig): Promise<TunnelInstance>;
    closeTunnel(name?: string): Promise<void>;
  }

  /**
   * Utility functions
   */
  export interface SSHUtils {
    peek<T>(arr: T[]): T | undefined;
    endSocket(socket: ClientChannel): void;
    prompt(question: string, cb: (password: string) => void): void;
    createDeferredPromise<T>(): Deferred<T>;
    getRandomPort(): number;
    randomNumber(min: number, max: number): number;
    checkStreamError(stream: ClientChannel, timeout?: number): Promise<ClientChannel>;
  }

  /**
   * Deferred promise interface
   */
  export interface Deferred<T> {
    resolve: (value: T) => void;
    reject: (reason?: Error) => void;
    promise: Promise<T>;
  }

  /**
   * SSH2Promise constants
   */
  export interface SSHConstants {
    CHANNEL: {
      SSH: string;
      TUNNEL: string;
      X11: string;
    };
    STATUS: {
      BEFORECONNECT: string;
      CONNECT: string;
      BEFOREDISCONNECT: string;
      DISCONNECT: string;
    };
    HOPPINGTOOL: {
      NETCAT: string;
      SOCAT: string;
      NATIVE: string;
    };
  }

  /**
   * Main SSH2Promise class
   */
  export default class SSH2Promise extends EventEmitter {
    config: SSHConfig[];
    disableCache: boolean;
    deregister: Array<{ close: () => Promise<void> }>;

    constructor(options: SSHConfig | SSHConfig[], disableCache?: boolean);

    // Static properties
    static SSH: typeof SSHConnection;
    static SFTP: typeof SFTP;
    static Utils: SSHUtils;
    static Constants: SSHConstants;
    static __cache: Record<string, SSHConnection>;

    /**
     * Connect SSH connection, via single or multiple hopping connection
     */
    connect(): Promise<void>;

    /**
     * Close SSH Connection
     */
    close(): Promise<Array<void>>;

    /**
     * Execute a command and return stdout/stderr as string
     * @param cmd - Command to execute
     * @param params - Command parameters
     * @param options - Exec options
     */
    exec(cmd: string, params?: string[], options?: ExecOptions): Promise<string>;

    /**
     * Spawn a command and return the channel stream
     * @param cmd - Command to execute
     * @param params - Command parameters
     * @param options - Exec options
     */
    spawn(cmd: string, params?: string[], options?: ExecOptions): Promise<ClientChannel>;

    /**
     * Get an interactive shell
     * @param options - Shell options
     */
    shell(options?: ExecOptions): Promise<ClientChannel>;

    /**
     * Get SFTP session (wrapped version with helper methods)
     * Note: This is synchronous, not a Promise
     */
    sftp(): SFTP;

    /**
     * Get raw SFTP session from ssh2
     */
    rawSFTP(): Promise<SFTPWrapper>;

    /**
     * Get a subsystem
     */
    subsys(cmd: string): Promise<ClientChannel>;

    /**
     * Get X11 forwarding
     */
    x11(cmd: string): Promise<void>;

    /**
     * Get a SOCKS port
     */
    getSocksPort(localPort?: number): Promise<number>;

    /**
     * Get existing tunnel by name
     */
    getTunnel(name: string): TunnelInstance | undefined;

    /**
     * Add new tunnel if not exist
     */
    addTunnel(tunnelConfig: TunnelConfig): Promise<TunnelInstance>;

    /**
     * Close the tunnel
     */
    closeTunnel(name?: string): Promise<void>;
  }

  /**
   * File entry from SFTP readdir
   */
  interface FileEntry {
    filename: string;
    longname: string;
    attrs: Attributes;
  }

  /**
   * SFTP wrapper class with promise-based methods
   */
  export class SFTP extends EventEmitter {
    ssh: SSH2Promise;

    constructor(ssh: SSH2Promise);

    /**
     * Create a read stream for a file
     */
    createReadStream(path: string, options?: ReadStreamOptions): Promise<ReadStream>;

    /**
     * Create a write stream for a file
     */
    createWriteStream(path: string, options?: WriteStreamOptions): Promise<WriteStream>;

    /**
     * Read a file
     */
    readFile(path: string): Promise<Buffer>;
    readFile(path: string, encoding: BufferEncoding): Promise<string>;

    /**
     * Write a file
     */
    writeFile(
      path: string,
      data: string | Buffer,
      options?: { encoding?: BufferEncoding; flag?: string }
    ): Promise<void>;

    /**
     * Downloads a file at remotePath to localPath using parallel reads
     */
    fastGet(
      remotePath: string,
      localPath: string,
      options?: {
        concurrency?: number;
        chunkSize?: number;
        step?: (total: number, chunk: number, fileSize: number) => void;
      }
    ): Promise<void>;

    /**
     * Uploads a file from localPath to remotePath using parallel writes
     */
    fastPut(
      localPath: string,
      remotePath: string,
      options?: {
        concurrency?: number;
        chunkSize?: number;
        step?: (total: number, chunk: number, fileSize: number) => void;
        mode?: number | string;
      }
    ): Promise<void>;

    /**
     * Opens a file
     */
    open(filename: string, flags: string, attrs?: InputAttributes | number): Promise<Buffer>;

    /**
     * Closes the resource associated with handle
     */
    close(handle: Buffer): Promise<void>;

    /**
     * Read file data
     */
    read(
      handle: Buffer,
      buffer: Buffer,
      offset: number,
      length: number,
      position: number
    ): Promise<[number, Buffer, number]>;
    readFileData(
      handle: Buffer,
      buffer: Buffer,
      offset: number,
      length: number,
      position: number
    ): Promise<[number, Buffer, number]>;

    /**
     * Write file data
     */
    write(handle: Buffer, buffer: Buffer, offset: number, length: number, position: number): Promise<void>;
    writeFileData(handle: Buffer, buffer: Buffer, offset: number, length: number, position: number): Promise<void>;

    /**
     * Get file stats from handle
     */
    fstat(handle: Buffer): Promise<Stats>;
    getStat(handle: Buffer): Promise<Stats>;

    /**
     * Set file stats from handle
     */
    fsetstat(handle: Buffer, attrs: InputAttributes): Promise<void>;
    setStat(handle: Buffer, attrs: InputAttributes): Promise<void>;

    /**
     * Change file timestamp from handle
     */
    futimes(handle: Buffer, atime: number | Date, mtime: number | Date): Promise<void>;
    changeTimestamp(handle: Buffer, atime: number | Date, mtime: number | Date): Promise<void>;

    /**
     * Change file owner from handle
     */
    fchown(handle: Buffer, uid: number, gid: number): Promise<void>;
    changeOwner(handle: Buffer, uid: number, gid: number): Promise<void>;

    /**
     * Change file mode from handle
     */
    fchmod(handle: Buffer, mode: number | string): Promise<void>;
    changeMode(handle: Buffer, mode: number | string): Promise<void>;

    /**
     * Open a directory
     */
    opendir(path: string): Promise<Buffer>;

    /**
     * List directory contents
     */
    readdir(location: string | Buffer): Promise<FileEntry[] | false>;

    /**
     * Remove file/symlink
     */
    unlink(path: string): Promise<void>;

    /**
     * Rename/move file or directory
     */
    rename(srcPath: string, destPath: string): Promise<void>;

    /**
     * Create directory
     */
    mkdir(path: string, attrs?: InputAttributes): Promise<void>;

    /**
     * Remove directory
     */
    rmdir(path: string): Promise<void>;

    /**
     * Get file/directory stats
     */
    stat(path: string): Promise<Stats>;

    /**
     * Get file/directory stats (follows symlinks)
     */
    lstat(path: string): Promise<Stats>;

    /**
     * Set file/directory attributes
     */
    setstat(path: string, attrs: InputAttributes): Promise<void>;

    /**
     * Set file/directory times
     */
    utimes(path: string, atime: number | Date, mtime: number | Date): Promise<void>;

    /**
     * Change file/directory owner
     */
    chown(path: string, uid: number, gid: number): Promise<void>;

    /**
     * Change file/directory permissions
     */
    chmod(path: string, mode: number | string): Promise<void>;

    /**
     * Read symlink target
     */
    readlink(path: string): Promise<string>;

    /**
     * Create symlink
     */
    symlink(targetPath: string, linkPath: string): Promise<void>;

    /**
     * Resolve path to absolute path
     */
    realpath(path: string): Promise<string>;

    /**
     * OpenSSH extension: POSIX rename
     */
    ext_openssh_rename(srcPath: string, destPath: string): Promise<void>;

    /**
     * OpenSSH extension: Get filesystem stats
     */
    ext_openssh_statvfs(path: string): Promise<{
      f_bsize: number;
      f_frsize: number;
      f_blocks: number;
      f_bfree: number;
      f_bavail: number;
      f_files: number;
      f_ffree: number;
      f_favail: number;
      f_sid: number;
      f_flag: number;
      f_namemax: number;
    }>;

    /**
     * OpenSSH extension: Get filesystem stats from handle
     */
    ext_openssh_fstatvfs(handle: Buffer): Promise<{
      f_bsize: number;
      f_frsize: number;
      f_blocks: number;
      f_bfree: number;
      f_bavail: number;
      f_files: number;
      f_ffree: number;
      f_favail: number;
      f_sid: number;
      f_flag: number;
      f_namemax: number;
    }>;

    /**
     * OpenSSH extension: Create hard link
     */
    ext_openssh_hardlink(targetPath: string, linkPath: string): Promise<void>;

    /**
     * OpenSSH extension: Sync file to disk
     */
    ext_openssh_fsync(handle: Buffer): Promise<void>;
  }
}

declare module 'ssh2-promise/lib/sftp' {
  import type { SFTP } from 'ssh2-promise';
  export = SFTP;
}

declare module 'ssh2-promise/lib/sshConfig' {
  import type { ConnectConfig } from 'ssh2';
  import type { PathLike } from 'node:fs';
  import type { X11Details } from 'ssh2';

  interface SSHConfig extends ConnectConfig {
    uniqueId?: string;
    reconnect?: boolean;
    reconnectTries?: number;
    reconnectDelay?: number;
    identity?: PathLike;
    hoppingTool?: string;
    x11?: string | X11Details;
  }

  export = SSHConfig;
}

declare module 'ssh2-promise/lib/tunnelConfig' {
  interface TunnelConfig {
    remoteAddr?: string;
    localPort?: number;
    remotePort?: number;
    socks?: boolean;
    name?: string;
  }

  export = TunnelConfig;
}

declare module 'ssh2-promise/lib/sshConnection' {
  import type { SSHConnection } from 'ssh2-promise';
  export = SSHConnection;
}

declare module 'ssh2-promise/lib/sshConstants' {
  import type { SSHConstants } from 'ssh2-promise';
  const Constants: SSHConstants;
  export = Constants;
}

declare module 'ssh2-promise/lib/sshUtils' {
  import type { Deferred, SSHUtils } from 'ssh2-promise';
  export type { Deferred };
  const Utils: SSHUtils;
  export default Utils;
}
