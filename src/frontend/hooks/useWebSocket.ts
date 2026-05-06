import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import * as ReactUseWebSocketModule from 'react-use-websocket';
import type { OvenState, SerialLogEntry } from '../api-client';
import { logger } from '../logger.ts';

// WORKAROUND: Bun's runtime transformation double-wraps CommonJS default exports
type WebSocketHook = (
  url: string | (() => string | Promise<string>) | null,
  options?: {
    shouldReconnect?: (closeEvent: CloseEvent) => boolean;
    reconnectAttempts?: number;
    reconnectInterval?: number;
  },
  connect?: boolean,
) => {
  lastMessage: MessageEvent | null;
  readyState: number;
  sendMessage: (message: string) => void;
};

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
    })}`,
  );
}

const { ReadyState } = ReactUseWebSocketModule;

const { protocol, hostname, port } = window.location;
const WS_URL = `${protocol.replace(/^http/, 'ws')}//${hostname}:${port}/ws`;

export function useWebSocketConnection() {
  const queryClient = useQueryClient();

  const { lastMessage, readyState, sendMessage } = useWebSocket(WS_URL, {
    shouldReconnect: (closeEvent: CloseEvent) => {
      return closeEvent.code !== 1000 && closeEvent.code !== 1001;
    },
    reconnectAttempts: 5,
    reconnectInterval: 2000,
  });

  useEffect(() => {
    if (lastMessage !== null) {
      try {
        const message = JSON.parse(lastMessage.data);

        if (message.type === 'state') {
          queryClient.setQueryData(['ovenState'], message.data as OvenState);
        } else if (message.type === 'logEntry') {
          queryClient.setQueryData(['serialLog'], (oldData: SerialLogEntry[] = []) => [
            ...oldData,
            message.data as SerialLogEntry,
          ]);
        } else if (message.type === 'history') {
          queryClient.setQueryData(['serialLog'], message.data as SerialLogEntry[]);
        } else if (message.type === 'runnerState') {
          queryClient.setQueryData(['runnerState'], message.data);
        } else if (message.type === 'profiles') {
          queryClient.setQueryData(['profiles'], message.data);
        } else if (message.type === 'profileSaved') {
          queryClient.setQueryData(['lastSavedProfile'], message.data);
        } else if (message.type === 'heartbeat') {
          const heartbeatTs =
            message?.data && typeof message.data.timestamp === 'number' ? message.data.timestamp : Date.now();

          queryClient.setQueryData<OvenState | undefined>(['ovenState'], current => {
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
        }
      } catch (error) {
        logger.error('Failed to parse WebSocket message:', error);
      }
    }
  }, [lastMessage, queryClient]);

  const sendCommand = (command: string, data?: Record<string, unknown>) => {
    logger.info('Sending command:', command);
    sendMessage(JSON.stringify({ type: 'command', data: { command, ...data } }));
  };

  return {
    isConnected: readyState === ReadyState.OPEN,
    isConnecting: readyState === ReadyState.CONNECTING,
    sendCommand,
    lastMessageTime: lastMessage?.timeStamp,
  };
}
