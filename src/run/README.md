# Run Scripts

Build, deployment, and management scripts.

## Files

- **`build.ts`** - Bundles server and setup using Bun.build() API. Exports `build()` function for programmatic use. CLI mode writes to `build/` directory.
- **`deploy.ts`** - Deployment orchestrator. Builds project, transfers to Pi via SSH, manages setup and services. Watch mode for auto-redeploy.
- **`setup.ts`** - Pi setup script. Runs on Pi to configure system, install dependencies, create systemd services.
- **`status.ts`** - Remote status checker. Queries Pi via SSH for service status, logs, and system info.
- **`utils.ts`** - Shared utilities for SSH connection management and SFTP file transfers.

## How Deployment Works

`deploy.ts` → calls `build()` → transfers via SSH (`utils.ts`) → runs `setup.ts` on Pi → restarts service

Environment configuration in `.env`: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KEY`
