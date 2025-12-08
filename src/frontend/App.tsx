import { useEffect, useState } from 'react';
import type { ConnectionChain, ConnectionStatus } from './api-client.ts';
import { useDeviceState, useSerialMessages } from './hooks/useDeviceData.ts';
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

function LinkIndicator({ status, label }: { status: ConnectionStatus; label: string }) {
  const now = useNow(200);
  const secondsAgo = Math.max(0, (now - status.lastActivity) / 1000);
  const isPulsing = status.connected && secondsAgo < 1.2;

  return (
    <div
      className={`link-indicator ${status.connected ? 'alive' : 'dead'} ${isPulsing ? 'pulse' : ''}`}
      title={`${label}: ${status.connected ? 'alive' : 'dead'} • last activity ${secondsAgo.toFixed(1)}s ago`}
    >
      <span className="link-line" />
    </div>
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

  const iconPath =
    kind === 'browser'
      ? 'M4 6h16v12H4z M6 8v8h12V8z M9 18h6v1H9z'
      : kind === 'backend'
        ? 'M5 6h14v4H5z M5 11h14v4H5z M5 16h14v4H5z'
        : 'M12 4c-3.3 0-6 2.7-6 6v6h12v-6c0-3.3-2.7-6-6-6zm0 3a3 3 0 0 1 3 3v1H9v-1a3 3 0 0 1 3-3zm-3 8v-2h6v2H9z';

  return (
    <div
      className={`node-icon ${status.connected ? 'alive' : 'dead'} ${isPulsing ? 'pulse' : ''}`}
      title={`${label}: ${status.connected ? 'connected' : 'disconnected'} • last activity ${secondsAgo.toFixed(1)}s ago`}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d={iconPath} />
      </svg>
    </div>
  );
}

function ConnectionChainView({ chain }: { chain: ConnectionChain }) {
  return (
    <div className="connection-chain">
      <NodeIcon kind="browser" label="Browser" status={chain.websocket} />
      <LinkIndicator label="Browser ↔ Backend (websocket)" status={chain.websocket} />
      <NodeIcon kind="backend" label="Backend" status={chain.websocket} />
      <LinkIndicator label="Backend ↔ Device (serial)" status={chain.serialPort} />
      <NodeIcon kind="device" label="Device" status={chain.device} />
    </div>
  );
}

export default function App() {
  const [timeOffset, setTimeOffset] = useState<number>(); // Server time - Client time
  const { sendCommand } = useWebSocketConnection();
  const { data: state } = useDeviceState();
  const { data: messages = [] } = useSerialMessages();

  // Calculate time offset once when we first receive state
  useEffect(() => {
    if (state && timeOffset === undefined) {
      const clientTime = Date.now();
      const offset = state.lastUpdate - clientTime;
      setTimeOffset(offset);
    }
  }, [state, timeOffset]);

  const handleStart = () => {
    sendCommand('start');
  };

  const handleStop = () => {
    sendCommand('stop');
  };

  if (!state || timeOffset === undefined) return <div>Loading...</div>;

  return (
    <div>
      <header>
        <h1>Battery Controller</h1>
        {state.connectionChain && <ConnectionChainView chain={state.connectionChain} />}
      </header>

      <main>
        <section className="controls">
          <h2>Device Controls</h2>
          <div className="control-panel">
            <button type="button" onClick={handleStart} className="btn-start">
              ▶ Start
            </button>
            <button type="button" onClick={handleStop} className="btn-stop">
              ⏹ Stop
            </button>
          </div>
        </section>

        <section className="messages">
          <div
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}
          >
            <h2 style={{ margin: 0 }}>Serial Packets (Hex)</h2>
            {Math.abs(timeOffset) > 100 && (
              <span style={{ fontSize: '0.8rem', color: '#888' }}>
                Time offset: {timeOffset > 0 ? '+' : ''}
                {(timeOffset / 1000).toFixed(2)}s
              </span>
            )}
          </div>
          <div className="message-container">
            {messages.map((msg, i) => (
              <div key={`${msg.timestamp}-${i}`} className={`message-entry ${msg.direction}`}>
                <TimestampDisplay timestamp={msg.timestamp} offset={timeOffset} />
                <span className="message-direction">{msg.direction === 'in' ? '←' : '→'}</span>
                <span className="message-content hex">{msg.content}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
