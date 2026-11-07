# HotPi - Reflow Oven Controller

A real-time reflow oven controller for the T-962, with a web-based GUI for WYSIWYG profile editing, temperature charting, and firmware flashing. Runs on a Raspberry Pi connected to the T-962 via serial.

Forked from [battery-controller](https://github.com/cinderblock/battery-controller) (shared git history).

## Features

- Real-time temperature monitoring and charting (4 thermocouples + cold junction)
- WYSIWYG reflow profile editor with drag-to-edit setpoints
- Two operating modes:
  - **Saved** — send a profile to the T-962 and let it run autonomously
  - **Advanced** — Pi controls the oven in a closed loop with dynamic reactions
- Serial firmware flashing via LPC ISP protocol (GPIO-controlled reset/bootloader)
- Automated deployment to Raspberry Pi
- Serial proxy for debugging

## Hardware

- **Controller:** Raspberry Pi Zero W (or Pi Zero 2 W)
- **Oven:** T-962 reflow oven with [improved firmware](https://github.com/UnifiedEngineering/T-962-improvements)
- **Connection:** UART serial (115200 8N1) + GPIO for reset/ISP

### GPIO Wiring

| Pi GPIO | Function       | Wire Color | Notes                    |
|---------|---------------|------------|--------------------------|
| GPIO 17 | ISP/Bootloader | Yellow     | Active low = ISP mode    |
| GPIO 18 | Reset          | Orange     | Active low = reset       |
| GPIO 15 | RX (UART)      | Red        | ALT5 mode               |
| GPIO 14 | TX (UART)      | Brown      | ALT5 mode               |

## Technology Stack

Built with **[Bun](https://bun.sh)** (build/dev), React, uPlot, TypeScript. The T-962 improved firmware is included as a git submodule in `firmware/`.

## Quick Start

```bash
# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Clone and setup
git clone --recurse-submodules https://github.com/cinderblock/HotPi.git
cd HotPi
bun install

# Deploy to Pi (builds, transfers, starts service)
bun start

# Check Pi status
bun run status
```

### Configuration

```bash
cp .env.example .env.local
# Edit .env.local — set DEPLOY_HOST (default: hotpi.local)
```

## T-962 Serial Protocol

**Telemetry (device to host):** CSV lines at regular intervals
```
Time,Temp0,Temp1,Temp2,Temp3,Set,Actual,Heat,Fan,ColdJ,Mode
```

**Commands (host to device):** Text commands terminated with `\n`
- `stop` — halt current operation
- `reflow` — start reflow cycle
- `select profile N` — select profile (0-6)
- `list profiles` / `list settings` — query device

## Development

```bash
bun start          # Deploy with watch (auto-redeploy on changes)
bun run build      # Build only
bun run status     # Check Pi status
bun run lint       # Lint with Biome
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs `bun run build` on every push and pull request.

## License

MIT — Copyright 2025 Cameron Tacklind
