/**
 * NexaScreen - preload.js
 * -----------------------------------------------------------------------
 * Runs in an isolated context bridging the sandboxed renderer to a
 * strictly whitelisted set of main-process capabilities. Nothing beyond
 * what's explicitly exposed here is reachable from the renderer, and
 * nodeIntegration is disabled in every window.
 * -----------------------------------------------------------------------
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Whitelisted invoke channels only - never expose ipcRenderer directly.
const VALID_INVOKE_CHANNELS = [
  'nexa:get-local-ip',
  'nexa:get-sources',
  'nexa:start-server',
  'nexa:stop-server',
  'nexa:get-server-status',
  'nexa:get-app-version',
  'nexa:navigate',
  'nexa:extend-mode-status',
  'nexa:extend-mode-enable-test-signing',
  'nexa:extend-mode-install-driver',
  'nexa:extend-mode-enable',
  'nexa:extend-mode-disable',
  'nexa:get-source-for-display'
];

const VALID_LISTEN_CHANNELS = ['nexa:viewer-count', 'nexa:viewer-event', 'update-status'];

function safeInvoke(channel, payload) {
  if (!VALID_INVOKE_CHANNELS.includes(channel)) {
    return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
  }
  return ipcRenderer.invoke(channel, payload);
}

function safeOn(channel, callback) {
  if (!VALID_LISTEN_CHANNELS.includes(channel)) return () => {};
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('nexa', {
  getLocalIP: () => safeInvoke('nexa:get-local-ip'),
  getSources: () => safeInvoke('nexa:get-sources'),
  startServer: (port) => safeInvoke('nexa:start-server', { port }),
  stopServer: () => safeInvoke('nexa:stop-server'),
  getServerStatus: () => safeInvoke('nexa:get-server-status'),
  getAppVersion: () => safeInvoke('nexa:get-app-version'),
  navigate: (view) => safeInvoke('nexa:navigate', view),

  extendModeStatus: () => safeInvoke('nexa:extend-mode-status'),
  extendModeEnableTestSigning: () => safeInvoke('nexa:extend-mode-enable-test-signing'),
  extendModeInstallDriver: () => safeInvoke('nexa:extend-mode-install-driver'),
  extendModeEnable: (opts) => safeInvoke('nexa:extend-mode-enable', opts),
  extendModeDisable: () => safeInvoke('nexa:extend-mode-disable'),
  getSourceForDisplay: (displayId) => safeInvoke('nexa:get-source-for-display', displayId),

  onViewerCountChange: (cb) => safeOn('nexa:viewer-count', cb),
  onViewerEvent: (cb) => safeOn('nexa:viewer-event', cb),
  onUpdateStatus: (cb) => safeOn('update-status', cb)
});
