/**
 * Run history — persists recent reflow/bake runs as JSON on disk.
 *
 * Each run captures the profile used, live data points, timing, and optional user notes.
 * Only the most recent N runs are kept (no deep historical archive).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProfilePoint } from '../shared/profile.ts';
import { logger } from '../utils/logger.ts';

/** A single data point recorded during a run */
export interface RunDataPoint {
  timeS: number;
  actual: number;
  set: number;
  temp0: number;
  temp1: number;
  heat: number;
  fan: number;
}

export interface Run {
  /** Unique identifier */
  id: string;
  /** When the run started (epoch ms) */
  startedAt: number;
  /** When the run ended (epoch ms) */
  endedAt: number;
  /** How it ended */
  status: 'completed' | 'stopped' | 'error';
  /** Which mode was used */
  mode: 'reflow' | 'advanced';
  /** Profile name that was active */
  profileName: string;
  /** Profile points used */
  profilePoints: ProfilePoint[];
  /** Recorded telemetry data points */
  data: RunDataPoint[];
  /** Peak actual temperature reached */
  peakTempC: number;
  /** Total duration in seconds */
  durationS: number;
  /** Optional user notes added after the run */
  notes?: string;
}

const RUNS_FILE = join(import.meta.dir, '..', '..', 'runs.json');
const MAX_RUNS = 20;

let runs: Run[] = [];

/** Load runs from disk */
export function loadRuns(): Run[] {
  try {
    if (existsSync(RUNS_FILE)) {
      const raw = readFileSync(RUNS_FILE, 'utf-8');
      runs = JSON.parse(raw) as Run[];
      logger.info(`Loaded ${runs.length} run(s) from ${RUNS_FILE}`);
    }
  } catch (err) {
    logger.error('Failed to load runs:', err);
    runs = [];
  }
  return runs;
}

/** Save runs to disk */
function saveRuns(): void {
  try {
    writeFileSync(RUNS_FILE, JSON.stringify(runs, null, 2), 'utf-8');
  } catch (err) {
    logger.error('Failed to save runs:', err);
  }
}

/** Get all runs (most recent first) */
export function getAllRuns(): Run[] {
  return [...runs];
}

/** Get a single run by ID */
export function getRun(id: string): Run | undefined {
  return runs.find(r => r.id === id);
}

/** Record a completed run */
export function addRun(run: Run): void {
  runs.unshift(run); // newest first
  if (runs.length > MAX_RUNS) {
    runs = runs.slice(0, MAX_RUNS);
  }
  saveRuns();
  logger.info(`Saved run ${run.id}: ${run.mode} ${run.status}, ${run.durationS.toFixed(0)}s, peak ${run.peakTempC.toFixed(0)}°C`);
}

/** Update notes on an existing run */
export function updateRunNotes(id: string, notes: string): boolean {
  const run = runs.find(r => r.id === id);
  if (!run) return false;
  run.notes = notes;
  saveRuns();
  return true;
}

/** Delete a run by ID */
export function deleteRun(id: string): boolean {
  const index = runs.findIndex(r => r.id === id);
  if (index < 0) return false;
  runs.splice(index, 1);
  saveRuns();
  return true;
}
