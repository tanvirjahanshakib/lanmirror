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

/** Looks up a boolean-ish field in a parsed JSON object regardless of
 *  exact key casing/naming (Installed / installed / IsInstalled / ...),
 *  since the upstream script's exact output shape wasn't verifiable
 *  without a live Windows machine. Falls back to false if nothing matches. */
function findBooleanField(obj, candidateNames) {
  const lowerKeys = Object.keys(obj).reduce((map, k) => {
    map[k.toLowerCase()] = obj[k];
    return map;
  }, {});
  for (const name of candidateNames) {
    const val = lowerKeys[name.toLowerCase()];
    if (val !== undefined) return !!val;
  }
  return false;
}

/** Uses `-Action status -Json` to check whether the driver is installed/enabled.
 *  Falls back to { installed: false, enabled: false } if the script or
 *  driver isn't present yet, rather than throwing - status checks should
 *  never crash the Host UI. Includes rawOutput so the Host UI/logs can
 *  surface the actual script response for debugging field-name mismatches. */
async function getDriverStatus() {
  if (!scriptsPresent()) {
    return { scriptsPresent: false, installed: false, enabled: false };
  }
  try {
    const out = await runPowerShellScript(MANAGER_SCRIPT, ['-Action', 'status', '-Json']);
    const jsonStart = out.indexOf('{');
    const parsed = jsonStart >= 0 ? JSON.parse(out.slice(jsonStart)) : {};
    return {
      scriptsPresent: true,
      installed: findBooleanField(parsed, ['Installed', 'IsInstalled', 'DriverInstalled']),
      enabled: findBooleanField(parsed, ['Enabled', 'IsEnabled', 'Active', 'DisplayEnabled']),
      rawOutput: out
    };
  } catch (err) {
    return { scriptsPresent: true, installed: false, enabled: false, error: err.message };
  }
}

/** Installs the driver. Triggers one UAC prompt (the script self-elevates). */
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
