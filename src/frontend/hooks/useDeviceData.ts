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

export interface Run {
  id: string;
  startedAt: number;
  endedAt: number;
  status: 'completed' | 'stopped' | 'error';
  mode: 'reflow' | 'advanced';
  profileName: string;
  data: { timeS: number; actual: number; set: number; temp0: number; temp1: number; heat: number; fan: number }[];
  peakTempC: number;
  durationS: number;
  notes?: string;
}

export function useRuns() {
  return useQuery<Run[]>({
    queryKey: ['runs'],
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
