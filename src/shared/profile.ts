/**
 * Reflow profile data model
 *
 * Profiles define a temperature curve for the reflow process.
 * Two representations exist:
 *
 * 1. T962Profile — matches the T-962's native format (48 setpoints, 10s each, 480s total).
 *    Used in "Saved" mode: uploaded to the T-962, which runs it autonomously.
 *
 * 2. Profile — flexible format with arbitrary time/temp points and dynamic setpoints.
 *    Used in "Advanced" mode: the Pi drives the oven via `bake` commands.
 *    Points are linearly interpolated between, giving smooth curves.
 */

/** Number of temperature setpoints in a T-962 profile */
export const T962_PROFILE_POINTS = 48;

/** Seconds per setpoint in a T-962 profile */
export const T962_SECONDS_PER_POINT = 10;

/** Total profile duration in seconds */
export const T962_PROFILE_DURATION = T962_PROFILE_POINTS * T962_SECONDS_PER_POINT; // 480s

/** T-962 temperature limits */
export const T962_TEMP_MIN = 30;
export const T962_TEMP_MAX = 300;

/**
 * A point in a reflow profile curve.
 * The profile curve is linearly interpolated between points.
 */
export interface ProfilePoint {
  /** Time in seconds from start of profile */
  timeS: number;
  /** Target temperature in °C */
  tempC: number;
}

/**
 * A dynamic setpoint for Advanced mode.
 * Instead of just "go to X degrees at time T", this allows conditions
 * like "set target to X, wait until actual reaches Y, then hold for Z seconds".
 */
export interface DynamicSetpoint {
  /** Target temperature to set (°C) */
  targetTempC: number;
  /**
   * Wait until actual temperature reaches this threshold before starting the hold timer.
   * If undefined, the hold timer starts immediately.
   */
  waitUntilTempC?: number;
  /** Hold duration in seconds after the wait condition is met */
  holdS: number;
  /** Maximum time in seconds before moving to the next setpoint regardless of conditions */
  maxTimeS?: number;
}

/**
 * A reflow profile with arbitrary time/temperature points.
 * Used for both display (WYSIWYG editor) and Advanced mode control.
 */
export interface Profile {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Profile points defining the temperature curve */
  points: ProfilePoint[];
  /**
   * Dynamic setpoints for Advanced mode.
   * If present, these override the simple `points` curve with condition-based control.
   * If absent, Advanced mode follows the `points` curve directly.
   */
  dynamicSetpoints?: DynamicSetpoint[];
  /** User notes about this profile */
  notes?: string;
  /** When this profile was last modified */
  updatedAt?: number;
}

/**
 * T-962 native profile format: 48 temperature values, one per 10 seconds.
 */
export interface T962Profile {
  /** Profile index on the T-962 (0-6) */
  index: number;
  /** Profile name */
  name: string;
  /** 48 temperature setpoints in °C */
  temperatures: number[];
}

// --- Conversion utilities ---

/**
 * Convert a Profile (arbitrary points) to T-962 format (48 fixed-interval setpoints).
 * Linearly interpolates between profile points.
 */
export function profileToT962(profile: Profile): number[] {
  const temps: number[] = [];

  for (let i = 0; i < T962_PROFILE_POINTS; i++) {
    const timeS = i * T962_SECONDS_PER_POINT;
    const tempC = interpolateProfile(profile.points, timeS);
    temps.push(Math.round(Math.max(T962_TEMP_MIN, Math.min(T962_TEMP_MAX, tempC))));
  }

  return temps;
}

/**
 * Convert T-962 format (48 setpoints) to a Profile with points.
 */
export function t962ToProfile(t962: T962Profile): Profile {
  const points: ProfilePoint[] = [];

  // Only include points where the temperature changes (simplify the curve)
  for (let i = 0; i < t962.temperatures.length; i++) {
    const timeS = i * T962_SECONDS_PER_POINT;
    const tempC = t962.temperatures[i];

    // Always include first and last points
    if (i === 0 || i === t962.temperatures.length - 1) {
      points.push({ timeS, tempC });
      continue;
    }

    // Include points where slope changes
    const prev = t962.temperatures[i - 1];
    const next = t962.temperatures[i + 1];
    const slopeBefore = tempC - prev;
    const slopeAfter = next - tempC;

    if (Math.abs(slopeBefore - slopeAfter) > 0.5) {
      points.push({ timeS, tempC });
    }
  }

  return {
    id: `t962-${t962.index}`,
    name: t962.name,
    points,
  };
}

/**
 * Interpolate temperature at a given time from a set of profile points.
 */
export function interpolateProfile(points: ProfilePoint[], timeS: number): number {
  if (points.length === 0) return 0;
  if (points.length === 1) return points[0].tempC;

  // Before first point
  if (timeS <= points[0].timeS) return points[0].tempC;

  // After last point
  if (timeS >= points[points.length - 1].timeS) return points[points.length - 1].tempC;

  // Find the surrounding points and interpolate
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];

    if (timeS >= a.timeS && timeS <= b.timeS) {
      const t = (timeS - a.timeS) / (b.timeS - a.timeS);
      return a.tempC + t * (b.tempC - a.tempC);
    }
  }

  return points[points.length - 1].tempC;
}

// --- Built-in profile templates ---

/** Standard lead-free reflow profile (similar to AMTECH SYNTECH-LF) */
export const PROFILE_LEAD_FREE: Profile = {
  id: 'builtin-lead-free',
  name: 'Lead-Free (SAC305)',
  points: [
    { timeS: 0, tempC: 50 },
    { timeS: 90, tempC: 150 },   // Preheat ramp
    { timeS: 180, tempC: 200 },  // Soak
    { timeS: 240, tempC: 245 },  // Reflow peak
    { timeS: 270, tempC: 245 },  // Peak hold
    { timeS: 330, tempC: 100 },  // Cooling
    { timeS: 420, tempC: 50 },   // Done
  ],
};

/** Standard leaded reflow profile (similar to 63/37) */
export const PROFILE_LEADED: Profile = {
  id: 'builtin-leaded',
  name: 'Leaded (63/37)',
  points: [
    { timeS: 0, tempC: 50 },
    { timeS: 90, tempC: 150 },   // Preheat ramp
    { timeS: 180, tempC: 183 },  // Soak at liquidus
    { timeS: 210, tempC: 220 },  // Reflow peak
    { timeS: 240, tempC: 220 },  // Peak hold
    { timeS: 300, tempC: 100 },  // Cooling
    { timeS: 390, tempC: 50 },   // Done
  ],
};

export const BUILTIN_PROFILES: Profile[] = [PROFILE_LEAD_FREE, PROFILE_LEADED];
