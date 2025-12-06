import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import * as ReactUseWebSocket from 'react-use-websocket';
import type { DeviceState, SerialMessage } from '../api-client';

const useWebSocket = ReactUseWebSocket.default || ReactUseWebSocket;
const { ReadyState } = ReactUseWebSocket;

const { protocol, hostname, port } = window.location;
const WS_URL = `${protocol.replace(/^http/, 'ws')}//${hostname}:${port}/ws`;

export function useWebSocketConnection() {
  const queryClient = useQueryClient();

  const { lastMessage, readyState, sendMessage } = useWebSocket(WS_URL, {
    shouldReconnect: closeEvent => {
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
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    }
  }, [lastMessage, queryClient]);

  const sendCommand = (command: string) => {
    console.log('Sending command:', command);
    sendMessage(JSON.stringify({ type: 'command', data: { command } }));
  };

  return {
    isConnected: readyState === ReadyState.OPEN,
    isConnecting: readyState === ReadyState.CONNECTING,
    sendCommand,
  };
}
