/**
 * Type definitions for application state and messages
 * All communication happens via WebSocket
 */

export interface DeviceState {
  connected: boolean;
  lastUpdate: number;
}

export interface SerialMessage {
  timestamp: number;
  direction: 'in' | 'out';
  content: string;
}
