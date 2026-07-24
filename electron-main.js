/**
 * NexaScreen - electron-main.js
 * -----------------------------------------------------------------------
 * Main (privileged) Electron process.
 *
 * Responsibilities:
 *  - Create and manage application windows (Mode Selector, Host, Viewer)
 *  - Own the embedded Express + Socket.IO signaling server (Host mode)
 *  - Provide desktopCapturer sources to the renderer via secure IPC
 *  - Resolve the machine's local LAN IPv4 address
 *  - Wire up electron-updater for silent auto-updates from GitHub Releases
 *  - Enforce security: contextIsolation, no nodeIntegration, no remote,
 *    strict IPC channel whitelisting
 * -----------------------------------------------------------------------
 */

'use strict';

const { app, BrowserWindow, ipcMain, desktopCapturer, session, shell } = require('electron');
const path = require('path');
const os = require('os');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');

const { createServer, stopServer } = require('./server/server');
const driverManager = require('./extend-mode/driver-manager');
const monitorControl = require('./extend-mode/virtual-monitor-control');
const displayDetector = require('./extend-mode/display-detector');

// -------------------------------------------------------------------------
// Globals
// -------------------------------------------------------------------------
let mainWindow = null;
let activeServerInstance = null; // { httpServer, io, port }
let extendModeMonitorId = null; // driver-assigned id of the active virtual monitor, if any
const DEFAULT_PORT = 4500;

autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('NexaScreen starting...');

// -------------------------------------------------------------------------
// Window creation
// -------------------------------------------------------------------------
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#0b0d12',
    title: 'NexaScreen',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // desktopCapturer stream handling needs this off for getUserMedia bridging
      webSecurity: true,
      enableRemoteModule: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'launcher.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Prevent navigation to arbitrary external sites; open externally instead.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  // Harden default session: strict permission handler (deny everything
  // except what NexaScreen explicitly needs).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['media', 'display-capture', 'fullscreen'];
    callback(allowed.includes(permission));
  });

  createMainWindow();

  // Check for updates ~5s after launch (non-blocking, silent).
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      log.warn('Auto-update check failed:', err.message);
    });
  }, 5000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (activeServerInstance) stopServer(activeServerInstance);
  if (extendModeMonitorId) {
    // Best-effort: don't block quit on this.
    monitorControl.removeVirtualMonitor(extendModeMonitorId).catch(() => {});
  }
  if (process.platform !== 'darwin') app.quit();
});

// -------------------------------------------------------------------------
// Auto-updater events -> forward status to renderer (optional UI toast)
// -------------------------------------------------------------------------
function sendUpdateStatus(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { channel, payload });
  }
}
autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
autoUpdater.on('update-available', (info) => sendUpdateStatus('available', info));
autoUpdater.on('update-not-available', () => sendUpdateStatus('none'));
autoUpdater.on('error', (err) => sendUpdateStatus('error', err.message));
autoUpdater.on('download-progress', (p) => sendUpdateStatus('progress', p));
autoUpdater.on('update-downloaded', () => sendUpdateStatus('downloaded'));

// -------------------------------------------------------------------------
// IPC: strict whitelist, all inputs validated
// -------------------------------------------------------------------------

/** Utility: get the best-guess LAN IPv4 address (skips internal/APIPA). */
function getLocalIPv4() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

ipcMain.handle('nexa:get-local-ip', () => {
  return getLocalIPv4();
});

ipcMain.handle('nexa:get-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180},
    fetchWindowIcons: false
  });
  // Only return plain, serializable, safe data to the renderer.
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL()
  }));
});

ipcMain.handle('nexa:start-server', async (_event, { port }) => {
  if (activeServerInstance) {
    return { ok: true, port: activeServerInstance.port, ip: getLocalIPv4(), alreadyRunning: true };
  }
  const safePort = Number.isInteger(port) && port > 1024 && port < 65535 ? port : DEFAULT_PORT;
  try {
    activeServerInstance = await createServer(safePort, {
      onViewerCountChange: (count) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('nexa:viewer-count', count);
        }
      },
      onViewerEvent: (evt) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('nexa:viewer-event', evt);
        }
      }
    });
    return { ok: true, port: activeServerInstance.port, ip: getLocalIPv4() };
  } catch (err) {
    log.error('Failed to start server', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('nexa:stop-server', async () => {
  if (activeServerInstance) {
    await stopServer(activeServerInstance);
    activeServerInstance = null;
  }
  return { ok: true };
});

ipcMain.handle('nexa:get-server-status', () => {
  return activeServerInstance
    ? { running: true, port: activeServerInstance.port, ip: getLocalIPv4() }
    : { running: false };
});

ipcMain.handle('nexa:get-app-version', () => app.getVersion());

// Simple, explicit navigation between "screens" inside the single window,
// requested by the renderer's mode selector. Keeps everything in one
// secure BrowserWindow instead of opening arbitrary windows.
const ALLOWED_VIEWS = new Set(['launcher.html', 'host.html', 'viewer.html']);
ipcMain.handle('nexa:navigate', (_event, viewName) => {
  if (!ALLOWED_VIEWS.has(viewName)) return { ok: false, error: 'Invalid view' };
  mainWindow.loadFile(path.join(__dirname, 'renderer', viewName));
  return { ok: true };
});

// -------------------------------------------------------------------------
// Extend Mode (virtual "Screen 2" via bundled Indirect Display Driver)
// -------------------------------------------------------------------------

ipcMain.handle('nexa:extend-mode-status', async () => {
  const [filesPresent, driverInstalled, testSigning] = await Promise.all([
    Promise.resolve(driverManager.driverFilesPresent()),
    driverManager.isDriverInstalled(),
    driverManager.isTestSigningEnabled()
  ]);
  return {
    filesPresent,
    driverInstalled,
    testSigningEnabled: testSigning,
    active: !!extendModeMonitorId
  };
});

ipcMain.handle('nexa:extend-mode-enable-test-signing', async () => {
  try {
    await driverManager.enableTestSigning();
    return { ok: true, rebootRequired: true };
  } catch (err) {
    log.error('enableTestSigning failed', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('nexa:extend-mode-install-driver', async () => {
  try {
    await driverManager.installDriver();
    return { ok: true };
  } catch (err) {
    log.error('installDriver failed', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('nexa:extend-mode-enable', async (_event, opts) => {
  if (extendModeMonitorId) {
    return { ok: false, error: 'Extend Mode is already active.' };
  }
  try {
    const before = displayDetector.snapshotDisplayIds();
    const monitorId = await monitorControl.addVirtualMonitor({
      width: (opts && opts.width) || 1920,
      height: (opts && opts.height) || 1080,
      refreshHz: (opts && opts.refreshHz) || 60
    });
    const newDisplay = await displayDetector.findNewDisplay(before);
    if (!newDisplay) {
      await monitorControl.removeVirtualMonitor(monitorId).catch(() => {});
      return { ok: false, error: 'Virtual display did not appear. Is the driver installed and test-signing enabled?' };
    }
    extendModeMonitorId = monitorId;
    return { ok: true, monitorId, displayId: newDisplay.id, bounds: newDisplay.bounds };
  } catch (err) {
    log.error('extend-mode-enable failed', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('nexa:extend-mode-disable', async () => {
  if (!extendModeMonitorId) return { ok: true };
  try {
    await monitorControl.removeVirtualMonitor(extendModeMonitorId);
    extendModeMonitorId = null;
    return { ok: true };
  } catch (err) {
    log.error('extend-mode-disable failed', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('nexa:get-source-for-display', async (_event, displayId) => {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 320, height: 180 } });
  const match = sources.find((s) => s.display_id === String(displayId));
  return match ? { id: match.id, name: match.name, thumbnail: match.thumbnail.toDataURL() } : null;
});
