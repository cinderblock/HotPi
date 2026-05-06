import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { ProfilePoint } from '../../shared/profile.ts';
import { interpolateProfile } from '../../shared/profile.ts';

export interface LiveDataPoint {
  timeS: number;
  actual: number;
  set: number;
  temp0: number;
  temp1: number;
  heat: number;
  fan: number;
}

interface ReflowChartProps {
  /** Profile points to display as the target curve */
  profilePoints?: ProfilePoint[];
  /** Live data points accumulated during a run */
  liveData: LiveDataPoint[];
  /** Chart width in pixels (default: container width) */
  width?: number;
  /** Chart height in pixels */
  height?: number;
}

function buildProfileSeries(points: ProfilePoint[], maxTimeS: number): [number[], number[]] {
  if (points.length === 0) return [[], []];

  // Generate profile curve at 1-second resolution
  const endTime = Math.max(maxTimeS, points[points.length - 1].timeS);
  const times: number[] = [];
  const temps: number[] = [];

  for (let t = 0; t <= endTime; t += 1) {
    times.push(t);
    temps.push(interpolateProfile(points, t));
  }

  return [times, temps];
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

export default function ReflowChart({ profilePoints, liveData, width, height = 350 }: ReflowChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chartWidth = width ?? containerRef.current.clientWidth;

    // Determine time range
    const maxLiveTime = liveData.length > 0 ? liveData[liveData.length - 1].timeS : 0;
    const maxProfileTime = profilePoints?.length ? profilePoints[profilePoints.length - 1].timeS : 0;
    const maxTime = Math.max(maxLiveTime, maxProfileTime, 60);

    // Build profile curve
    const [profileTimes, profileTemps] = profilePoints
      ? buildProfileSeries(profilePoints, maxTime)
      : [[], []];

    // Build aligned data arrays
    // uPlot expects: [xValues, series1, series2, ...]
    // We'll use the profile time axis as the base and merge live data
    const allTimes = new Set<number>();
    for (const t of profileTimes) allTimes.add(t);
    for (const d of liveData) allTimes.add(d.timeS);

    const sortedTimes = [...allTimes].sort((a, b) => a - b);

    // Map live data by time for lookup
    const liveByTime = new Map<number, LiveDataPoint>();
    for (const d of liveData) liveByTime.set(d.timeS, d);

    // Map profile by time for lookup
    const profileByTime = new Map<number, number>();
    for (let i = 0; i < profileTimes.length; i++) {
      profileByTime.set(profileTimes[i], profileTemps[i]);
    }

    // Build uPlot data arrays
    const xData = new Float64Array(sortedTimes);
    const profileData = new Float64Array(sortedTimes.length);
    const actualData = new Float64Array(sortedTimes.length);
    const setData = new Float64Array(sortedTimes.length);

    for (let i = 0; i < sortedTimes.length; i++) {
      const t = sortedTimes[i];
      profileData[i] = profileByTime.has(t)
        ? profileByTime.get(t)!
        : profilePoints
          ? interpolateProfile(profilePoints, t)
          : NaN;

      const live = liveByTime.get(t);
      actualData[i] = live ? live.actual : NaN;
      setData[i] = live ? live.set : NaN;
    }

    const data: uPlot.AlignedData = [xData, profileData, actualData, setData];

    const opts: uPlot.Options = {
      width: chartWidth,
      height,
      scales: {
        x: { time: false },
        y: { range: [0, 320] },
      },
      axes: [
        {
          values: (_self, ticks) => ticks.map(formatElapsed),
          label: 'Time',
          gap: 8,
        },
        {
          label: 'Temperature (°C)',
          gap: 8,
        },
      ],
      series: [
        { label: 'Time' },
        {
          label: 'Profile',
          stroke: 'rgba(100, 149, 237, 0.7)',
          width: 2,
          dash: [6, 3],
          fill: 'rgba(100, 149, 237, 0.05)',
        },
        {
          label: 'Actual',
          stroke: '#ff6b35',
          width: 2.5,
        },
        {
          label: 'Setpoint',
          stroke: 'rgba(76, 175, 80, 0.6)',
          width: 1.5,
          dash: [4, 4],
        },
      ],
      cursor: {
        drag: { x: false, y: false },
      },
      legend: {
        show: true,
      },
    };

    // Destroy previous chart
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    chartRef.current = new uPlot(opts, data, containerRef.current);

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [profilePoints, liveData, width, height]);

  return <div ref={containerRef} className="reflow-chart" />;
}
