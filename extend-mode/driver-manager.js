/**
 * NexaScreen - extend-mode/driver-manager.js
 * -----------------------------------------------------------------------
 * Manages the lifecycle of the bundled Indirect Display Driver (IDD)
 * used to create a virtual "Screen 2" for Extend Mode. This module does
 * NOT implement a driver itself — writing a signed Windows kernel-mode
 * IDD from scratch is a separate, multi-week WDK project outside the
 * scope of an Electron app. Instead it drives an already-signed,
 * open-source IDD package (e.g. virtual-display-rs, or Amyuni
 * usbmmidd_v2) that you place under /driver at build time.
 *
 * Expected /driver contents (place these yourself - see README):
 *   driver/VirtualDisplayDriver.inf
 *   driver/VirtualDisplayDriver.cat
 *   driver/VirtualDisplayDriver.sys / .dll
 *   driver/vdd-ctl.exe        <- CLI/companion binary used to add/remove
 *                                 virtual monitors at runtime without a
 *                                 reboot (name depends on which driver
 *                                 project you bundle; adjust CLI args in
 *                                 virtual-monitor-control.js to match).
 *
 * All privileged operations (install/uninstall/enable test-signing) use
 * sudo-prompt so Windows shows a native UAC dialog - nothing here runs
 * silently with elevated rights behind the user's back.
 * -----------------------------------------------------------------------
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const sudoPrompt = require('sudo-prompt');

const DRIVER_DIR = path.join(process.resourcesPath || path.join(__dirname, '..'), 'driver');
const INF_NAME = 'VirtualDisplayDriver.inf';

function driverFilesPresent() {
  return fs.existsSync(path.join(DRIVER_DIR, INF_NAME));
}

/** Runs `bcdedit /enum` and checks whether Windows test-signing mode is on.
 *  Unsigned/test-signed IDD drivers refuse to load unless this is enabled.
 */
function isTestSigningEnabled() {
  return new Promise((resolve) => {
    const p = spawn('bcdedit', ['/enum']);
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('error', () => resolve(false));
    p.on('close', () => resolve(/testsigning\s+Yes/i.test(out)));
  });
}

/** Enables test-signing mode. Requires a reboot to take effect - always
 *  surface that requirement to the user before calling this. */
function enableTestSigning() {
  return new Promise((resolve, reject) => {
    sudoPrompt.exec('bcdedit /set testsigning on', { name: 'NexaScreen' }, (err) =>
      err ? reject(err) : resolve()
    );
  });
}

function isDriverInstalled() {
  return new Promise((resolve) => {
    const p = spawn('pnputil', ['/enum-drivers']);
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('error', () => resolve(false));
    p.on('close', () => resolve(out.includes('VirtualDisplayDriver')));
  });
}

function installDriver() {
  if (!driverFilesPresent()) {
    return Promise.reject(
      new Error(
        `Driver files not found in ${DRIVER_DIR}. Download the virtual display driver release and place its files there first (see README > Extend Mode setup).`
      )
    );
  }
  const infPath = path.join(DRIVER_DIR, INF_NAME);
  return new Promise((resolve, reject) => {
    sudoPrompt.exec(`pnputil /add-driver "${infPath}" /install`, { name: 'NexaScreen' }, (err, stdout) =>
      err ? reject(err) : resolve(String(stdout || ''))
    );
  });
}

function uninstallDriver() {
  return new Promise((resolve, reject) => {
    sudoPrompt.exec(
      `pnputil /delete-driver ${INF_NAME} /uninstall /force`,
      { name: 'NexaScreen' },
      (err) => (err ? reject(err) : resolve())
    );
  });
}

module.exports = {
  DRIVER_DIR,
  driverFilesPresent,
  isTestSigningEnabled,
  enableTestSigning,
  isDriverInstalled,
  installDriver,
  uninstallDriver
};
