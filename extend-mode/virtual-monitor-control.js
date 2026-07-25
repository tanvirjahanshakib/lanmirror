/**
 * NexaScreen - extend-mode/virtual-monitor-control.js
 * -----------------------------------------------------------------------
 * Enables/disables the virtual display and sets its resolution using
 * VirtualDrivers/Virtual-Display-Driver's official Community Scripts.
 * This driver's model is a single virtual display device that you
 * enable/disable (not multiple independently-addressed monitors by ID
 * as an earlier version of this file assumed) - Windows shows/hides
 * "Screen 2" accordingly.
 * -----------------------------------------------------------------------
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { runPowerShellScript, SCRIPTS_DIR } = require('./driver-manager');

const MANAGER_SCRIPT = path.join(SCRIPTS_DIR, 'virtual-driver-manager.ps1');
const CHANGERES_SCRIPT = path.join(SCRIPTS_DIR, 'changeres-VDD.ps1');

function scriptExists(p) {
  return fs.existsSync(p);
}

/** Enables the virtual display device (Windows will enumerate it as a
 *  new monitor within a second or two) and optionally sets a resolution. */
async function enableVirtualDisplay({ width, height } = {}) {
  if (!scriptExists(MANAGER_SCRIPT)) {
    throw new Error(`virtual-driver-manager.ps1 not found in ${SCRIPTS_DIR}.`);
  }
  await runPowerShellScript(MANAGER_SCRIPT, ['-Action', 'enable']);

  if (width && height && scriptExists(CHANGERES_SCRIPT)) {
    // Best-effort - resolution change failing shouldn't block Extend Mode.
    try {
      await runPowerShellScript(CHANGERES_SCRIPT, ['-xres', String(width), '-yres', String(height)]);
    } catch (_) {
      /* non-fatal */
    }
  }
}

async function disableVirtualDisplay() {
  if (!scriptExists(MANAGER_SCRIPT)) return;
  await runPowerShellScript(MANAGER_SCRIPT, ['-Action', 'disable']);
}

module.exports = { enableVirtualDisplay, disableVirtualDisplay };
