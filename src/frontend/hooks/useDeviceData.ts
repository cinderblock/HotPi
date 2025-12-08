import { useQuery } from '@tanstack/react-query';
import type { DeviceState, SerialMessage } from '../api-client.ts';

export function useDeviceState() {
  return useQuery<DeviceState>({
    queryKey: ['deviceState'],
    queryFn: () => Promise.reject(new Error('Query disabled - data via WebSocket')),
    initialData: undefined,
    staleTime: 1000 * 60 * 5, // 5 minutes
    enabled: false, // Data is updated via WebSocket setQueryData, not fetched
  });
}

export function useSerialMessages() {
  return useQuery<SerialMessage[]>({
    queryKey: ['serialMessages'],
    queryFn: () => Promise.reject(new Error('Query disabled - data via WebSocket')),
    initialData: [],
    staleTime: 1000 * 60 * 5, // 5 minutes
    enabled: false, // Data is updated via WebSocket setQueryData, not fetched
  });
}
