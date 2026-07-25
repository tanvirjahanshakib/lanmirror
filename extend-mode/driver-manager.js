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

// process.resourcesPath always has SOME value in Electron, but in dev
// mode (npm start, unpackaged) it points inside Electron's own install,
// not this project - so it must only be used once the app is packaged.
const BASE_DIR = app && app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
const SCRIPTS_DIR = path.join(BASE_DIR, 'driver', 'scripts');
const MANAGER_SCRIPT = path.join(SCRIPTS_DIR, 'virtual-driver-manager.ps1');

function scriptsPresent() {
  return fs.existsSync(MANAGER_SCRIPT);
}

/** Runs a PowerShell script with -ExecutionPolicy Bypass and returns stdout. */
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
 * IMPORTANT: this driver's `-Action status -Json` does NOT return a
 * parseable installed/enabled boolean - it only confirms the status
 * *check itself* ran (e.g. {"status":"success","message":"Status
 * Succeeded."}), verified against the real script's live output. So
 * this function is now informational only (surfaced for debugging) and
 * the Host UI no longer gates the "Enable Extend Mode" button on it -
 * see extend-mode-enable's own success/failure (based on whether the
 * virtual display actually appears) for the real signal instead.
 */
async function getDriverStatus() {
  if (!scriptsPresent()) {
    return { scriptsPresent: false };
  }
  try {
    const out = await runPowerShellScript(MANAGER_SCRIPT, ['-Action', 'status', '-Json']);
    return { scriptsPresent: true, rawOutput: out };
  } catch (err) {
    return { scriptsPresent: true, error: err.message };
  }
}

/** Installs the driver. May trigger a UAC prompt (the script self-elevates
 *  if not already running elevated). Best-effort - safe to call even if
 *  already installed. */
function installDriver() {
  if (!scriptsPresent()) {
    return Promise.reject(
      new Error(
        `Community Scripts not found in ${SCRIPTS_DIR}. Copy them from the driver release first (see driver/README.md).`
      )
    );
  }
  return runPowerShellScript(MANAGER_SCRIPT, ['-Action', 'install']);
}

function uninstallDriver() {
  if (!scriptsPresent()) return Promise.resolve();
  return runPowerShellScript(MANAGER_SCRIPT, ['-Action', 'uninstall', '-Silent']);
}

module.exports = {
  SCRIPTS_DIR,
  scriptsPresent,
  getDriverStatus,
  installDriver,
  uninstallDriver,
  runPowerShellScript
};
