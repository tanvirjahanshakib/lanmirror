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
  sharing: false
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
  toast: document.getElementById('toast')
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
// Wiring
// ---------------------------------------------------------------------
el.refreshBtn.addEventListener('click', loadSources);
el.startBtn.addEventListener('click', startSharing);
el.stopBtn.addEventListener('click', stopSharing);
el.backBtn.addEventListener('click', async () => {
  if (state.sharing) await stopSharing();
  await window.nexa.navigate('launcher.html');
});

window.addEventListener('beforeunload', () => {
  if (state.sharing) stopSharing();
});

(async () => {
  const ip = await window.nexa.getLocalIP();
  el.ipValue.textContent = ip;
  await loadSources();
})();
