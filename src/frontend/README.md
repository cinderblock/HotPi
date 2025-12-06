# Frontend

Web-based user interface. Provides real-time monitoring and control via WebSocket.

## Files

- **`index.html`** - HTML shell and entry point
- **`index.tsx`** - React application entry point
- **`App.tsx`** - Main React component and UI logic
- **`websocket-client.ts`** - WebSocket client for real-time server communication
- **`api-client.ts`** - HTTP API client for REST endpoints
- **`styles/main.css`** - Application styles

## Notes

Frontend is bundled with the server during build. Communicates via WebSocket at `/ws` for real-time state updates and command sending.
