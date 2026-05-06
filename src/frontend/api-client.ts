/**
 * Type definitions for HotPi application state
 * All communication happens via WebSocket
 */

export interface ConnectionStatus {
  connected: boolean;
  lastActivity: number;
}

export interface ConnectionChain {
  websocket: ConnectionStatus;
  serialPort: ConnectionStatus;
  device: ConnectionStatus;
}

export interface OvenTelemetry {
  realTime: number;
  time: number;
  temp0: number;
  temp1: number;
  temp2: number;
  temp3: number;
  set: number;
  actual: number;
  heat: number;
  fan: number;
  coldJ: number;
  mode: string;
}

export interface OvenState {
  lastUpdate: number;
  connectionChain: ConnectionChain;
  telemetry: OvenTelemetry | null;
  firmwareVersion: string | null;
  mode: string | null;
}

export interface SerialLogEntry {
  timestamp: number;
  direction: 'in' | 'out';
  content: string;
}
