#!/usr/bin/env bun

/**
 * Main server entry point
 * Single Bun server handles both HTTP and WebSocket
 */

import type { ServerWebSocket } from 'bun';
import homepage from '../frontend/index.html';
import { shutdown } from '../utils/shutdown';
import { SerialManager } from './serial';
import { StateManager } from './state';

const Port = Number(process.env.PORT) || 80;

// WebSocket client tracking
const wsClients = new Set<ServerWebSocket>();

async function main() {
  console.log('🚀 Starting Battery Controller Server...');

  // Initialize state manager
  const stateManager = new StateManager();

  // Initialize serial port communication
  const serialManager = new SerialManager();
  await serialManager.connect();

  // Listen for packets from device and log them
  serialManager.addPacketListener((packet: Buffer) => {
    const hex =
      packet
        .toString('hex')
        .toUpperCase()
        .match(/.{1,2}/g)
        ?.join(' ') || '';
    console.log('📥 Received packet:', hex);

    // Add to message history
    stateManager.addMessage('in', hex);
  });

  // Create single Bun server for HTTP + WebSocket
  const server = Bun.serve({
    port: Port,

    // WebSocket handler
    websocket: {
      open(ws) {
        wsClients.add(ws);
        console.log('🔌 WebSocket client connected');

        // Send initial state
        ws.send(
          JSON.stringify({
            type: 'state',
            data: stateManager.getState(),
          })
        );

        // Send message history
        ws.send(
          JSON.stringify({
            type: 'history',
            data: stateManager.getMessageHistory(),
          })
        );
      },
      close(ws) {
        wsClients.delete(ws);
        console.log('🔌 WebSocket client disconnected');
      },
      async message(_ws, message) {
        try {
          const data = JSON.parse(message as string);
          console.log('📨 Received WebSocket message:', JSON.stringify(data, null, 2));

          if (data.type === 'command') {
            console.log('📨 Received command:', data.data.command);

            if (data.data.command === 'start') {
              await serialManager.sendConnectCommand();
              stateManager.addMessage('out', '05 00 00 00 00 00 00 CONNECT');
            } else if (data.data.command === 'stop') {
              await serialManager.sendDisconnectCommand();
              stateManager.addMessage('out', '06 00 00 00 00 00 00 DISCONNECT');
            }
          }
        } catch (error) {
          console.error('❌ Failed to process WebSocket message:', error);
        }
      },
    },

    routes: {
      '/': homepage,
      // ...other HTTP routes
    },
    fetch(req, server) {
      const url = new URL(req.url);
      // Upgrade HTTP requests to WebSocket if needed
      if (url.pathname === '/ws' && server.upgrade(req)) return;

      return new Response('Not Found', { status: 404 });
    },
  });

  // Subscribe to state changes and broadcast to all WebSocket clients
  stateManager.subscribe(state => {
    const message = JSON.stringify({
      type: 'state',
      data: state,
    });

    for (const client of wsClients) {
      try {
        client.send(message);
      } catch (error) {
        console.error('Failed to send to WebSocket client:', error);
      }
    }
  });

  // Subscribe to new serial messages and broadcast to all WebSocket clients
  stateManager.subscribeToMessages(msg => {
    const message = JSON.stringify({
      type: 'message',
      data: msg,
    });

    for (const client of wsClients) {
      try {
        client.send(message);
      } catch (error) {
        console.error('Failed to send to WebSocket client:', error);
      }
    }
  });

  console.log(`🌐 Server running at http://localhost:${Port}`);
  console.log(`📡 WebSocket available at ws://localhost:${Port}/ws`);
  console.log('✅ Server ready');

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    await serialManager.disconnect();
    server.stop();
    shutdown(0);
  });
}

main().catch(error => {
  console.error('❌ Failed to start server:', error);
  shutdown(1);
});
