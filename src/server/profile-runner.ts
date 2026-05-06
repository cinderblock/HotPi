/**
 * Advanced mode profile runner
 *
 * Follows a reflow profile by sending `bake` commands to the T-962 at regular intervals.
 * The T-962 handles PID control for each setpoint; this module controls what the setpoint is
 * and when it changes based on the profile curve.
 *
 * Flow:
 * 1. Frontend sends profile points + "startAdvanced" command
 * 2. Server creates ProfileRunner, starts it
 * 3. Runner interpolates profile at each tick and sends `bake <targetTemp>` when target changes
 * 4. Runner monitors telemetry and emits progress events
 * 5. Runner stops when profile completes or user sends "stop"
 */

import type { ProfilePoint } from '../shared/profile.ts';
import { interpolateProfile } from '../shared/profile.ts';
import { logger } from '../utils/logger.ts';
import type { OvenTelemetry } from './serial.ts';
import type { SerialManager } from './serial.ts';

export type RunnerStatus = 'idle' | 'running' | 'completed' | 'stopped' | 'error';

export interface RunnerState {
  status: RunnerStatus;
  /** Elapsed seconds since start */
  elapsedS: number;
  /** Current target temperature (override or profile interpolation) */
  targetTempC: number;
  /** Temperature from profile interpolation at current elapsed time */
  profileTempC: number;
  /** If non-null, user has overridden the setpoint */
  overrideTempC: number | null;
  /** Profile points being followed */
  profilePoints: ProfilePoint[];
  /** Total profile duration */
  totalDurationS: number;
  /** Error message if status is 'error' */
  error?: string;
}

export type RunnerListener = (state: RunnerState) => void;

/** How often to re-evaluate the profile and potentially update the bake setpoint */
const TICK_INTERVAL_MS = 2000;

/** Minimum temperature change to trigger a new bake command (avoids serial noise) */
const TEMP_CHANGE_THRESHOLD = 1;

/** Temperature at which we consider the profile "done" (near ambient) */
const COOLDOWN_TEMP = 60;

export class ProfileRunner {
  private status: RunnerStatus = 'idle';
  private startTime = 0;
  private tickTimer: Timer | null = null;
  private lastSentTemp = -1;
  private lastTelemetry: OvenTelemetry | null = null;
  private overrideTempC: number | null = null;
  private listeners = new Set<RunnerListener>();
  private telemetryUnsub: (() => void) | null = null;

  constructor(
    private serial: SerialManager,
    private profilePoints: ProfilePoint[],
  ) {}

  get totalDurationS(): number {
    if (this.profilePoints.length === 0) return 0;
    return this.profilePoints[this.profilePoints.length - 1].timeS;
  }

  get elapsedS(): number {
    if (this.startTime === 0) return 0;
    return (Date.now() - this.startTime) / 1000;
  }

  getState(): RunnerState {
    const profileTempC = this.profilePoints.length > 0
      ? interpolateProfile(this.profilePoints, this.elapsedS)
      : 0;
    return {
      status: this.status,
      elapsedS: this.elapsedS,
      profileTempC,
      targetTempC: this.overrideTempC ?? profileTempC,
      overrideTempC: this.overrideTempC,
      profilePoints: this.profilePoints,
      totalDurationS: this.totalDurationS,
    };
  }

  async start(): Promise<void> {
    if (this.status === 'running') {
      throw new Error('Runner is already running');
    }

    if (this.profilePoints.length < 2) {
      throw new Error('Profile must have at least 2 points');
    }

    logger.info(`Starting advanced profile run: ${this.profilePoints.length} points, ${this.totalDurationS}s duration`);

    this.status = 'running';
    this.startTime = Date.now();
    this.lastSentTemp = -1;

    // Listen to telemetry for monitoring
    this.telemetryUnsub = this.serial.addTelemetryListener(t => {
      this.lastTelemetry = t;
    });

    // Send initial bake command
    await this.tick();

    // Start tick loop
    this.tickTimer = setInterval(() => {
      this.tick().catch(err => {
        logger.error('Profile runner tick error:', err);
        this.handleError(err instanceof Error ? err.message : String(err));
      });
    }, TICK_INTERVAL_MS);

    this.notifyListeners();
  }

  async stop(): Promise<void> {
    if (this.status !== 'running') return;

    logger.info('Stopping advanced profile run');
    this.cleanup();
    this.status = 'stopped';

    try {
      await this.serial.sendStop();
    } catch (err) {
      logger.error('Failed to send stop command:', err);
    }

    this.notifyListeners();
  }

  private async tick(): Promise<void> {
    if (this.status !== 'running') return;

    const elapsed = this.elapsedS;
    const profileTemp = interpolateProfile(this.profilePoints, elapsed);
    const targetTemp = this.overrideTempC ?? profileTemp;

    // Check if profile is complete (only when not overridden)
    if (this.overrideTempC === null && elapsed >= this.totalDurationS) {
      // Profile time is up — check if we should keep cooling or stop
      const finalTemp = this.profilePoints[this.profilePoints.length - 1].tempC;
      if (finalTemp <= COOLDOWN_TEMP) {
        // Profile ends at a low temp — we're done
        logger.info('Advanced profile run completed');
        this.cleanup();
        this.status = 'completed';
        await this.serial.sendStop();
        this.notifyListeners();
        return;
      }
      // Otherwise keep baking at the final temp until user stops
    }

    // Only send a new bake command if the target temperature changed meaningfully
    if (Math.abs(targetTemp - this.lastSentTemp) >= TEMP_CHANGE_THRESHOLD) {
      const roundedTemp = Math.round(targetTemp);
      const source = this.overrideTempC !== null ? 'override' : 'profile';
      logger.info(`Profile runner: ${elapsed.toFixed(0)}s → bake ${roundedTemp}°C (${source})`);
      await this.serial.startBake(roundedTemp);
      this.lastSentTemp = roundedTemp;
    }

    this.notifyListeners();
  }

  private handleError(message: string) {
    this.cleanup();
    this.status = 'error';
    this.notifyListeners();
    logger.error(`Profile runner error: ${message}`);
  }

  private cleanup() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.telemetryUnsub) {
      this.telemetryUnsub();
      this.telemetryUnsub = null;
    }
  }

  // --- Live setpoint adjustment ---

  /** Override the profile target with a manual temperature. Takes effect on next tick. */
  setOverride(tempC: number): void {
    if (this.status !== 'running') return;
    this.overrideTempC = Math.round(tempC);
    logger.info(`Profile runner: setpoint override → ${this.overrideTempC}°C`);
    // Immediately tick to apply the override
    this.tick().catch(err => {
      logger.error('Profile runner tick error after override:', err);
    });
  }

  /** Clear the manual override, resuming profile-following. */
  clearOverride(): void {
    if (this.overrideTempC === null) return;
    logger.info('Profile runner: override cleared, resuming profile');
    this.overrideTempC = null;
    // Immediately tick to resume profile
    this.tick().catch(err => {
      logger.error('Profile runner tick error after clearing override:', err);
    });
  }

  /** Whether the runner currently has a manual override active */
  get hasOverride(): boolean {
    return this.overrideTempC !== null;
  }

  // --- Listeners ---

  addListener(listener: RunnerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }
}
