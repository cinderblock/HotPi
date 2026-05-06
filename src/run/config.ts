/**
 * Shared configuration for deployment scripts
 */

// Deployment configuration
export const DeployHost = process.env.DEPLOY_HOST || 'hotpi.local';
export const DeployPort = Number(process.env.DEPLOY_PORT) || 22;
export const DeployUser = process.env.DEPLOY_USER || 'pi';
export const DeployKey = process.env.DEPLOY_KEY;
// Remote paths
export const DeployAppDir = '/opt/hotpi'; // Where to deploy the app
export const DeploySetupHome = `/home/${DeployUser}`; // Where to run setup from
// Remote files
export const DeploySetupPath = `${DeploySetupHome}/setup.js`; // Path to setup script
export const DeployBunBin = `${DeploySetupHome}/.bun/bin/bun`; // Path to Bun binary

// Remote systemd service configuration
export const DeployServiceName = 'hotpi';
export const DeployDevServiceName = 'hotpi-dev';
