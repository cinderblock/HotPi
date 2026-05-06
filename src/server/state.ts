/**
 * Application state management for HotPi reflow oven controller
 */

import type { OvenTelemetry } from './serial.ts';

export interface ConnectionStatus {
  connected: boolean;
  lastActivity: number;
}

export interface ConnectionChain {
  websocket: ConnectionStatus;
  serialPort: ConnectionStatus;
  device: ConnectionStatus;
}

/** Current oven state sent to the frontend */
export interface OvenState {
  lastUpdate: number;
  connectionChain: ConnectionChain;
  /** Latest telemetry reading from the oven */
  telemetry: OvenTelemetry | null;
  /** Firmware version string (e.g. "v0.5.2") */
  firmwareVersion: string | null;
  /** Current oven mode */
  mode: string | null;
}

/** A serial log entry (raw lines in/out for debugging) */
export interface SerialLogEntry {
  timestamp: number;
  direction: 'in' | 'out';
  content: string;
}

export class StateManager {
  private state: OvenState;
  private listeners = new Set<(state: OvenState) => void>();
  private logHistory: SerialLogEntry[] = [];
  private logListeners = new Set<(entry: SerialLogEntry) => void>();
  private readonly MAX_LOG_ENTRIES = 500;

  constructor() {
    const now = Date.now();
    this.state = {
      lastUpdate: now,
      connectionChain: {
        websocket: { connected: false, lastActivity: now },
        serialPort: { connected: false, lastActivity: now },
        device: { connected: false, lastActivity: now },
      },
      telemetry: null,
      firmwareVersion: null,
      mode: null,
    };
  }

  getState(): OvenState {
    return { ...this.state };
  }

  // --- Connection status updates ---

  updateWebSocketStatus(connected: boolean) {
    const now = Date.now();
    this.state.connectionChain.websocket.connected = connected;
    if (connected) this.state.connectionChain.websocket.lastActivity = now;
    this.state.lastUpdate = now;
    this.notifyListeners();
  }

  updateSerialPortStatus(connected: boolean) {
    const now = Date.now();
    this.state.connectionChain.serialPort.connected = connected;
    if (connected) this.state.connectionChain.serialPort.lastActivity = now;
    this.state.lastUpdate = now;
    this.notifyListeners();
  }

  updateDeviceStatus(connected: boolean) {
    const now = Date.now();
    this.state.connectionChain.device.connected = connected;
    if (connected) this.state.connectionChain.device.lastActivity = now;
    this.state.lastUpdate = now;
    this.notifyListeners();
  }

  recordWebSocketActivity() {
    this.state.connectionChain.websocket.lastActivity = Date.now();
    this.state.lastUpdate = Date.now();
    this.notifyListeners();
  }

  recordDeviceActivity() {
    const now = Date.now();
    this.state.connectionChain.device.lastActivity = now;
    this.state.connectionChain.device.connected = true;
    this.state.lastUpdate = now;
    this.notifyListeners();
  }

  // --- Oven-specific state updates ---

  updateTelemetry(telemetry: OvenTelemetry) {
    this.state.telemetry = telemetry;
    this.state.mode = telemetry.mode;
    this.state.lastUpdate = Date.now();
    this.recordDeviceActivity();
  }

  updateFirmwareVersion(version: string) {
    this.state.firmwareVersion = version;
    this.state.lastUpdate = Date.now();
    this.notifyListeners();
  }

  // --- Serial log ---

  addLogEntry(direction: 'in' | 'out', content: string) {
    const entry: SerialLogEntry = {
      timestamp: Date.now(),
      direction,
      content,
    };

    this.logHistory.push(entry);
    if (this.logHistory.length > this.MAX_LOG_ENTRIES) {
      this.logHistory.shift();
    }

    for (const listener of this.logListeners) listener(entry);
  }

  getLogHistory(): SerialLogEntry[] {
    return [...this.logHistory];
  }

  subscribeToLog(listener: (entry: SerialLogEntry) => void): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  // --- State subscriptions ---

  subscribe(listener: (state: OvenState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }
}
