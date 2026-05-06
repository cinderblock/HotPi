import { useQuery } from '@tanstack/react-query';
import type { OvenState, SerialLogEntry } from '../api-client.ts';

export function useOvenState() {
  return useQuery<OvenState>({
    queryKey: ['ovenState'],
    queryFn: () => Promise.reject(new Error('Query disabled - data via WebSocket')),
    initialData: undefined,
    staleTime: 1000 * 60 * 5,
    enabled: false,
  });
}

export function useSerialLog() {
  return useQuery<SerialLogEntry[]>({
    queryKey: ['serialLog'],
    queryFn: () => Promise.reject(new Error('Query disabled - data via WebSocket')),
    initialData: [],
    staleTime: 1000 * 60 * 5,
    enabled: false,
  });
}
