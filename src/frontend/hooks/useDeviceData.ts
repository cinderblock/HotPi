import { useQuery } from '@tanstack/react-query';
import type { Profile } from '../../shared/profile.ts';
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

export function useProfiles() {
  return useQuery<Profile[]>({
    queryKey: ['profiles'],
    queryFn: () => Promise.reject(new Error('Query disabled - data via WebSocket')),
    initialData: [],
    staleTime: 1000 * 60 * 5,
    enabled: false,
  });
}

export interface RunnerState {
  status: 'idle' | 'running' | 'completed' | 'stopped' | 'error';
  elapsedS: number;
  targetTempC: number;
  profileTempC: number;
  overrideTempC: number | null;
  totalDurationS: number;
  error?: string;
}

export function useRunnerState() {
  return useQuery<RunnerState>({
    queryKey: ['runnerState'],
    queryFn: () => Promise.reject(new Error('Query disabled - data via WebSocket')),
    initialData: undefined,
    staleTime: 1000 * 60 * 5,
    enabled: false,
  });
}
