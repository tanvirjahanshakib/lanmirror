/**
 * NexaScreen - extend-mode/driver-manager.js
 * -----------------------------------------------------------------------
 * Manages installation status of the bundled Windows virtual display
 * driver. Targets VirtualDrivers/Virtual-Display-Driver
 * (https://github.com/VirtualDrivers/Virtual-Display-Driver), which is
 * properly code-signed (SignPath.io) - so, unlike some other IDD
 * projects, Windows test-signing mode is NOT required on typical x64
 * systems (only some ARM64 + Windows 11 24H2+ configurations may need
 * it - see the driver's own docs if that applies to you).
 *
 * Control happens via the driver's official "Community Scripts"
 * PowerShell collection, NOT a generic vdd-ctl.exe (that was wrong in
 * an earlier version of this file). Place these files under
 * /driver/scripts (see driver/README.md):
 *
 *   driver/scripts/virtual-driver-manager.ps1   <- install/uninstall/status/enable/disable
 *   driver/scripts/toggle-VDD.ps1                <- quick enable/disable toggle
 *   driver/scripts/changeres-VDD.ps1             <- change virtual display resolution
 *
 * Source: https://github.com/VirtualDrivers/Virtual-Display-Driver/tree/master/Community%20Scripts
 * -----------------------------------------------------------------------
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const sudoPrompt = require('sudo-prompt');

// process.resourcesPath always has SOME value in Electron, but in dev
// mode (npm start, unpackaged) it points inside Electron's own install,
// not this project - so it must only be used once the app is packaged.
const BASE_DIR = app && app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
const SCRIPTS_DIR = path.join(BASE_DIR, 'driver', 'scripts');
const MANAGER_SCRIPT = path.join(SCRIPTS_DIR, 'virtual-driver-manager.ps1');

function scriptsPresent() {
  return fs.existsSync(MANAGER_SCRIPT);
}

/**
 * Runs a PowerShell script ELEVATED via sudo-prompt. This is required
 * because plain child_process.spawn() from Electron's main process
 * cannot reliably surface a UAC prompt - confirmed by direct testing:
 * the same script runs fine from a normal PowerShell window (shows a
 * UAC dialog, completes after approval), but hangs forever when spawned
 * from Electron (the dialog never appears, so it can never be approved).
 * sudo-prompt uses the correct OS-level mechanism to show a real,
 * clickable UAC prompt for a child process launched from an Electron app.
 */
function runElevatedPowerShellScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const quotedArgs = args.map((a) => `"${a}"`).join(' ');
    const command = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" ${quotedArgs}`;
    sudoPrompt.exec(command, { name: 'NexaScreen' }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout || '').trim());
    });
  });
}

/** Non-elevated variant, kept only for callers that explicitly know a
 *  given script/action doesn't need admin rights. Most actions on this
 *  particular driver DO require elevation (verified: even a plain
 *  `-Action status` call requests it), so prefer runElevatedPowerShellScript. */
function runPowerShellScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args]);
    let out = '';
    let errOut = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (errOut += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`${path.basename(scriptPath)} exited with code ${code}: ${errOut || out}`));
    });
  });
}

/**
 * IMPORTANT: this driver's status script requires elevation on every
 * single call (verified directly) and doesn't return a useful
 * installed/enabled JSON field anyway (verified: real output is just
 * {"status":"success","message":"Status Succeeded."}). Calling it here
 * would mean a UAC prompt (or a silent hang, from Electron) on every
 * page load/refresh for no real benefit - so this now only checks
 * whether the control scripts exist on disk, with no PowerShell
 * invocation at all. The Host UI's Enable button success/failure (based
 * on whether the virtual display actually appears) is the real signal.
 */
async function getDriverStatus() {
  return { scriptsPresent: scriptsPresent() };
}

/** Installs the driver. Shows a real UAC prompt via sudo-prompt. */
function installDriver() {
  if (!scriptsPresent()) {
    return Promise.reject(
      new Error(
        `Community Scripts not found in ${SCRIPTS_DIR}. Copy them from the driver release first (see driver/README.md).`
      )
    );
  }
  return runElevatedPowerShellScript(MANAGER_SCRIPT, ['-Action', 'install']);
}

function uninstallDriver() {
  if (!scriptsPresent()) return Promise.resolve();
  return runElevatedPowerShellScript(MANAGER_SCRIPT, ['-Action', 'uninstall', '-Silent']);
}

module.exports = {
  SCRIPTS_DIR,
  scriptsPresent,
  getDriverStatus,
  installDriver,
  uninstallDriver,
  runPowerShellScript,
  runElevatedPowerShellScript
};
