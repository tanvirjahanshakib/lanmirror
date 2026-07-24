/**
 * NexaScreen - extend-mode/virtual-monitor-control.js
 * -----------------------------------------------------------------------
 * Once the driver itself is installed (see driver-manager.js, a one-time
 * elevated step), individual virtual monitors are added/removed at
 * runtime through the driver's companion control binary. This is fast,
 * needs no elevation, and no reboot.
 *
 * The exact CLI flags below match virtual-display-rs's control tool as
 * an example - if you bundle a different IDD project, adjust the args
 * (or swap spawn() for a named-pipe client) to match its actual
 * protocol. Check that project's README for its CLI/IPC contract.
 * -----------------------------------------------------------------------
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const DRIVER_DIR = path.join(process.resourcesPath || path.join(__dirname, '..'), 'driver');
const CLI_PATH = path.join(DRIVER_DIR, 'vdd-ctl.exe');

function controlToolPresent() {
  return fs.existsSync(CLI_PATH);
}

/**
 * Adds a virtual monitor and resolves with its driver-assigned monitor
 * ID (needed later to remove it again).
 */
function addVirtualMonitor({ width = 1920, height = 1080, refreshHz = 60 } = {}) {
  if (!controlToolPresent()) {
    return Promise.reject(new Error(`Driver control tool not found at ${CLI_PATH}.`));
  }
  return new Promise((resolve, reject) => {
    const args = ['add', '--width', String(width), '--height', String(height), '--hz', String(refreshHz)];
    const p = spawn(CLI_PATH, args);
    let out = '';
    let errOut = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (errOut += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) {
        resolve(out.trim());
      } else {
        reject(new Error(`vdd-ctl add failed (exit ${code}): ${errOut || out}`));
      }
    });
  });
}

function removeVirtualMonitor(monitorId) {
  if (!monitorId) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const p = spawn(CLI_PATH, ['remove', '--id', String(monitorId)]);
    let errOut = '';
    p.stderr.on('data', (d) => (errOut += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`vdd-ctl remove failed: ${errOut}`))));
  });
}

function listVirtualMonitors() {
  if (!controlToolPresent()) return Promise.resolve([]);
  return new Promise((resolve) => {
    const p = spawn(CLI_PATH, ['list']);
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('error', () => resolve([]));
    p.on('close', () => {
      try {
        resolve(JSON.parse(out));
      } catch (_) {
        resolve([]);
      }
    });
  });
}

module.exports = { controlToolPresent, addVirtualMonitor, removeVirtualMonitor, listVirtualMonitors };
