#!/usr/bin/env bun

/**
 * HotPi — Reflow Oven Controller Server
 * Single Bun server handles both HTTP and WebSocket
 */

import type { ServerWebSocket } from 'bun';
import homepage from '../frontend/index.html';
import { logger } from '../utils/logger.ts';
import { shutdown } from '../utils/shutdown.ts';
import { SerialManager } from './serial.ts';
import { StateManager } from './state.ts';

const Port = Number(process.env.PORT) || 80;

const wsClients = new Set<ServerWebSocket>();

async function main() {
  logger.info('Starting HotPi Reflow Oven Controller...');

  let heartbeatWatchdog: Timer | null = null;

  const stateManager = new StateManager();
  const serialManager = new SerialManager();

  await serialManager.connect();

  // Track serial port connection status
  serialManager.addConnectionListener(connected => {
    stateManager.updateSerialPortStatus(connected);
    if (!connected) {
      stateManager.updateDeviceStatus(false);
    }
  });

  // Log raw serial lines for debugging
  serialManager.addLineListener(line => {
    stateManager.addLogEntry('in', line);
  });

  // Handle telemetry updates
  serialManager.addTelemetryListener(telemetry => {
    stateManager.updateTelemetry(telemetry);
  });

  // Handle firmware version detection
  serialManager.addVersionListener(version => {
    stateManager.updateFirmwareVersion(version);
  });

  stateManager.updateSerialPortStatus(serialManager.isPortOpen());

  // --- Heartbeat ---

  function resetHeartbeatWatchdog() {
    if (heartbeatWatchdog !== null) clearTimeout(heartbeatWatchdog);

    heartbeatWatchdog = setTimeout(() => {
      const msg = JSON.stringify({ type: 'heartbeat', data: { timestamp: Date.now() } });
      for (const client of wsClients) {
        try { client.send(msg); } catch {}
      }
      resetHeartbeatWatchdog();
    }, 2000);
  }

  function broadcastToClients(message: string) {
    for (const client of wsClients) {
      try { client.send(message); } catch {}
    }
    resetHeartbeatWatchdog();
  }

  // --- Server ---

  const server = Bun.serve({
    port: Port,
    development: process.env.NODE_ENV === 'development',

    error: error => {
      logger.error('Server error:', error);
    },

    websocket: {
      open(ws) {
        wsClients.add(ws);
        logger.info('WebSocket client connected');
        stateManager.updateWebSocketStatus(true);
        stateManager.recordWebSocketActivity();

        // Send initial state
        ws.send(JSON.stringify({ type: 'state', data: stateManager.getState() }));
        ws.send(JSON.stringify({ type: 'history', data: stateManager.getLogHistory() }));
        resetHeartbeatWatchdog();
      },

      close(ws) {
        wsClients.delete(ws);
        logger.info('WebSocket client disconnected');
        if (wsClients.size === 0) stateManager.updateWebSocketStatus(false);
      },

      async message(ws, message) {
        try {
          const data = JSON.parse(message as string);
          stateManager.recordWebSocketActivity();

          if (data.type === 'command') {
            const cmd = data.data?.command;
            logger.info(`Received command: ${cmd}`);

            if (cmd === 'stop') {
              await serialManager.sendStop();
              stateManager.addLogEntry('out', 'stop');
            } else if (cmd === 'reflow') {
              await serialManager.startReflow();
              stateManager.addLogEntry('out', 'reflow');
            } else if (cmd === 'selectProfile' && typeof data.data?.index === 'number') {
              await serialManager.selectProfile(data.data.index);
              stateManager.addLogEntry('out', `select profile ${data.data.index}`);
            } else if (cmd === 'listProfiles') {
              await serialManager.listProfiles();
              stateManager.addLogEntry('out', 'list profiles');
            } else if (cmd === 'listSettings') {
              await serialManager.listSettings();
              stateManager.addLogEntry('out', 'list settings');
            } else if (cmd === 'raw' && typeof data.data?.text === 'string') {
              await serialManager.sendCommand(data.data.text);
              stateManager.addLogEntry('out', data.data.text);
            }
          }
        } catch (error) {
          logger.error('Failed to process WebSocket message:', error);
        }
      },
    },

    routes: {
      '/': homepage,
    },

    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === '/ws' && server.upgrade(req)) return;
      return new Response('Not Found', { status: 404 });
    },
  });

  // Broadcast state changes
  stateManager.subscribe(state => {
    broadcastToClients(JSON.stringify({ type: 'state', data: state }));
  });

  // Broadcast serial log entries
  stateManager.subscribeToLog(entry => {
    broadcastToClients(JSON.stringify({ type: 'logEntry', data: entry }));
  });

  resetHeartbeatWatchdog();

  // Periodically check device responsiveness
  setInterval(() => {
    const isResponding = serialManager.isDeviceResponding();
    const currentState = stateManager.getState();
    if (currentState.connectionChain.device.connected !== isResponding) {
      stateManager.updateDeviceStatus(isResponding);
    }
  }, 1000);

  logger.info(`Server running at http://localhost:${Port}`);
  logger.info(`WebSocket available at ws://localhost:${Port}/ws`);

  process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    if (heartbeatWatchdog !== null) clearTimeout(heartbeatWatchdog);
    await serialManager.disconnect();
    server.stop();
    shutdown(0);
  });
}

main().catch(error => {
  logger.error('Failed to start server:', error);
  shutdown(1);
});
