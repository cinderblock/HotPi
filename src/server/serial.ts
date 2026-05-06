/**
 * Serial port communication manager for T-962 reflow oven
 *
 * PROTOCOL: 115200 baud 8N1, line-based text
 * - Device sends CSV telemetry lines: Time,Temp0,Temp1,Temp2,Temp3,Set,Actual,Heat,Fan,ColdJ,Mode
 * - Host sends text commands terminated with \n
 * - Lines starting with # are comments (ignored)
 * - Version line: T-962-controller open source firmware (vX.Y.Z)
 *
 * IMPLEMENTATION: Direct file I/O on Linux serial device
 * - Avoids native dependencies (no serialport package needed)
 * - Uses stty for port configuration and node:fs for read/write
 */

import { spawn } from 'node:child_process';
import type { FileHandle } from 'node:fs/promises';
import { open } from 'node:fs/promises';
import { logger } from '../utils/logger.ts';

/** Parsed telemetry update from the T-962 */
export interface OvenTelemetry {
  /** Real timestamp when this was received */
  realTime: number;
  /** Elapsed seconds in reflow cycle (from device) */
  time: number;
  /** Thermocouple 0 temperature (°C) */
  temp0: number;
  /** Thermocouple 1 temperature (°C) */
  temp1: number;
  /** Thermocouple 2 temperature (°C) */
  temp2: number;
  /** Thermocouple 3 temperature (°C) */
  temp3: number;
  /** Target/setpoint temperature (°C) */
  set: number;
  /** Actual measured temperature (°C) */
  actual: number;
  /** Heater PWM output (0-503) */
  heat: number;
  /** Fan PWM output (0-503) */
  fan: number;
  /** Cold junction temperature (°C) */
  coldJ: number;
  /** Operating mode */
  mode: string;
}

/** Regex pattern for CSV telemetry lines */
const TelemetryPattern =
  /^\s*(?<time>[^\s,]+),\s*(?<temp0>[^\s,]+),\s*(?<temp1>[^\s,]+),\s*(?<temp2>[^\s,]+),\s*(?<temp3>[^\s,]+),\s*(?<set>[^\s,]+),\s*(?<actual>[^\s,]+),\s*(?<heat>[^\s,]+),\s*(?<fan>[^\s,]+),\s*(?<coldJ>[^\s,]+),\s*(?<mode>\S+)\s*$/;

/** Regex pattern for firmware version line */
const VersionPattern = /T-962-controller open source firmware \((?<version>v\d+\.\d+\.\d+)\)/;

export class SerialManager {
  private fileHandle: FileHandle | null = null;
  private lastDataReceived = 0;
  private readonly DEVICE_TIMEOUT_MS = 5000;

  constructor(
    private portPath: string = '/dev/serial0',
    private baudRate: number = 115200,
  ) {}

  async connect() {
    logger.info(`Connecting to serial port: ${this.portPath} @ ${this.baudRate} baud`);

    try {
      await this.configurePort();
      this.fileHandle = await open(this.portPath, 'r+');
      logger.info('Serial port connected');
      for (const listener of this.connectionListeners) listener(true);

      this.doReading().catch(error => {
        logger.error('Error reading from serial port:', error);
        this.disconnect();
      });
    } catch (error) {
      logger.error('Failed to connect to serial port:', error);
      throw error;
    }
  }

  async disconnect() {
    if (!this.fileHandle) return;
    const handle = this.fileHandle;
    this.fileHandle = null;
    await handle.close();
    logger.info('Serial port disconnected');
    for (const listener of this.connectionListeners) listener(false);
  }

  // --- Connection listeners ---

  private connectionListeners = new Set<(online: boolean) => void>();

  addConnectionListener(listener: (online: boolean) => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  // --- Telemetry listeners ---

  private telemetryListeners = new Set<(telemetry: OvenTelemetry) => void>();

  addTelemetryListener(listener: (telemetry: OvenTelemetry) => void): () => void {
    this.telemetryListeners.add(listener);
    return () => this.telemetryListeners.delete(listener);
  }

  // --- Version listeners ---

  private versionListeners = new Set<(version: string) => void>();

  addVersionListener(listener: (version: string) => void): () => void {
    this.versionListeners.add(listener);
    return () => this.versionListeners.delete(listener);
  }

  // --- Raw line listeners (for debug/serial log) ---

  private lineListeners = new Set<(line: string) => void>();

  addLineListener(listener: (line: string) => void): () => void {
    this.lineListeners.add(listener);
    return () => this.lineListeners.delete(listener);
  }

  // --- Reading ---

  private readBuffer = Buffer.allocUnsafe(4096);
  private readBufferOffset = 0;
  private lineBuffer = '';

  private async doReading() {
    if (!this.fileHandle) throw new Error('Serial port not connected');

    while (this.fileHandle) {
      const { bytesRead } = await this.fileHandle.read(
        this.readBuffer,
        this.readBufferOffset,
        this.readBuffer.length - this.readBufferOffset,
      );

      if (bytesRead === 0) continue;

      this.readBufferOffset += bytesRead;
      this.processBytes();
    }
  }

  private processBytes() {
    // Convert accumulated bytes to string and append to line buffer
    const chunk = this.readBuffer.subarray(0, this.readBufferOffset).toString('utf-8');
    this.readBufferOffset = 0;
    this.lineBuffer += chunk;

    // Process complete lines (delimited by \r\n or \n)
    let newlineIndex: number;
    while ((newlineIndex = this.lineBuffer.indexOf('\n')) !== -1) {
      const line = this.lineBuffer.substring(0, newlineIndex).replace(/\r$/, '');
      this.lineBuffer = this.lineBuffer.substring(newlineIndex + 1);

      if (line.length > 0) {
        this.handleLine(line);
      }
    }
  }

  private handleLine(line: string) {
    this.lastDataReceived = Date.now();

    // Notify raw line listeners
    for (const listener of this.lineListeners) listener(line);

    // Skip comments
    if (line.startsWith('#')) return;

    // Try telemetry match
    const telemetryMatch = TelemetryPattern.exec(line);
    if (telemetryMatch?.groups) {
      const g = telemetryMatch.groups;
      const telemetry: OvenTelemetry = {
        realTime: Date.now(),
        time: Number(g.time),
        temp0: Number(g.temp0),
        temp1: Number(g.temp1),
        temp2: Number(g.temp2),
        temp3: Number(g.temp3),
        set: Number(g.set),
        actual: Number(g.actual),
        heat: Number(g.heat),
        fan: Number(g.fan),
        coldJ: Number(g.coldJ),
        mode: g.mode,
      };
      for (const listener of this.telemetryListeners) listener(telemetry);
      return;
    }

    // Try version match
    const versionMatch = VersionPattern.exec(line);
    if (versionMatch?.groups) {
      const version = versionMatch.groups.version;
      logger.info(`Firmware version: ${version}`);
      for (const listener of this.versionListeners) listener(version);
      return;
    }

    // Unrecognized line — log it
    logger.debug(`Serial: ${line}`);
  }

  // --- Commands ---

  async sendCommand(command: string): Promise<void> {
    if (!this.fileHandle) throw new Error('Serial port not connected');
    const buffer = Buffer.from(`${command}\n`, 'ascii');
    await this.fileHandle.write(buffer);
    logger.info(`Sent command: ${command}`);
  }

  async sendStop(): Promise<void> {
    await this.sendCommand('stop');
  }

  async selectProfile(index: number): Promise<void> {
    await this.sendCommand(`select profile ${index}`);
  }

  async startReflow(): Promise<void> {
    await this.sendCommand('reflow');
  }

  async sendQuiet(): Promise<void> {
    await this.sendCommand('quiet');
  }

  async listProfiles(): Promise<void> {
    await this.sendCommand('list profiles');
  }

  async listSettings(): Promise<void> {
    await this.sendCommand('list settings');
  }

  // --- Port configuration ---

  private async configurePort(): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-F', this.portPath,
        `${this.baudRate}`,
        'cs8',      // 8 data bits
        '-cstopb',  // 1 stop bit
        '-parenb',  // No parity (8N1)
        'raw',      // Raw mode
        '-echo',    // No echo
        'min', '1', // Wait for at least 1 character
        'time', '0', // No timeout
      ];

      logger.info(`Running stty ${args.join(' ')}`);
      const stty = spawn('stty', args);

      stty.on('close', code => {
        if (code === 0) {
          logger.info(`Serial port configured: ${this.baudRate} baud, 8N1`);
          resolve();
        } else {
          reject(new Error(`stty exited with code ${code}`));
        }
      });

      stty.on('error', err => {
        reject(new Error(`Failed to run stty: ${err.message}`));
      });
    });
  }

  // --- Status ---

  isPortOpen(): boolean {
    return this.fileHandle !== null;
  }

  isDeviceResponding(): boolean {
    if (this.lastDataReceived === 0) return false;
    return Date.now() - this.lastDataReceived < this.DEVICE_TIMEOUT_MS;
  }

  getLastDataTime(): number {
    return this.lastDataReceived;
  }
}
