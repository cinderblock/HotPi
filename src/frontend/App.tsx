import { useEffect, useState } from 'react';
import type { ConnectionChain, ConnectionStatus } from './api-client.ts';
import Tooltip from './components/Tooltip.tsx';
import { useOvenState, useSerialLog } from './hooks/useDeviceData.ts';
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
        <span className="value">{t.actual.toFixed(1)}°C</span>
      </div>
      <div className="telemetry-card">
        <span className="label">Setpoint</span>
        <span className="value">{t.set.toFixed(1)}°C</span>
      </div>
      <div className="telemetry-card">
        <span className="label">Mode</span>
        <span className="value mode">{t.mode}</span>
      </div>
      <div className="telemetry-card">
        <span className="label">Cold Junc.</span>
        <span className="value">{t.coldJ.toFixed(1)}°C</span>
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

export default function App() {
  const [timeOffset, setTimeOffset] = useState<number>();
  const { sendCommand } = useWebSocketConnection();
  const { data: state } = useOvenState();
  const { data: logEntries = [] } = useSerialLog();

  useEffect(() => {
    if (state && timeOffset === undefined) {
      const clientTime = Date.now();
      const offset = state.lastUpdate - clientTime;
      setTimeOffset(offset);
    }
  }, [state, timeOffset]);

  if (!state || timeOffset === undefined) return <div>Loading...</div>;

  return (
    <div>
      <header>
        <h1>HotPi - Reflow Oven Controller</h1>
        {state.connectionChain && <ConnectionChainView chain={state.connectionChain} />}
      </header>

      <main>
        <section className="telemetry">
          <h2>Oven Status</h2>
          <TelemetryDisplay state={state} />
        </section>

        <section className="controls">
          <h2>Controls</h2>
          <div className="control-panel">
            <button type="button" onClick={() => sendCommand('reflow')} className="btn-start">
              Start Reflow
            </button>
            <button type="button" onClick={() => sendCommand('stop')} className="btn-stop">
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
