import { Command } from 'commander';
import { homedir, platform } from 'os';
import { join } from 'path';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { logger } from '../../utils/logger';

export const serviceCommand = new Command('service').description(
  'Manage the Autoply API background service (auto-start on login)'
);

// ---- macOS launchd ----

function getLaunchdPlistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', 'com.autoply.api.plist');
}

function installMacos(): void {
  const plistPath = getLaunchdPlistPath();
  const launchAgentsDir = join(homedir(), 'Library', 'LaunchAgents');

  if (!existsSync(launchAgentsDir)) {
    mkdirSync(launchAgentsDir, { recursive: true });
  }

  const execPath = process.execPath; // bun executable
  const scriptDir = join(import.meta.dir, '..', '..');
  const logPath = join(homedir(), '.autoply', 'api.log');

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.autoply.api</string>
  <key>ProgramArguments</key>
  <array>
    <string>${execPath}</string>
    <string>run</string>
    <string>api</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${scriptDir}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
</dict>
</plist>`;

  writeFileSync(plistPath, plist);
  try {
    execSync(`launchctl load "${plistPath}"`, { stdio: 'pipe' });
    logger.success(`Service installed. Autoply API will start automatically on login.`);
    logger.info(`Plist: ${plistPath}`);
    logger.info(`Log: ${logPath}`);
  } catch (err) {
    logger.warning(`Plist written but launchctl load failed: ${(err as Error).message}`);
    logger.info(`Run manually: launchctl load "${plistPath}"`);
  }
}

function uninstallMacos(): void {
  const plistPath = getLaunchdPlistPath();
  if (!existsSync(plistPath)) {
    logger.info('Service is not installed.');
    return;
  }
  try {
    execSync(`launchctl unload "${plistPath}"`, { stdio: 'pipe' });
  } catch { /* service may already be stopped */ }
  unlinkSync(plistPath);
  logger.success('Service removed. Autoply API will no longer auto-start.');
}

function statusMacos(): void {
  const plistPath = getLaunchdPlistPath();
  if (!existsSync(plistPath)) {
    logger.info('Service: not installed');
    return;
  }
  try {
    const out = execSync('launchctl list com.autoply.api', { encoding: 'utf8', stdio: 'pipe' });
    const pid = out.match(/"PID"\s*=\s*(\d+)/)?.[1];
    if (pid) {
      logger.success(`Service: running (PID ${pid})`);
    } else {
      logger.warning('Service: installed but not running');
    }
  } catch {
    logger.warning('Service: installed but not running');
  }
}

// ---- Linux systemd user ----

function getSystemdUnitPath(): string {
  return join(homedir(), '.config', 'systemd', 'user', 'autoply-api.service');
}

function installLinux(): void {
  const unitPath = getSystemdUnitPath();
  const unitDir = join(homedir(), '.config', 'systemd', 'user');
  mkdirSync(unitDir, { recursive: true });

  const execPath = process.execPath;
  const scriptDir = join(import.meta.dir, '..', '..');

  const unit = `[Unit]
Description=Autoply API Server
After=network.target

[Service]
Type=simple
ExecStart=${execPath} run api
WorkingDirectory=${scriptDir}
Restart=on-failure
StandardOutput=append:${join(homedir(), '.autoply', 'api.log')}
StandardError=append:${join(homedir(), '.autoply', 'api.log')}

[Install]
WantedBy=default.target
`;

  writeFileSync(unitPath, unit);
  try {
    execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
    execSync('systemctl --user enable --now autoply-api', { stdio: 'pipe' });
    logger.success('Service installed. Autoply API will start automatically on login.');
    logger.info(`Unit file: ${unitPath}`);
  } catch (err) {
    logger.warning(`Unit written but systemctl failed: ${(err as Error).message}`);
    logger.info(`Run manually: systemctl --user enable --now autoply-api`);
  }
}

function uninstallLinux(): void {
  const unitPath = getSystemdUnitPath();
  if (!existsSync(unitPath)) {
    logger.info('Service is not installed.');
    return;
  }
  try {
    execSync('systemctl --user disable --now autoply-api', { stdio: 'pipe' });
  } catch { /* service may already be stopped */ }
  unlinkSync(unitPath);
  try {
    execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
  } catch { /* best-effort reload */ }
  logger.success('Service removed.');
}

function statusLinux(): void {
  try {
    const out = execSync('systemctl --user status autoply-api', { encoding: 'utf8', stdio: 'pipe' });
    const active = out.includes('active (running)');
    if (active) {
      logger.success('Service: running');
    } else {
      logger.warning('Service: installed but not active');
    }
  } catch {
    logger.info('Service: not installed');
  }
}

// ---- Dispatch ----

serviceCommand
  .command('install')
  .description('Register Autoply API as a system service that starts on login')
  .action(() => {
    const os = platform();
    if (os === 'darwin') {
      installMacos();
    } else if (os === 'linux') {
      installLinux();
    } else {
      logger.error(`Auto-start service is not supported on ${os}. Start the API manually with: bun run api`);
    }
  });

serviceCommand
  .command('uninstall')
  .description('Remove the Autoply API system service')
  .action(() => {
    const os = platform();
    if (os === 'darwin') uninstallMacos();
    else if (os === 'linux') uninstallLinux();
    else logger.error(`Not supported on ${os}`);
  });

serviceCommand
  .command('status')
  .description('Check if the Autoply API service is running')
  .action(() => {
    const os = platform();
    if (os === 'darwin') statusMacos();
    else if (os === 'linux') statusLinux();
    else logger.error(`Not supported on ${os}`);
  });
