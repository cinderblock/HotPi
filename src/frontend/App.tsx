import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProfilePoint } from '../shared/profile.ts';
import { PROFILE_LEAD_FREE } from '../shared/profile.ts';
import type { ConnectionChain, ConnectionStatus } from './api-client.ts';
import { ProfileEditorPanel } from './components/ProfileEditor.tsx';
import ReflowChart, { type LiveDataPoint } from './components/ReflowChart.tsx';
import Tooltip from './components/Tooltip.tsx';
import { type RunnerState, useOvenState, useProfiles, useRunnerState, useSerialLog } from './hooks/useDeviceData.ts';
import { useWebSocketConnection } from './hooks/useWebSocket.ts';

function useNow(interval = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const int = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(int);
  }, [interval]);
  return now;
}

function prettySeconds(seconds: number) {
  if (seconds < 60) return `${seconds.toFixed(0)} s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(0)} m`;
  return `${(seconds / 3600).toFixed(0)} h`;
}

function TimestampDisplay({ timestamp, offset }: { timestamp: number; offset?: number }) {
  offset ??= 0;
  const now = useNow(200);
  const delta = now - timestamp - offset;
  const abs = Math.abs(delta) / 1000;
  const pos = delta > 0;

  return (
    <span className="time">
      {pos ? null : '-'}
      {prettySeconds(abs)}
    </span>
  );
}

function TooltipContent({ label, status, secondsAgo }: { label: string; status: string; secondsAgo: number }) {
  return (
    <>
      {label}: {status}
      <br />
      last activity {secondsAgo.toFixed(1)}s ago
    </>
  );
}

function LinkIndicator({ status, label }: { status: ConnectionStatus; label: string }) {
  const now = useNow(200);
  const secondsAgo = Math.max(0, (now - status.lastActivity) / 1000);
  const isPulsing = status.connected && secondsAgo < 1.2;
  const content = <TooltipContent label={label} status={status.connected ? 'alive' : 'dead'} secondsAgo={secondsAgo} />;

  return (
    <Tooltip content={content} placement="bottom">
      <div className={`link-indicator ${status.connected ? 'alive' : 'dead'} ${isPulsing ? 'pulse' : ''}`}>
        <span className="link-line" />
      </div>
    </Tooltip>
  );
}

function NodeIcon({
  kind,
  status,
  label,
}: {
  kind: 'browser' | 'backend' | 'device';
  status: ConnectionStatus;
  label: string;
}) {
  const now = useNow(200);
  const secondsAgo = Math.max(0, (now - status.lastActivity) / 1000);
  const isPulsing = status.connected && secondsAgo < 1.2;
  const content = (
    <TooltipContent label={label} status={status.connected ? 'connected' : 'disconnected'} secondsAgo={secondsAgo} />
  );

  const iconPath =
    kind === 'browser'
      ? 'M4 6h16v12H4z M6 8v8h12V8z M9 18h6v1H9z'
      : kind === 'backend'
        ? 'M5 6h14v4H5z M5 11h14v4H5z M5 16h14v4H5z'
        : // Oven icon
          'M4 4h16v16H4z M6 6h12v4H6z M8 12h2v2H8z M14 12h2v2h-2z';

  return (
    <Tooltip content={content} placement="bottom">
      <div className={`node-icon ${status.connected ? 'alive' : 'dead'} ${isPulsing ? 'pulse' : ''}`}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d={iconPath} />
        </svg>
      </div>
    </Tooltip>
  );
}

function ConnectionChainView({ chain }: { chain: ConnectionChain }) {
  return (
    <div className="connection-chain">
      <NodeIcon kind="browser" label="Browser" status={chain.websocket} />
      <LinkIndicator label="Browser - Pi (websocket)" status={chain.websocket} />
      <NodeIcon kind="backend" label="HotPi" status={chain.websocket} />
      <LinkIndicator label="Pi - Oven (serial)" status={chain.serialPort} />
      <NodeIcon kind="device" label="T-962" status={chain.device} />
    </div>
  );
}

function TelemetryDisplay({ state }: { state: NonNullable<ReturnType<typeof useOvenState>['data']> }) {
  const t = state.telemetry;
  if (!t) return <p className="no-data">Waiting for telemetry...</p>;

  return (
    <div className="telemetry-grid">
      <div className="telemetry-card primary">
        <span className="label">Actual</span>
        <span className="value">{t.actual.toFixed(1)}{'\u00B0'}C</span>
      </div>
      <div className="telemetry-card">
        <span className="label">Setpoint</span>
        <span className="value">{t.set.toFixed(1)}{'\u00B0'}C</span>
      </div>
      <div className="telemetry-card">
        <span className="label">Mode</span>
        <span className="value mode">{t.mode}</span>
      </div>
      <div className="telemetry-card">
        <span className="label">Cold Junc.</span>
        <span className="value">{t.coldJ.toFixed(1)}{'\u00B0'}C</span>
      </div>
      <div className="telemetry-card small">
        <span className="label">TC0</span>
        <span className="value">{t.temp0.toFixed(1)}</span>
      </div>
      <div className="telemetry-card small">
        <span className="label">TC1</span>
        <span className="value">{t.temp1.toFixed(1)}</span>
      </div>
      <div className="telemetry-card small">
        <span className="label">TC2</span>
        <span className="value">{t.temp2.toFixed(1)}</span>
      </div>
      <div className="telemetry-card small">
        <span className="label">TC3</span>
        <span className="value">{t.temp3.toFixed(1)}</span>
      </div>
      <div className="telemetry-card">
        <span className="label">Heater</span>
        <span className="value">{t.heat}</span>
      </div>
      <div className="telemetry-card">
        <span className="label">Fan</span>
        <span className="value">{t.fan}</span>
      </div>
      {state.firmwareVersion && (
        <div className="telemetry-card">
          <span className="label">Firmware</span>
          <span className="value">{state.firmwareVersion}</span>
        </div>
      )}
    </div>
  );
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function SetpointControl({
  runnerState,
  sendCommand,
}: {
  runnerState: RunnerState;
  sendCommand: (cmd: string, data?: Record<string, unknown>) => void;
}) {
  const [inputTemp, setInputTemp] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSetOverride = () => {
    const temp = Number(inputTemp);
    if (Number.isFinite(temp) && temp >= 0 && temp <= 300) {
      sendCommand('setOverride', { temp });
    }
  };

  const handleClearOverride = () => {
    sendCommand('clearOverride');
    setInputTemp('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSetOverride();
    if (e.key === 'Escape') handleClearOverride();
  };

  const progress = runnerState.totalDurationS > 0
    ? Math.min(100, (runnerState.elapsedS / runnerState.totalDurationS) * 100)
    : 0;

  return (
    <div className="setpoint-control">
      <div className="setpoint-status">
        <div className="setpoint-progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="progress-text">
            {formatElapsed(runnerState.elapsedS)} / {formatElapsed(runnerState.totalDurationS)}
          </span>
        </div>

        <div className="setpoint-temps">
          <div className="setpoint-temp-card">
            <span className="label">Profile Target</span>
            <span className="value">{runnerState.profileTempC.toFixed(0)}{'\u00B0'}C</span>
          </div>
          <div className={`setpoint-temp-card ${runnerState.overrideTempC !== null ? 'override-active' : ''}`}>
            <span className="label">
              {runnerState.overrideTempC !== null ? 'Override' : 'Active'} Target
            </span>
            <span className="value">{runnerState.targetTempC.toFixed(0)}{'\u00B0'}C</span>
          </div>
        </div>
      </div>

      <div className="setpoint-adjust">
        <label htmlFor="override-temp">Adjust Setpoint</label>
        <div className="setpoint-input-group">
          <input
            ref={inputRef}
            id="override-temp"
            type="number"
            min="0"
            max="300"
            step="5"
            value={inputTemp}
            onChange={e => setInputTemp(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`${runnerState.targetTempC.toFixed(0)}`}
          />
          <span className="input-suffix">{'\u00B0'}C</span>
          <button type="button" className="btn-override" onClick={handleSetOverride}>
            Set
          </button>
          {runnerState.overrideTempC !== null && (
            <button type="button" className="btn-resume" onClick={handleClearOverride}>
              Resume Profile
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type AppTab = 'profile' | 'monitor';

export default function App() {
  const [timeOffset, setTimeOffset] = useState<number>();
  const { sendCommand } = useWebSocketConnection();
  const { data: state } = useOvenState();
  const { data: logEntries = [] } = useSerialLog();
  const { data: savedProfiles = [] } = useProfiles();
  const { data: runnerState } = useRunnerState();

  // Profile editor state
  const [profilePoints, setProfilePoints] = useState<ProfilePoint[]>([...PROFILE_LEAD_FREE.points]);
  const [profileName, setProfileName] = useState(PROFILE_LEAD_FREE.name);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(PROFILE_LEAD_FREE.id);

  // Tab state
  const [activeTab, setActiveTab] = useState<AppTab>('profile');

  // Live data accumulation (from telemetry)
  const [liveData, setLiveData] = useState<LiveDataPoint[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  // Track run state from telemetry mode
  useEffect(() => {
    if (!state?.telemetry) return;
    const mode = state.telemetry.mode;
    const running = mode === 'REFLOW' || mode === 'BAKE';

    if (running && !isRunning) {
      // Run just started — clear old data and switch to monitor tab
      setLiveData([]);
      setIsRunning(true);
      setActiveTab('monitor');
    } else if (!running && isRunning) {
      setIsRunning(false);
    }

    if (running) {
      setLiveData(prev => [
        ...prev,
        {
          timeS: state.telemetry!.time,
          actual: state.telemetry!.actual,
          set: state.telemetry!.set,
          temp0: state.telemetry!.temp0,
          temp1: state.telemetry!.temp1,
          heat: state.telemetry!.heat,
          fan: state.telemetry!.fan,
        },
      ]);
    }
  }, [state?.telemetry]);

  useEffect(() => {
    if (state && timeOffset === undefined) {
      const clientTime = Date.now();
      const offset = state.lastUpdate - clientTime;
      setTimeOffset(offset);
    }
  }, [state, timeOffset]);

  const handleStartReflow = useCallback(() => {
    setLiveData([]);
    sendCommand('reflow');
  }, [sendCommand]);

  const handleStartAdvanced = useCallback(() => {
    setLiveData([]);
    sendCommand('startAdvanced', { points: profilePoints });
  }, [sendCommand, profilePoints]);

  const handleStop = useCallback(() => {
    sendCommand('stop');
    sendCommand('stopAdvanced');
  }, [sendCommand]);

  const handleSaveProfile = useCallback(() => {
    sendCommand('saveProfile', {
      profile: {
        id: activeProfileId?.startsWith('builtin-') ? `user-${Date.now()}` : (activeProfileId ?? `user-${Date.now()}`),
        name: profileName,
        points: profilePoints,
      },
    });
  }, [sendCommand, activeProfileId, profileName, profilePoints]);

  const handleLoadProfile = useCallback((profileId: string) => {
    const profile = savedProfiles.find(p => p.id === profileId);
    if (profile) {
      setProfilePoints([...profile.points]);
      setProfileName(profile.name);
      setActiveProfileId(profile.id);
    }
  }, [savedProfiles]);

  const handleDeleteProfile = useCallback((profileId: string) => {
    sendCommand('deleteProfile', { id: profileId });
    if (activeProfileId === profileId) {
      setActiveProfileId(null);
    }
  }, [sendCommand, activeProfileId]);

  if (!state || timeOffset === undefined) return <div>Loading...</div>;

  return (
    <div>
      <header>
        <h1>HotPi - Reflow Oven Controller</h1>
        {state.connectionChain && <ConnectionChainView chain={state.connectionChain} />}
      </header>

      <main>
        {/* Tab navigation */}
        <nav className="tab-nav">
          <button
            type="button"
            className={`tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            Profile Editor
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'monitor' ? 'active' : ''}`}
            onClick={() => setActiveTab('monitor')}
          >
            Live Monitor
            {isRunning && <span className="tab-badge">LIVE</span>}
          </button>
        </nav>

        {/* Profile Editor Tab */}
        {activeTab === 'profile' && (
          <section className="profile-section">
            <div className="section-header">
              <h2>Reflow Profile</h2>
              <div className="profile-actions">
                {savedProfiles.length > 0 && (
                  <select
                    className="profile-select"
                    value={activeProfileId ?? ''}
                    onChange={e => handleLoadProfile(e.target.value)}
                  >
                    <option value="" disabled>Load profile...</option>
                    {savedProfiles.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                )}
                <button type="button" className="btn-save" onClick={handleSaveProfile}>
                  Save Profile
                </button>
                {activeProfileId && !activeProfileId.startsWith('builtin-') && (
                  <button
                    type="button"
                    className="btn-delete"
                    onClick={() => handleDeleteProfile(activeProfileId)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
            <ProfileEditorPanel
              points={profilePoints}
              onPointsChange={setProfilePoints}
              profileName={profileName}
              onNameChange={setProfileName}
            />
          </section>
        )}

        {/* Live Monitor Tab */}
        {activeTab === 'monitor' && (
          <section className="monitor-section">
            <h2>Live Monitor</h2>
            <ReflowChart
              profilePoints={profilePoints}
              liveData={liveData}
              height={400}
            />
            {runnerState?.status === 'running' && (
              <SetpointControl runnerState={runnerState} sendCommand={sendCommand} />
            )}
          </section>
        )}

        <section className="telemetry">
          <h2>Oven Status</h2>
          <TelemetryDisplay state={state} />
        </section>

        <section className="controls">
          <h2>Controls</h2>
          <div className="control-panel">
            <button type="button" onClick={handleStartReflow} className="btn-start" disabled={isRunning}>
              Start Reflow (Saved)
            </button>
            <button type="button" onClick={handleStartAdvanced} className="btn-start btn-advanced" disabled={isRunning}>
              Start Advanced
            </button>
            <button type="button" onClick={handleStop} className="btn-stop">
              Stop
            </button>
          </div>
        </section>

        <section className="messages">
          <div
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}
          >
            <h2 style={{ margin: 0 }}>Serial Log</h2>
            {Math.abs(timeOffset) > 100 && (
              <span style={{ fontSize: '0.8rem', color: '#888' }}>
                Time offset: {timeOffset > 0 ? '+' : ''}
                {(timeOffset / 1000).toFixed(2)}s
              </span>
            )}
          </div>
          <div className="message-container">
            {logEntries.map((entry, i) => (
              <div key={`${entry.timestamp}-${i}`} className={`message-entry ${entry.direction}`}>
                <TimestampDisplay timestamp={entry.timestamp} offset={timeOffset} />
                <span className="message-direction">{entry.direction === 'in' ? '<' : '>'}</span>
                <span className="message-content">{entry.content}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
