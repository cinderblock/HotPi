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

export default function App() {
  const [timeOffset, setTimeOffset] = useState<number>(); // Server time - Client time
  const { isConnected, sendCommand } = useWebSocketConnection();
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
        <div className={`status ${isConnected ? 'connected' : 'disconnected'}`}>
          <span className="indicator"></span>
          <span className="text">{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </header>

      <main>
        <section className="dashboard">
          <h2>Device Status</h2>
          <div className="state-grid">
            <div className="state-item">
              <span className="label">Connection:</span>
              <span className="value">{state.connected ? 'Connected' : 'Disconnected'}</span>
            </div>
            <div className="state-item">
              <span className="label">Last Update:</span>
              <span className="value">{new Date(state.lastUpdate).toLocaleTimeString()}</span>{' '}
              <TimestampDisplay timestamp={state.lastUpdate} offset={timeOffset} /> ago
            </div>
            {/* TODO: Add more device-specific state displays */}
          </div>
        </section>

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
