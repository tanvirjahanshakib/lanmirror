/**
 * NexaScreen - server/server.js
 * -----------------------------------------------------------------------
 * Lightweight local-only signaling server. It never touches video/audio
 * data itself - that flows peer-to-peer over WebRTC once negotiated. The
 * server's only job is to relay signaling messages (join, offer, answer,
 * ICE candidates) between exactly one Host and any number of Viewers on
 * the same LAN, plus serve the static "connect" landing page for viewers
 * that connect through a plain browser.
 *
 * No internet access, no external database, no accounts. Everything is
 * held in memory and destroyed when the server stops.
 * -----------------------------------------------------------------------
 */

'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

/** Basic runtime schema validation - keeps payloads small and well-formed. */
function isValidRTCPayload(type, data) {
  if (!data || typeof data !== 'object') return false;
  switch (type) {
    case 'signal:offer':
    case 'signal:answer':
      return typeof data.sdp === 'object' && data.sdp !== null && typeof data.to === 'string';
    case 'signal:ice-candidate':
      return typeof data.candidate === 'object' && data.candidate !== null && typeof data.to === 'string';
    default:
      return false;
  }
}

function createServer(port, hooks = {}) {
  const { onViewerCountChange = () => {}, onViewerEvent = () => {} } = hooks;

  return new Promise((resolve, reject) => {
    const app = express();
    const httpServer = http.createServer(app);
    const io = new Server(httpServer, {
      cors: { origin: '*' }, // LAN-only server; no auth/cloud exposure by design
      maxHttpBufferSize: 1e6
    });

    // Minimal static page so a plain browser hitting http://HOST:PORT/
    // gets a friendly response instead of a 404 (Electron viewer connects
    // via Socket.IO directly, not through this page).
    app.get('/', (_req, res) => {
      res.type('html').send(
        '<html><body style="background:#0b0d12;color:#e6e8ee;font-family:sans-serif;' +
          'display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
          '<div><h2>NexaScreen host is running</h2>' +
          '<p>Connect from the NexaScreen Viewer app using this PC\'s IP address.</p></div>' +
          '</body></html>'
      );
    });

    app.get('/health', (_req, res) => res.json({ ok: true }));

    /** hostSocketId: the single Host connection currently sharing. */
    let hostSocketId = null;
    /** Map<viewerSocketId, { id, connectedAt }> */
    const viewers = new Map();

    io.on('connection', (socket) => {
      socket.on('role:host', () => {
        hostSocketId = socket.id;
        socket.join('host');
        onViewerEvent({ type: 'host-connected', id: socket.id });
      });

      socket.on('role:viewer', (meta) => {
        const safeName =
          meta && typeof meta.name === 'string' ? meta.name.slice(0, 40) : 'Viewer';
        viewers.set(socket.id, { id: socket.id, name: safeName, connectedAt: Date.now() });
        socket.join('viewers');
        onViewerCountChange(viewers.size);
        onViewerEvent({ type: 'viewer-joined', id: socket.id, name: safeName });

        // Tell the host a new viewer wants a stream.
        if (hostSocketId) {
          io.to(hostSocketId).emit('viewer:new', { viewerId: socket.id, name: safeName });
        }
      });

      // --- WebRTC signaling relay (validated, targeted) -----------------
      socket.on('signal:offer', (data) => {
        if (!isValidRTCPayload('signal:offer', data)) return;
        io.to(data.to).emit('signal:offer', { sdp: data.sdp, from: socket.id });
      });

      socket.on('signal:answer', (data) => {
        if (!isValidRTCPayload('signal:answer', data)) return;
        io.to(data.to).emit('signal:answer', { sdp: data.sdp, from: socket.id });
      });

      socket.on('signal:ice-candidate', (data) => {
        if (!isValidRTCPayload('signal:ice-candidate', data)) return;
        io.to(data.to).emit('signal:ice-candidate', { candidate: data.candidate, from: socket.id });
      });

      socket.on('viewer:leaving', () => {
        cleanupViewer(socket.id);
      });

      socket.on('disconnect', () => {
        if (socket.id === hostSocketId) {
          hostSocketId = null;
          onViewerEvent({ type: 'host-disconnected' });
          io.to('viewers').emit('host:disconnected');
        } else if (viewers.has(socket.id)) {
          cleanupViewer(socket.id);
        }
      });

      function cleanupViewer(id) {
        if (!viewers.has(id)) return;
        viewers.delete(id);
        onViewerCountChange(viewers.size);
        onViewerEvent({ type: 'viewer-left', id });
        if (hostSocketId) io.to(hostSocketId).emit('viewer:left', { viewerId: id });
      }
    });

    httpServer.on('error', (err) => reject(err));
    httpServer.listen(port, '0.0.0.0', () => {
      resolve({ httpServer, io, port });
    });
  });
}

function stopServer(instance) {
  return new Promise((resolve) => {
    if (!instance) return resolve();
    instance.io.disconnectSockets(true);
    instance.io.close(() => {
      instance.httpServer.close(() => resolve());
    });
  });
}

module.exports = { createServer, stopServer };
