# Server

Backend server that handles serial communication with hardware, state management, and provides HTTP/WebSocket APIs.

## Files

- **`index.ts`** - Main server entry point. HTTP/WebSocket server setup and request routing.
- **`serial.ts`** - Serial port communication manager. Reads from and writes to hardware device.
- **`state.ts`** - Application state management. Device state, message history, and subscriber notifications.

## Data Flow

```
Hardware Device ↔ serial.ts ↔ state.ts ↔ index.ts ↔ Frontend Clients
```
