import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import * as ReactUseWebSocketModule from 'react-use-websocket';
import type { DeviceState, SerialMessage } from '../api-client';
import { logger } from '../logger.ts';

// const useWebSocket = ReactUseWebSocket.default || ReactUseWebSocket;
// const { ReadyState } = ReactUseWebSocket;

// if (!useWebSocket || typeof useWebSocket !== 'function') {
//   console.log(`useWebSocket: ${useWebSocket}`);
//   if (typeof useWebSocket === 'object') {
//     console.log(`useWebSocket is an object: ${JSON.stringify(useWebSocket)}`);
//     console.log(`useWebSocket keys: ${Object.keys(useWebSocket).join(', ')}`);
//   }

//   console.log(`ReactUseWebSocket: ${ReactUseWebSocket}`);
//   if (typeof ReactUseWebSocket === 'object') {
//     console.log(`ReactUseWebSocket is an object: ${JSON.stringify(ReactUseWebSocket)}`);
//     console.log(`ReactUseWebSocket keys: ${Object.keys(ReactUseWebSocket).join(', ')}`);
//   }

//   throw new Error('useWebSocket not found');
// }

// WORKAROUND: Bun's runtime transformation double-wraps CommonJS default exports
// when serving TypeScript files directly. The package exports `useWebSocket as default`
// but Bun transforms it to: { default: { default: useWebSocket } }
//
// Structure:
// - ReactUseWebSocketModule.default = { default: useWebSocket, ... }
// - ReactUseWebSocketModule.default.default = useWebSocket (the actual function)
//
// This is a known issue with Bun's runtime transformation of CommonJS modules
// when serving TypeScript files directly (not bundled).
type WebSocketHook = (
  url: string | (() => string | Promise<string>) | null,
  options?: {
    shouldReconnect?: (closeEvent: CloseEvent) => boolean;
    reconnectAttempts?: number;
    reconnectInterval?: number;
  },
  connect?: boolean
) => {
  lastMessage: MessageEvent | null;
  readyState: number;
  sendMessage: (message: string) => void;
};

// Access the double-wrapped default export
const moduleDefault = ReactUseWebSocketModule.default;
const defaultObj =
  moduleDefault && typeof moduleDefault === 'object' ? (moduleDefault as Record<string, unknown>) : undefined;
const useWebSocket = defaultObj?.default
  ? (defaultObj.default as unknown as WebSocketHook)
  : (moduleDefault as unknown as WebSocketHook);

if (!useWebSocket || typeof useWebSocket !== 'function') {
  throw new Error(
    `useWebSocket not found. Module structure: ${JSON.stringify({
      hasDefault: !!ReactUseWebSocketModule.default,
      defaultType: typeof ReactUseWebSocketModule.default,
      defaultKeys: ReactUseWebSocketModule.default ? Object.keys(ReactUseWebSocketModule.default) : [],
      hasDefaultDefault: !!defaultObj?.default,
      defaultDefaultType: typeof defaultObj?.default,
    })}`
  );
}

const { ReadyState } = ReactUseWebSocketModule;

const { protocol, hostname, port } = window.location;
const WS_URL = `${protocol.replace(/^http/, 'ws')}//${hostname}:${port}/ws`;

export function useWebSocketConnection() {
  const queryClient = useQueryClient();

  const { lastMessage, readyState, sendMessage } = useWebSocket(WS_URL, {
    shouldReconnect: (closeEvent: CloseEvent) => {
      // Reconnect unless it's a manual close or server error
      return closeEvent.code !== 1000 && closeEvent.code !== 1001;
    },
    reconnectAttempts: 5,
    reconnectInterval: 2000,
  });

  // Handle incoming WebSocket messages
  useEffect(() => {
    if (lastMessage !== null) {
      try {
        const message = JSON.parse(lastMessage.data);

        if (message.type === 'state') {
          // Update device state query
          queryClient.setQueryData(['deviceState'], message.data as DeviceState);
        } else if (message.type === 'message') {
          // Add new serial message to the list
          queryClient.setQueryData(['serialMessages'], (oldData: SerialMessage[] = []) => [
            ...oldData,
            message.data as SerialMessage,
          ]);
        } else if (message.type === 'history') {
          // Replace all messages with history
          queryClient.setQueryData(['serialMessages'], message.data as SerialMessage[]);
        } else if (message.type === 'heartbeat') {
          // Heartbeat message - connection is alive
          const heartbeatTs =
            message?.data && typeof message.data.timestamp === 'number' ? message.data.timestamp : Date.now();

          queryClient.setQueryData<DeviceState | undefined>(['deviceState'], current => {
            if (!current) return current;
            return {
              ...current,
              lastUpdate: heartbeatTs,
              connectionChain: {
                ...current.connectionChain,
                websocket: {
                  connected: true,
                  lastActivity: heartbeatTs,
                },
              },
            };
          });

          // logger.info('Heartbeat received', message.data);
        }
      } catch (error) {
        logger.error('Failed to parse WebSocket message:', error);
      }
    }
  }, [lastMessage, queryClient]);

  const sendCommand = (command: string) => {
    logger.info('Sending command:', command);
    sendMessage(JSON.stringify({ type: 'command', data: { command } }));
  };

  return {
    isConnected: readyState === ReadyState.OPEN,
    isConnecting: readyState === ReadyState.CONNECTING,
    sendCommand,
    lastMessageTime: lastMessage?.timeStamp,
  };
}
