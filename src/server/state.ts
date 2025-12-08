/**
 * Application state management
 * Maintains synchronized state between device and application
 *
 * PROTOCOL: Unknown - state structure will be determined during reverse engineering
 */

/**
 * Connection status for each link in the chain
 */
export interface ConnectionStatus {
  connected: boolean;
  lastActivity: number;
}

/**
 * Connection chain showing status of each communication link
 */
export interface ConnectionChain {
  websocket: ConnectionStatus;
  serialPort: ConnectionStatus;
  device: ConnectionStatus;
}

/**
 * Placeholder for device-specific state properties
 * Replace with actual fields once protocol is understood
 */
export interface DeviceState {
  lastUpdate: number;
  connectionChain: ConnectionChain;

  // TODO: Add device-specific state properties based on protocol
  // Examples of possible fields (replace with actual):
  // - Numeric readings (voltage, current, temperature, etc.)
  // - Status flags (charging, discharging, fault states, etc.)
  // - Configuration values
  // - Error codes
  // [key: string]: unknown;  // Uncomment for dynamic properties
}

/**
 * Serial message with timestamp
 * Content is hex string (e.g., "05 00 00 00 00 00 00 05")
 */
export interface SerialMessage {
  timestamp: number;
  direction: 'in' | 'out';
  content: string; // Hex string
}

export class StateManager {
  private state: DeviceState;
  private listeners: Set<(state: DeviceState) => void>;
  private messageHistory: SerialMessage[] = [];
  private messageListeners: Set<(message: SerialMessage) => void> = new Set();
  private readonly MAX_MESSAGES = 1000;

  constructor() {
    const now = Date.now();
    this.state = {
      lastUpdate: now,
      connectionChain: {
        websocket: { connected: false, lastActivity: now },
        serialPort: { connected: false, lastActivity: now },
        device: { connected: false, lastActivity: now },
      },
    };
    this.listeners = new Set();
  }

  /**
   * Get current state
   */
  getState(): DeviceState {
    return { ...this.state };
  }

  /**
   * Update WebSocket connection status
   */
  updateWebSocketStatus(connected: boolean) {
    const now = Date.now();
    this.state.connectionChain.websocket.connected = connected;
    if (connected) {
      this.state.connectionChain.websocket.lastActivity = now;
    }
    this.state.lastUpdate = now;
    this.notifyListeners();
  }

  /**
   * Update serial port connection status
   */
  updateSerialPortStatus(connected: boolean) {
    const now = Date.now();
    this.state.connectionChain.serialPort.connected = connected;
    if (connected) {
      this.state.connectionChain.serialPort.lastActivity = now;
    }
    this.state.lastUpdate = now;
    this.notifyListeners();
  }

  /**
   * Update device connection status
   */
  updateDeviceStatus(connected: boolean) {
    const now = Date.now();
    this.state.connectionChain.device.connected = connected;
    if (connected) {
      this.state.connectionChain.device.lastActivity = now;
    }
    this.state.lastUpdate = now;
    this.notifyListeners();
  }

  /**
   * Record WebSocket activity
   */
  recordWebSocketActivity() {
    const now = Date.now();
    this.state.connectionChain.websocket.lastActivity = now;
    this.state.lastUpdate = now;
    this.notifyListeners();
  }

  /**
   * Record serial port activity
   */
  recordSerialPortActivity() {
    const now = Date.now();
    this.state.connectionChain.serialPort.lastActivity = now;
    this.state.lastUpdate = now;
    this.notifyListeners();
  }

  /**
   * Record device activity (packet received)
   */
  recordDeviceActivity() {
    const now = Date.now();
    this.state.connectionChain.device.lastActivity = now;
    this.state.lastUpdate = now;
    this.notifyListeners();
  }

  /**
   * Update device state from serial data
   */
  updateDeviceState(data: Partial<DeviceState>) {
    this.state = {
      ...this.state,
      ...data,
      lastUpdate: Date.now(),
    };
    this.notifyListeners();
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: DeviceState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of state change
   */
  private notifyListeners() {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  /**
   * Add a serial message to history
   */
  addMessage(direction: 'in' | 'out', content: string) {
    const message: SerialMessage = {
      timestamp: Date.now(),
      direction,
      content,
    };

    this.messageHistory.push(message);

    // Keep only the last MAX_MESSAGES
    if (this.messageHistory.length > this.MAX_MESSAGES) {
      this.messageHistory.shift();
    }

    // Notify message listeners
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }

  /**
   * Get message history
   */
  getMessageHistory(): SerialMessage[] {
    return [...this.messageHistory];
  }

  /**
   * Subscribe to new messages
   */
  subscribeToMessages(listener: (message: SerialMessage) => void) {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }
}
