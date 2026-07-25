'use strict';

/**
 * NexaScreen - host.js
 * Manages: source selection -> desktop capture -> local signaling server
 * -> one RTCPeerConnection per connected viewer -> live status UI.
 */

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

const state = {
  selectedSourceId: null,
  localStream: null,
  socket: null,
  serverInfo: null, // { ip, port }
  peers: new Map(), // viewerId -> RTCPeerConnection
  viewers: new Map(), // viewerId -> { name }
  sharing: false,
  extend: { active: false, displayId: null }
};

const el = {
  sourceGrid: document.getElementById('sourceGrid'),
  refreshBtn: document.getElementById('refreshSourcesBtn'),
  ipValue: document.getElementById('ipValue'),
  portValue: document.getElementById('portValue'),
  addressValue: document.getElementById('addressValue'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  previewVideo: document.getElementById('previewVideo'),
  previewEmpty: document.getElementById('previewEmpty'),
  previewEmptyText: document.getElementById('previewEmptyText'),
  previewSpinner: document.getElementById('previewSpinner'),
  viewerList: document.getElementById('viewerList'),
  viewerCountBadge: document.getElementById('viewerCountBadge'),
  serverBadge: document.getElementById('serverBadge'),
  backBtn: document.getElementById('backBtn'),
  toast: document.getElementById('toast'),
  extendBadge: document.getElementById('extendBadge'),
  extendSetupWarning: document.getElementById('extendSetupWarning'),
  extendSetupBtn: document.getElementById('extendSetupBtn'),
  extendRefreshBtn: document.getElementById('extendRefreshBtn'),
  extendToggleBtn: document.getElementById('extendToggleBtn')
};

function showToast(message, type = '') {
  el.toast.textContent = message;
  el.toast.className = `toast show ${type}`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (el.toast.className = 'toast'), 3200);
}

function setServerBadge(status) {
  // status: 'offline' | 'online' | 'starting'
  el.serverBadge.className = `badge ${status === 'online' ? 'online' : status === 'starting' ? 'warning' : 'offline'}`;
  el.serverBadge.innerHTML = `<span class="dot ${status === 'starting' ? 'blink' : ''}"></span>${
    status === 'online' ? 'Server online' : status === 'starting' ? 'Starting…' : 'Server offline'
  }`;
}

function renderViewerList() {
  el.viewerCountBadge.textContent = String(state.viewers.size);
  if (state.viewers.size === 0) {
    el.viewerList.innerHTML = '<li class="empty">No viewers connected yet.</li>';
    return;
  }
  el.viewerList.innerHTML = '';
  for (const [id, v] of state.viewers) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="vdot"></span><span>${escapeHtml(v.name)}</span><span style="margin-left:auto;color:var(--text-2);font-size:11px">${id.slice(0, 6)}</span>`;
    el.viewerList.appendChild(li);
  }
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ---------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------
async function loadSources() {
  el.sourceGrid.innerHTML = '<div class="source-placeholder">Loading…</div>';
  try {
    const sources = await window.nexa.getSources();
    if (!sources.length) {
      el.sourceGrid.innerHTML = '<div class="source-placeholder">No sources found.</div>';
      return;
    }
    el.sourceGrid.innerHTML = '';
    sources.forEach((s) => {
      const div = document.createElement('div');
      div.className = 'source-item' + (s.id === state.selectedSourceId ? ' selected' : '');
      div.innerHTML = `<img src="${s.thumbnail}" alt=""/><div class="name">${escapeHtml(s.name)}</div>`;
      div.addEventListener('click', () => {
        state.selectedSourceId = s.id;
        document.querySelectorAll('.source-item').forEach((n) => n.classList.remove('selected'));
        div.classList.add('selected');
      });
      el.sourceGrid.appendChild(div);
    });
    if (!state.selectedSourceId && sources[0]) {
      state.selectedSourceId = sources[0].id;
      el.sourceGrid.firstChild.classList.add('selected');
    }
  } catch (err) {
    el.sourceGrid.innerHTML = '<div class="source-placeholder">Failed to load sources.</div>';
    showToast('Could not list screens/windows: ' + err.message, 'error');
  }
}

async function captureSelectedSource() {
  if (!state.selectedSourceId) throw new Error('No source selected');
  const constraints = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: state.selectedSourceId,
        maxFrameRate: 60
      }
    }
  };
  // eslint-disable-next-line no-undef
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  return stream;
}

// ---------------------------------------------------------------------
// Signaling + WebRTC
// ---------------------------------------------------------------------
function connectSignaling(ip, port) {
  // eslint-disable-next-line no-undef
  const socket = io(`http://${ip}:${port}`, {
    reconnection: true,
    reconnectionDelay: 800,
    reconnectionDelayMax: 4000,
    timeout: 8000
  });

  socket.on('connect', () => {
    socket.emit('role:host');
    setServerBadge('online');
  });

  socket.on('disconnect', () => {
    setServerBadge('starting');
  });

  socket.on('viewer:new', async ({ viewerId, name }) => {
    state.viewers.set(viewerId, { name });
    renderViewerList();
    await createPeerForViewer(viewerId);
  });

  socket.on('viewer:left', ({ viewerId }) => {
    teardownPeer(viewerId);
    state.viewers.delete(viewerId);
    renderViewerList();
  });

  socket.on('signal:answer', async ({ sdp, from }) => {
    const pc = state.peers.get(from);
    if (!pc) return;
    await pc.setRemoteDescription(sdp);
  });

  socket.on('signal:ice-candidate', async ({ candidate, from }) => {
    const pc = state.peers.get(from);
    if (!pc) return;
    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      console.warn('ICE add failed', err);
    }
  });

  return socket;
}

async function createPeerForViewer(viewerId) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  state.peers.set(viewerId, pc);

  if (state.localStream) {
    state.localStream.getTracks().forEach((track) => pc.addTrack(track, state.localStream));
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      state.socket.emit('signal:ice-candidate', { to: viewerId, candidate: event.candidate });
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (['failed', 'disconnected'].includes(pc.iceConnectionState)) {
      // Attempt one renegotiation before giving up on this viewer's link.
      pc.restartIce && pc.restartIce();
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  state.socket.emit('signal:offer', { to: viewerId, sdp: offer });
}

function teardownPeer(viewerId) {
  const pc = state.peers.get(viewerId);
  if (pc) {
    pc.close();
    state.peers.delete(viewerId);
  }
}

// ---------------------------------------------------------------------
// Start / Stop sharing
// ---------------------------------------------------------------------
async function startSharing() {
  if (!state.selectedSourceId) {
    showToast('Select a screen or window first.', 'error');
    return;
  }
  el.startBtn.disabled = true;
  el.previewSpinner.style.display = 'block';
  el.previewEmptyText.textContent = 'Starting…';
  setServerBadge('starting');

  try {
    state.localStream = await captureSelectedSource();
    el.previewVideo.srcObject = state.localStream;
    el.previewEmpty.style.display = 'none';

    const result = await window.nexa.startServer(4500);
    if (!result.ok) throw new Error(result.error || 'Failed to start server');

    state.serverInfo = { ip: result.ip, port: result.port };
    el.ipValue.textContent = result.ip;
    el.portValue.textContent = String(result.port);
    el.addressValue.textContent = `${result.ip}:${result.port}`;

    state.socket = connectSignaling(result.ip, result.port);

    state.localStream.getVideoTracks()[0].addEventListener('ended', stopSharing);

    state.sharing = true;
    el.stopBtn.disabled = false;
    showToast('Sharing started. Waiting for viewers…', 'success');
  } catch (err) {
    showToast('Failed to start sharing: ' + err.message, 'error');
    setServerBadge('offline');
    el.previewEmpty.style.display = 'flex';
    el.previewEmptyText.textContent = 'No active share';
    el.startBtn.disabled = false;
  } finally {
    el.previewSpinner.style.display = 'none';
  }
}

async function stopSharing() {
  el.stopBtn.disabled = true;

  if (state.localStream) {
    state.localStream.getTracks().forEach((t) => t.stop());
    state.localStream = null;
  }
  el.previewVideo.srcObject = null;
  el.previewEmpty.style.display = 'flex';
  el.previewEmptyText.textContent = 'No active share';

  for (const id of Array.from(state.peers.keys())) teardownPeer(id);
  state.viewers.clear();
  renderViewerList();

  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }
  await window.nexa.stopServer();
  setServerBadge('offline');

  state.sharing = false;
  el.startBtn.disabled = false;
  showToast('Sharing stopped.');
}

// ---------------------------------------------------------------------
// Extend Mode (virtual "Screen 2" via bundled driver)
// ---------------------------------------------------------------------
async function refreshExtendStatus() {
  let status;
  try {
    status = await window.nexa.extendModeStatus();
  } catch (err) {
    el.extendBadge.textContent = 'Unavailable';
    el.extendBadge.className = 'badge offline';
    el.extendSetupBtn.disabled = true;
    el.extendToggleBtn.disabled = true;
    return;
  }

  state.extend.active = status.active;
  el.extendToggleBtn.textContent = status.active ? '■ Disable Extend Mode' : '▣ Enable Extend Mode';
  el.extendBadge.textContent = status.active ? 'Active' : 'Off';
  el.extendBadge.className = `badge ${status.active ? 'online' : ''}`;

  if (!status.scriptsPresent) {
    el.extendSetupWarning.style.display = 'block';
    el.extendSetupWarning.textContent =
      'Driver control scripts not found. Copy the "Community Scripts" folder from the driver release into /driver/scripts (see README).';
    el.extendSetupBtn.textContent = '⚙ Set Up Driver';
    el.extendSetupBtn.disabled = true;
    el.extendToggleBtn.disabled = true;
    return;
  }

  if (!status.installed) {
    el.extendSetupWarning.style.display = 'block';
    el.extendSetupWarning.textContent =
      'Driver not installed yet (or already installed manually via the VDC app — click Refresh if you just did).';
    el.extendSetupBtn.textContent = '⚙ Install Driver (Admin)';
    el.extendSetupBtn.disabled = false;
    el.extendToggleBtn.disabled = true;
    return;
  }

  el.extendSetupWarning.style.display = 'none';
  el.extendSetupBtn.textContent = '⚙ Driver Ready';
  el.extendSetupBtn.disabled = true;
  el.extendToggleBtn.disabled = state.sharing && !status.active; // avoid toggling mid-share into a new source
}

async function runExtendSetupStep() {
  el.extendSetupBtn.disabled = true;
  try {
    const result = await window.nexa.extendModeInstallDriver();
    if (!result.ok) throw new Error(result.error);
    showToast('Driver installed.', 'success');
  } catch (err) {
    showToast('Setup step failed: ' + err.message, 'error');
  } finally {
    await refreshExtendStatus();
  }
}

async function toggleExtendMode() {
  el.extendToggleBtn.disabled = true;
  try {
    if (!state.extend.active) {
      const result = await window.nexa.extendModeEnable({ width: 1920, height: 1080, refreshHz: 60 });
      if (!result.ok) throw new Error(result.error);
      state.extend.active = true;
      state.extend.displayId = result.displayId;

      const source = await window.nexa.getSourceForDisplay(result.displayId);
      if (source) {
        state.selectedSourceId = source.id;
        await loadSources(); // refresh grid so the new virtual screen shows as selectable/selected
      }
      showToast('Virtual Screen 2 created. Click "Start Sharing" to broadcast it.', 'success');
    } else {
      if (state.sharing) await stopSharing();
      const result = await window.nexa.extendModeDisable();
      if (!result.ok) throw new Error(result.error);
      state.extend.active = false;
      state.extend.displayId = null;
      showToast('Extend Mode disabled.');
    }
  } catch (err) {
    showToast('Extend Mode error: ' + err.message, 'error');
  } finally {
    await refreshExtendStatus();
  }
}

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------
el.refreshBtn.addEventListener('click', loadSources);
el.startBtn.addEventListener('click', startSharing);
el.stopBtn.addEventListener('click', stopSharing);
el.extendSetupBtn.addEventListener('click', runExtendSetupStep);
el.extendRefreshBtn.addEventListener('click', refreshExtendStatus);
el.extendToggleBtn.addEventListener('click', toggleExtendMode);
el.backBtn.addEventListener('click', async () => {
  if (state.sharing) await stopSharing();
  if (state.extend.active) await window.nexa.extendModeDisable().catch(() => {});
  await window.nexa.navigate('launcher.html');
});

window.addEventListener('beforeunload', () => {
  if (state.sharing) stopSharing();
});

(async () => {
  const ip = await window.nexa.getLocalIP();
  el.ipValue.textContent = ip;
  await loadSources();
  await refreshExtendStatus();
})();
