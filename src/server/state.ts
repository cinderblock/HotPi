/**
 * Application state management
 * Maintains synchronized state between device and application
 *
 * PROTOCOL: Unknown - state structure will be determined during reverse engineering
 */

/**
 * Placeholder for device-specific state properties
 * Replace with actual fields once protocol is understood
 */
export interface DeviceState {
  connected: boolean;
  lastUpdate: number;

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
    this.state = {
      connected: false,
      lastUpdate: Date.now(),
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
   * Update connection status
   */
  updateConnectionStatus(connected: boolean) {
    this.state.connected = connected;
    this.state.lastUpdate = Date.now();
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
