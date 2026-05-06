# HotPi — Desktop Reflow Oven Controller

## Goal
Build a desktop web-based controller for a T-962 reflow oven, forked from battery-controller. The app runs on a Raspberry Pi Zero W connected to the T-962 via serial, with a browser GUI for defining reflow profiles (WYSIWYG), real-time temperature charting, and firmware flashing.

## Environment / Context
- **Hardware:** Raspberry Pi Zero W Rev 1.1 (ARMv6, BCM2835), reachable at `hotpi.local`
  - **Runtime consideration:** Pi Zero 1 is ARMv6 — Bun does NOT support ARMv6. Node v20 is installed and working. May need to upgrade to Pi Zero 2 W (ARM64) or target Node as the runtime on-Pi.
- **Oven MCU:** NXP LPC2134/01 (ARM7TDMI) — T-962 reflow oven
- **Firmware repo:** [UnifiedEngineering/T-962-improvements](https://github.com/UnifiedEngineering/T-962-improvements) (added as `firmware/` submodule)
- **Existing working flasher:** Found on Pi at `/home/pi/toaster/` — Node.js app using `lpc-flash` npm package + `pigpio` for GPIO
- **Serial flasher library:** `lpc-flash` (published npm package, source at `C:\Users\camer\git\Personal Projects\lpc-flash`)
- **Base project:** battery-controller (shared git history, not a GitHub fork — can't self-fork)
- **GitHub repo:** [cinderblock/HotPi](https://github.com/cinderblock/HotPi)
- **Stack:** Bun (dev/build), React, uPlot, TypeScript. Runtime on Pi: TBD (Node or Bun depending on Pi hardware)
- **OS on Pi:** Raspbian Bullseye

### GPIO Wiring (from toaster project on Pi)
| Pi GPIO | Function | Wire Color | Notes |
|---------|----------|------------|-------|
| GPIO 17 | ISP/Bootloader | Yellow | Active low = ISP mode |
| GPIO 18 | Reset | Orange | Active low = reset |
| GPIO 15 | RX (UART) | Red | ALT5 mode |
| GPIO 14 | TX (UART) | Brown | ALT5 mode |

### Flashing Sequence
1. Pull reset (GPIO 18) low
2. Pull ISP (GPIO 17) low
3. Wait 200ms
4. Release reset (GPIO 18) high → MCU boots into ISP mode
5. Flash via `lpc-flash` at 57600 baud, clock freq 11059 kHz
6. Set ISP high, pulse reset → boot into normal mode

## T-962 Serial Protocol
- **Baud:** 115200, 8N1
- **Telemetry (device → host):** CSV lines: `Time,Temp0,Temp1,Temp2,Temp3,Set,Actual,Heat,Fan,ColdJ,Mode`
  - Mode values: `STANDBY`, `REFLOW`, `BAKE`
  - Lines starting with `#` are comments (ignored)
  - Version line: `T-962-controller open source firmware (v0.5.2)`
- **Commands (host → device):** Text commands terminated with `\n`:
  - `stop` — halt current operation
  - `select profile [0-6]` — select reflow profile
  - `reflow` — start reflow cycle
  - `quiet` — reduce output verbosity
  - `list profiles` — enumerate available profiles
  - `list settings` — enumerate current settings
- **Flashing:** lpc-flash npm package, ISP via GPIO 17 (bootloader) + GPIO 18 (reset)

## Decisions Already Made (Don't Re-Ask)
- Shared git history (not GitHub fork) — GitHub can't self-fork
- T-962-improvements as `firmware/` submodule
- Keep Bun + React + uPlot stack
- Keep serial proxy feature
- Drop camera/ffmpeg, barcode, OCR, cells, capacity tracking
- LPC ISP flashing via `lpc-flash` npm package + `pigpio` GPIO (proven working in toaster project)
- Minimize external dependencies
- Project name: HotPi
- **Two operating modes:**
  1. **"Saved" profile mode** — send a profile to the T-962 and let it run autonomously. Disables advanced features like reacting to slow temperature rise.
  2. **"Advanced/Local" profile mode** — same profiles, but the Pi controls the oven in a closed loop (reads temps, sends commands). Enables dynamic reactions like detecting slow ramp rates.

## Plan / Steps

### Phase 1: Clean Up — Strip Battery-Controller Specifics (DONE)
1. [x] Create GitHub repo with shared history
2. [x] Add T-962-improvements submodule
3. [x] Rename project throughout (package.json, deploy config, service name, logs)
4. [x] Delete battery-specific code (protocol, decode.ts, samples.csv, Developer.md, protocol.md)
5. [ ] Simplify DB schema for reflow runs (runs, data_points, profiles) — deferred until needed
6. [x] Update deploy config: hostname `hotpi.local`, app dir `/opt/hotpi`, service `hotpi`

### Phase 2: T-962 Serial Integration (DONE — basic)
7. [x] New serial parser for CSV telemetry lines (`src/server/serial.ts`)
8. [x] New command sender (text commands)
9. [x] Update state manager for reflow data model (`src/server/state.ts`)
10. [ ] GPIO control module (for reset/bootloader entry via Pi GPIO pins) — deferred to Phase 5

### Phase 3: Reflow Profile System (IN PROGRESS)
11. [x] Profile data model: `ProfilePoint`, `DynamicSetpoint`, `Profile`, `T962Profile` in `src/shared/profile.ts`
12. [x] "Dynamic" setpoints: `DynamicSetpoint` interface (target temp + wait-until condition + hold duration) — type defined, runtime logic TBD
13. [x] WYSIWYG profile editor: SVG-based drag points in `src/frontend/components/ProfileEditor.tsx`
14. [x] Profile storage: JSON file persistence in `src/server/profiles.ts`, save/load/delete via WebSocket
15. [ ] Live setpoint adjustment during runs
16. [x] Advanced mode control loop: `ProfileRunner` in `src/server/profile-runner.ts` — follows profile via `bake` commands at 2s intervals

### Phase 4: Chart & UI (IN PROGRESS)
17. [x] Adapt chart: X=time, Y=temperature with profile overlay using uPlot (`src/frontend/components/ReflowChart.tsx`)
18. [x] Show real-time temps overlaid on profile curve (actual, setpoint, profile)
19. [x] Tab navigation: Profile Editor + Live Monitor tabs in App.tsx
20. [x] Auto-switch to Live Monitor when reflow/bake starts
21. [ ] Recent runs list (no historical archive)
22. [ ] Post-run notes
23. [ ] Heat/fan power visualization

### Phase 5: Firmware Flashing
21. [ ] Integrate lpc-flash ISP protocol into server
22. [ ] Build firmware from submodule (cross-compile on Pi or locally)
23. [ ] Flash UI: select firmware, trigger flash, show progress
24. [ ] GPIO reset/bootloader control for automated flashing

### Phase 6: Polish
25. [ ] Update README
26. [ ] Clean up dependencies
27. [ ] Test full deploy cycle to Pi

## Findings / Gotchas
- Pi Zero W is ARMv6 — Bun doesn't support ARMv6. Node v20.18.1 is installed and working. Either upgrade to Pi Zero 2 W or target Node runtime.
- T-962 serial protocol is simple CSV text, very different from binary EBC protocol
- The battery-controller codebase has been through significant refactoring — current server/index.ts is cleaner WebSocket-based (not SSE as in older versions)
- `ghostcom` dependency in battery-controller may need removal (serial port cleanup utility)
- **Existing `toaster` project on Pi** (`/home/pi/toaster/`) is a working Node.js oven controller with flasher. Uses `serialport`, `pigpio`, `lpc-flash`, `nrf-intel-hex`, `ws`. This is the proven reference implementation.
- The `toaster` project auto-updates firmware on boot if version doesn't match v0.5.2 — downloads hex from GitHub releases
- `pigpio` requires `pigpiod` daemon — the bash history shows it was manually linked to `/usr/local/bin/pigpiod`
- `toaster_` is an older CJS-bundled version of the same code
- T-962 firmware has `dump profile <id>` to read profiles (48 CSV values) but NO write command — profiles can only be uploaded via keypad or EEPROM. For "Advanced" mode, use `bake <temp>` commands in a closed loop from the Pi.
- Additional serial commands discovered: `bake <temp> [duration]`, `setting <id> <value>`, `about`, `values`

## Progress Log
- [x] Explored battery-controller project structure
- [x] Found lpc-flash PoC at `C:\Users\camer\git\Personal Projects\lpc-flash`
- [x] Identified T-962 hardware: LPC2134, CSV serial protocol, lpc21isp flashing
- [x] Created GitHub repo cinderblock/HotPi with shared history
- [x] Added T-962-improvements as `firmware/` submodule
- [x] SSH'd to Pi Zero W at hotpi.local — confirmed ARMv6, Bullseye, Node v20 installed, no Bun
- [x] Found working `toaster` project on Pi with GPIO wiring, flasher, and serial comms
- [x] Documented GPIO pins: GPIO 17 (ISP/Yellow), GPIO 18 (Reset/Orange), GPIO 14/15 (UART)
- [x] User decided on two operating modes (Saved + Advanced/Local)
- [x] Strip and rename project — all battery references removed from src/
- [x] Rewrote serial.ts for T-962 CSV protocol (line-based, 115200 8N1)
- [x] Rewrote state.ts for OvenState (telemetry, firmware version, mode)
- [x] Rewrote server/index.ts for reflow oven commands
- [x] Rewrote frontend (App.tsx, hooks, api-client.ts) for oven telemetry
- [x] Updated deploy config (hotpi.local, /opt/hotpi, service hotpi)
- [x] Added telemetry CSS grid styles
- [x] New README.md with T-962 protocol docs and GPIO wiring table
- [x] Verified build succeeds (Bun.build, 4 output files)
- [x] Profile data model with interpolation + T-962 format conversion (`src/shared/profile.ts`)
- [x] Built-in profile templates: Lead-Free (SAC305) and Leaded (63/37)
- [x] uPlot chart component with profile overlay + live data (`src/frontend/components/ReflowChart.tsx`)
- [x] SVG-based WYSIWYG profile editor with drag, add, delete points (`src/frontend/components/ProfileEditor.tsx`)
- [x] Extended serial commands: `bake`, `dump profile`, `setting`, `about`, `values`
- [x] Tabbed App UI: Profile Editor + Live Monitor, auto-switch on run start
- [x] Live data accumulation from telemetry during REFLOW/BAKE modes
- [x] Advanced mode control loop (`ProfileRunner` — follows profile via `bake` commands)
- [x] Profile persistence (JSON file, save/load/delete via WebSocket)
- [x] Profile selector + save/delete UI in App.tsx
- [ ] GPIO module + lpc-flash integration
- [ ] Deploy and test on Pi

## Open Questions for the User
1. ~~Which Pi GPIO pins are wired to T-962 reset and F1/bootloader?~~ **ANSWERED:** GPIO 17 (ISP), GPIO 18 (Reset)
2. Should the profile editor support the existing T-962 profile format (48 temperature points over 470s) or a custom format that the Pi translates? **Partially answered:** Two modes — saved (T-962 native) and advanced (Pi-controlled). Profile editor needs to support both.
3. ~~For "dynamic" setpoints — is the Pi controlling the T-962 in a closed loop?~~ **ANSWERED:** Yes, in "Advanced/Local" mode. In "Saved" mode, T-962 runs autonomously.
4. Do you want the firmware cross-compiled on the Pi itself, or built locally and transferred? The toaster project downloads pre-built hex from GitHub releases — should we keep that pattern or build from the submodule?
5. **Pi hardware:** Stay with Pi Zero 1 (target Node runtime) or upgrade to Pi Zero 2 W (use Bun)?

## Things Not to Do
- Don't try to GitHub-fork into the same account (impossible)
- Don't use `git stash push/pop/apply/drop` (user policy)
- Don't add unnecessary dependencies — user wants minimal external deps
- Don't over-engineer the profile format before understanding how T-962 control actually works in practice
