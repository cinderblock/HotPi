import { useQuery } from '@tanstack/react-query';
import type { DeviceState, SerialMessage } from '../api-client.ts';

export function useDeviceState() {
  return useQuery<DeviceState>({
    queryKey: ['deviceState'],
    initialData: undefined,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useSerialMessages() {
  return useQuery<SerialMessage[]>({
    queryKey: ['serialMessages'],
    initialData: [],
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
