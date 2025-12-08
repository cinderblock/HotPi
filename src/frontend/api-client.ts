/**
 * Type definitions for application state and messages
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

export interface DeviceState {
  lastUpdate: number;
  connectionChain: ConnectionChain;
}

export interface SerialMessage {
  timestamp: number;
  direction: 'in' | 'out';
  content: string;
}
