import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProfilePoint } from '../../shared/profile.ts';
import { BUILTIN_PROFILES, T962_PROFILE_DURATION, T962_TEMP_MAX, interpolateProfile } from '../../shared/profile.ts';

interface ProfileEditorProps {
  points: ProfilePoint[];
  onChange: (points: ProfilePoint[]) => void;
  /** Max time in seconds for the X axis (default: auto from points or 480) */
  maxTime?: number;
  /** Max temperature for the Y axis (default: 320) */
  maxTemp?: number;
  /** Chart height in pixels */
  height?: number;
}

// Layout constants
const PADDING = { top: 24, right: 24, bottom: 44, left: 60 };
const HANDLE_RADIUS = 7;
const HANDLE_HIT_RADIUS = 14; // Larger hit area for easier grabbing
const SNAP_TIME = 5; // Snap to 5-second increments
const SNAP_TEMP = 5; // Snap to 5°C increments

function snapTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

export default function ProfileEditor({
  points,
  onChange,
  maxTime: maxTimeProp,
  maxTemp = 320,
  height = 380,
}: ProfileEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Auto-size to container width
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Compute axis bounds
  const maxPointTime = points.length > 0 ? points[points.length - 1].timeS : 0;
  const maxTime = maxTimeProp ?? Math.max(maxPointTime + 30, T962_PROFILE_DURATION);

  // Chart area dimensions
  const chartW = width - PADDING.left - PADDING.right;
  const chartH = height - PADDING.top - PADDING.bottom;

  // Coordinate transforms
  const toSvgX = useCallback((timeS: number) => PADDING.left + (timeS / maxTime) * chartW, [maxTime, chartW]);
  const toSvgY = useCallback((tempC: number) => PADDING.top + (1 - tempC / maxTemp) * chartH, [maxTemp, chartH]);
  const toDataX = useCallback((svgX: number) => ((svgX - PADDING.left) / chartW) * maxTime, [maxTime, chartW]);
  const toDataY = useCallback((svgY: number) => (1 - (svgY - PADDING.top) / chartH) * maxTemp, [maxTemp, chartH]);

  // Build SVG path for the profile curve
  const curvePath = useMemo(() => {
    if (points.length === 0) return '';
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toSvgX(p.timeS)},${toSvgY(p.tempC)}`).join(' ');
  }, [points, toSvgX, toSvgY]);

  // Build filled area path (curve down to baseline)
  const fillPath = useMemo(() => {
    if (points.length === 0) return '';
    const baseline = toSvgY(0);
    const start = `M${toSvgX(points[0].timeS)},${baseline}`;
    const curve = points.map(p => `L${toSvgX(p.timeS)},${toSvgY(p.tempC)}`).join(' ');
    const end = `L${toSvgX(points[points.length - 1].timeS)},${baseline} Z`;
    return `${start} ${curve} ${end}`;
  }, [points, toSvgX, toSvgY]);

  // Grid lines
  const timeGridLines = useMemo(() => {
    const lines: number[] = [];
    const step = maxTime <= 300 ? 30 : maxTime <= 600 ? 60 : 120;
    for (let t = step; t < maxTime; t += step) lines.push(t);
    return lines;
  }, [maxTime]);

  const tempGridLines = useMemo(() => {
    const lines: number[] = [];
    const step = 50;
    for (let t = step; t < maxTemp; t += step) lines.push(t);
    return lines;
  }, [maxTemp]);

  // --- Mouse handlers ---

  const getSvgCoords = useCallback(
    (e: React.MouseEvent | MouseEvent): { x: number; y: number } => {
      if (!svgRef.current) return { x: 0, y: 0 };
      const rect = svgRef.current.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    [],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, index: number) => {
      e.preventDefault();
      e.stopPropagation();
      setDragIndex(index);
      setSelectedIndex(index);
    },
    [],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (dragIndex === null) return;
      const { x, y } = getSvgCoords(e);
      let timeS = snapTo(toDataX(x), SNAP_TIME);
      let tempC = snapTo(toDataY(y), SNAP_TEMP);

      // Clamp to valid range
      timeS = Math.max(0, Math.min(maxTime, timeS));
      tempC = Math.max(0, Math.min(maxTemp, tempC));

      // Constrain: can't cross adjacent points in time
      const newPoints = [...points];
      if (dragIndex > 0) {
        timeS = Math.max(newPoints[dragIndex - 1].timeS + SNAP_TIME, timeS);
      }
      if (dragIndex < newPoints.length - 1) {
        timeS = Math.min(newPoints[dragIndex + 1].timeS - SNAP_TIME, timeS);
      }

      newPoints[dragIndex] = { timeS, tempC };
      onChange(newPoints);
    },
    [dragIndex, getSvgCoords, toDataX, toDataY, maxTime, maxTemp, points, onChange],
  );

  const handleMouseUp = useCallback(() => {
    setDragIndex(null);
  }, []);

  // Attach window-level mouse events during drag
  useEffect(() => {
    if (dragIndex !== null) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [dragIndex, handleMouseMove, handleMouseUp]);

  // Double-click on chart area to add a point
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const { x, y } = getSvgCoords(e);
      // Only add if within chart area
      if (x < PADDING.left || x > width - PADDING.right) return;
      if (y < PADDING.top || y > height - PADDING.bottom) return;

      let timeS = snapTo(toDataX(x), SNAP_TIME);
      let tempC = snapTo(toDataY(y), SNAP_TEMP);
      timeS = Math.max(0, Math.min(maxTime, timeS));
      tempC = Math.max(0, Math.min(maxTemp, tempC));

      // Insert in sorted order
      const newPoints = [...points];
      const insertAt = newPoints.findIndex(p => p.timeS > timeS);
      if (insertAt === -1) {
        newPoints.push({ timeS, tempC });
      } else {
        newPoints.splice(insertAt, 0, { timeS, tempC });
      }
      onChange(newPoints);
      setSelectedIndex(insertAt === -1 ? newPoints.length - 1 : insertAt);
    },
    [getSvgCoords, toDataX, toDataY, maxTime, maxTemp, points, onChange, width, height],
  );

  // Delete selected point
  const deletePoint = useCallback(
    (index: number) => {
      if (points.length <= 2) return; // Keep at least 2 points
      const newPoints = points.filter((_, i) => i !== index);
      onChange(newPoints);
      setSelectedIndex(null);
    },
    [points, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (selectedIndex !== null && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        deletePoint(selectedIndex);
      }
    },
    [selectedIndex, deletePoint],
  );

  // Right-click to delete
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, index: number) => {
      e.preventDefault();
      deletePoint(index);
    },
    [deletePoint],
  );

  return (
    <div ref={containerRef} className="profile-editor" tabIndex={0} onKeyDown={handleKeyDown}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="profile-editor-svg"
        onDoubleClick={handleDoubleClick}
      >
        {/* Grid lines */}
        {timeGridLines.map(t => (
          <line
            key={`tg-${t}`}
            x1={toSvgX(t)}
            y1={PADDING.top}
            x2={toSvgX(t)}
            y2={height - PADDING.bottom}
            className="grid-line"
          />
        ))}
        {tempGridLines.map(t => (
          <line
            key={`cg-${t}`}
            x1={PADDING.left}
            y1={toSvgY(t)}
            x2={width - PADDING.right}
            y2={toSvgY(t)}
            className="grid-line"
          />
        ))}

        {/* Axis lines */}
        <line
          x1={PADDING.left}
          y1={PADDING.top}
          x2={PADDING.left}
          y2={height - PADDING.bottom}
          className="axis-line"
        />
        <line
          x1={PADDING.left}
          y1={height - PADDING.bottom}
          x2={width - PADDING.right}
          y2={height - PADDING.bottom}
          className="axis-line"
        />

        {/* X axis labels */}
        {timeGridLines.map(t => (
          <text key={`tl-${t}`} x={toSvgX(t)} y={height - PADDING.bottom + 20} className="axis-label" textAnchor="middle">
            {formatTime(t)}
          </text>
        ))}
        <text x={PADDING.left + chartW / 2} y={height - 4} className="axis-title" textAnchor="middle">
          Time
        </text>

        {/* Y axis labels */}
        {tempGridLines.map(t => (
          <text key={`cl-${t}`} x={PADDING.left - 10} y={toSvgY(t) + 4} className="axis-label" textAnchor="end">
            {t}
          </text>
        ))}
        <text
          x={14}
          y={PADDING.top + chartH / 2}
          className="axis-title"
          textAnchor="middle"
          transform={`rotate(-90, 14, ${PADDING.top + chartH / 2})`}
        >
          Temperature ({'\u00B0'}C)
        </text>

        {/* T-962 duration marker */}
        {maxTime > T962_PROFILE_DURATION && (
          <line
            x1={toSvgX(T962_PROFILE_DURATION)}
            y1={PADDING.top}
            x2={toSvgX(T962_PROFILE_DURATION)}
            y2={height - PADDING.bottom}
            className="t962-limit-line"
          />
        )}

        {/* Fill under curve */}
        {fillPath && <path d={fillPath} className="profile-fill" />}

        {/* Profile curve */}
        {curvePath && <path d={curvePath} className="profile-curve" />}

        {/* Draggable handles */}
        {points.map((p, i) => {
          const cx = toSvgX(p.timeS);
          const cy = toSvgY(p.tempC);
          const isActive = dragIndex === i || hoveredIndex === i || selectedIndex === i;

          return (
            <g key={`handle-${i}`}>
              {/* Invisible larger hit area */}
              <circle
                cx={cx}
                cy={cy}
                r={HANDLE_HIT_RADIUS}
                fill="transparent"
                style={{ cursor: 'grab' }}
                onMouseDown={e => handleMouseDown(e, i)}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                onContextMenu={e => handleContextMenu(e, i)}
              />
              {/* Visible handle */}
              <circle
                cx={cx}
                cy={cy}
                r={isActive ? HANDLE_RADIUS + 2 : HANDLE_RADIUS}
                className={`profile-handle ${isActive ? 'active' : ''}`}
                style={{ pointerEvents: 'none' }}
              />
              {/* Label on hover/drag */}
              {isActive && (
                <text
                  x={cx}
                  y={cy - HANDLE_RADIUS - 8}
                  className="handle-label"
                  textAnchor="middle"
                >
                  {p.tempC}{'\u00B0'}C @ {formatTime(p.timeS)}
                </text>
              )}
            </g>
          );
        })}

        {/* Instructions overlay (only when no points or very few) */}
        {points.length === 0 && (
          <text
            x={PADDING.left + chartW / 2}
            y={PADDING.top + chartH / 2}
            className="editor-hint"
            textAnchor="middle"
          >
            Double-click to add points
          </text>
        )}
      </svg>

      {/* Point info bar */}
      <div className="profile-editor-info">
        <span className="editor-hint-text">
          Double-click to add points. Right-click or Delete to remove. Drag to move.
        </span>
        {selectedIndex !== null && points[selectedIndex] && (
          <span className="selected-point-info">
            Point {selectedIndex + 1}: {points[selectedIndex].tempC}{'\u00B0'}C at{' '}
            {formatTime(points[selectedIndex].timeS)}
          </span>
        )}
      </div>
    </div>
  );
}

// --- Profile selection panel (wraps editor with template/name controls) ---

export interface ProfileEditorPanelProps {
  /** Current profile points */
  points: ProfilePoint[];
  /** Called when points change */
  onPointsChange: (points: ProfilePoint[]) => void;
  /** Current profile name */
  profileName: string;
  /** Called when name changes */
  onNameChange: (name: string) => void;
}

export function ProfileEditorPanel({ points, onPointsChange, profileName, onNameChange }: ProfileEditorPanelProps) {
  const loadTemplate = (id: string) => {
    const profile = BUILTIN_PROFILES.find(p => p.id === id);
    if (profile) {
      onPointsChange([...profile.points]);
      onNameChange(profile.name);
    }
  };

  return (
    <div className="profile-editor-panel">
      <div className="profile-editor-controls">
        <div className="profile-name-group">
          <label htmlFor="profile-name">Profile Name</label>
          <input
            id="profile-name"
            type="text"
            value={profileName}
            onChange={e => onNameChange(e.target.value)}
            placeholder="My Profile"
          />
        </div>
        <div className="profile-template-group">
          <label htmlFor="profile-template">Load Template</label>
          <select
            id="profile-template"
            onChange={e => {
              if (e.target.value) loadTemplate(e.target.value);
              e.target.value = '';
            }}
            defaultValue=""
          >
            <option value="" disabled>
              Choose template...
            </option>
            {BUILTIN_PROFILES.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="profile-points-summary">
          {points.length} points
          {points.length >= 2 && (
            <>
              {' \u2022 '}
              {formatTime(points[points.length - 1].timeS)} total
              {' \u2022 '}
              Peak {Math.max(...points.map(p => p.tempC))}{'\u00B0'}C
            </>
          )}
        </div>
      </div>

      <ProfileEditor points={points} onChange={onPointsChange} />

      {/* Points table */}
      <div className="profile-points-table">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Time</th>
              <th>Temp ({'\u00B0'}C)</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{formatTime(p.timeS)}</td>
                <td>{p.tempC}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
