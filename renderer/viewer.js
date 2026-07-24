'use strict';

/**
 * NexaScreen - viewer.js
 * Connects to a Host's signaling server, negotiates a single WebRTC
 * peer connection to receive its screen, and renders it full-bleed with
 * automatic reconnect if the host or network drops.
 */

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

const state = {
  socket: null,
  pc: null,
  hostIp: null,
  hostPort: null,
  connected: false,
  reconnectAttempt: 0,
  manualDisconnect: false
};

const el = {
  connectCard: document.getElementById('connectCard'),
  streamWrap: document.getElementById('streamWrap'),
  hostIpInput: document.getElementById('hostIpInput'),
  hostPortInput: document.getElementById('hostPortInput'),
  connectBtn: document.getElementById('connectBtn'),
  errorMsg: document.getElementById('errorMsg'),
  remoteVideo: document.getElementById('remoteVideo'),
  streamOverlay: document.getElementById('streamOverlay'),
  overlayText: document.getElementById('overlayText'),
  connBadge: document.getElementById('connBadge'),
  fullscreenBtn: document.getElementById('fullscreenBtn'),
  disconnectBtn: document.getElementById('disconnectBtn'),
  backBtn: document.getElementById('backBtn'),
  titlebar: document.getElementById('titlebar'),
  toast: document.getElementById('toast')
};

function showToast(message, type = '') {
  el.toast.textContent = message;
  el.toast.className = `toast show ${type}`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (el.toast.className = 'toast'), 3200);
}

function setBadge(status, label) {
  el.connBadge.className = `badge ${status}`;
  el.connBadge.innerHTML = `<span class="dot ${status === 'warning' ? 'blink' : ''}"></span>${label}`;
}

function setOverlay(visible, text) {
  if (text) el.overlayText.textContent = text;
  el.streamOverlay.classList.toggle('hidden', !visible);
}

function isValidIp(ip) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip.trim()) || /^[a-zA-Z0-9.-]+$/.test(ip.trim());
}

// ---------------------------------------------------------------------
// Connect / signaling
// ---------------------------------------------------------------------
function connect() {
  const ip = el.hostIpInput.value.trim();
  const port = el.hostPortInput.value.trim() || '4500';

  if (!ip || !isValidIp(ip)) {
    el.errorMsg.textContent = 'Please enter a valid host IP address.';
    return;
  }
  if (!/^\d{2,5}$/.test(port)) {
    el.errorMsg.textContent = 'Please enter a valid port number.';
    return;
  }

  el.errorMsg.textContent = '';
  state.hostIp = ip;
  state.hostPort = port;
  state.manualDisconnect = false;

  el.connectCard.style.display = 'none';
  el.streamWrap.style.display = 'flex';
  setOverlay(true, 'Connecting…');
  setBadge('warning', 'Connecting…');

  openSocket();
}

function openSocket() {
  if (state.socket) state.socket.disconnect();

  // eslint-disable-next-line no-undef
  const socket = io(`http://${state.hostIp}:${state.hostPort}`, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 8000
  });
  state.socket = socket;

  socket.on('connect', () => {
    state.reconnectAttempt = 0;
    socket.emit('role:viewer', { name: 'NexaScreen Viewer' });
    setBadge('warning', 'Waiting for stream…');
    setOverlay(true, 'Connected. Waiting for host stream…');
  });

  socket.on('connect_error', () => {
    setBadge('offline', 'Connection failed');
    setOverlay(true, 'Could not reach host. Retrying…');
  });

  socket.on('disconnect', () => {
    state.connected = false;
    teardownPeer();
    if (!state.manualDisconnect) {
      setBadge('warning', 'Reconnecting…');
      setOverlay(true, 'Connection lost. Reconnecting…');
    }
  });

  socket.on('host:disconnected', () => {
    setBadge('warning', 'Host stopped sharing');
    setOverlay(true, 'Host stopped sharing. Waiting for it to resume…');
    teardownPeer();
  });

  socket.on('signal:offer', async ({ sdp, from }) => {
    await handleOffer(sdp, from);
  });

  socket.on('signal:ice-candidate', async ({ candidate }) => {
    if (!state.pc) return;
    try {
      await state.pc.addIceCandidate(candidate);
    } catch (err) {
      console.warn('ICE add failed', err);
    }
  });
}

async function handleOffer(sdp, hostSocketId) {
  teardownPeer();
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  state.pc = pc;

  pc.ontrack = (event) => {
    el.remoteVideo.srcObject = event.streams[0];
    setOverlay(false);
    setBadge('online', 'Connected');
    state.connected = true;
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      state.socket.emit('signal:ice-candidate', { to: hostSocketId, candidate: event.candidate });
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
      setBadge('warning', 'Reconnecting…');
      setOverlay(true, 'Stream interrupted. Reconnecting…');
    }
  };

  await pc.setRemoteDescription(sdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  state.socket.emit('signal:answer', { to: hostSocketId, sdp: answer });
}

function teardownPeer() {
  if (state.pc) {
    state.pc.close();
    state.pc = null;
  }
  el.remoteVideo.srcObject = null;
}

function disconnect() {
  state.manualDisconnect = true;
  teardownPeer();
  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }
  el.streamWrap.style.display = 'none';
  el.connectCard.style.display = 'block';
  setBadge('offline', 'Disconnected');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------
el.connectBtn.addEventListener('click', connect);
el.hostIpInput.addEventListener('keydown', (e) => e.key === 'Enter' && connect());
el.disconnectBtn.addEventListener('click', disconnect);

el.fullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.getElementById('appShell').requestFullscreen().catch(() => {});
    el.titlebar.style.display = 'none';
  } else {
    document.exitFullscreen().catch(() => {});
  }
});

document.addEventListener('fullscreenchange', () => {
  el.titlebar.style.display = document.fullscreenElement ? 'none' : 'flex';
});

el.backBtn.addEventListener('click', async () => {
  disconnect();
  await window.nexa.navigate('launcher.html');
});

window.addEventListener('beforeunload', () => {
  state.manualDisconnect = true;
  if (state.socket) state.socket.disconnect();
});
