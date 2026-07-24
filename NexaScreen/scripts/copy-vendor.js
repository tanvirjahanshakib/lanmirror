/**
 * scripts/copy-vendor.js
 * -----------------------------------------------------------------------
 * Renderer pages are loaded with loadFile() (file:// origin), so they
 * cannot fetch a server-hosted "/socket.io/socket.io.js". Instead, this
 * script copies the socket.io-client browser bundle from node_modules
 * into renderer/vendor/ at install time, so it can be included as a
 * plain local <script> tag.
 *
 * Runs automatically via the "postinstall" npm script.
 * -----------------------------------------------------------------------
 */

'use strict';

const fs = require('fs');
const path = require('path');

const candidates = [
  path.join(__dirname, '..', 'node_modules', 'socket.io-client', 'dist', 'socket.io.min.js'),
  path.join(__dirname, '..', 'node_modules', 'socket.io-client', 'dist', 'socket.io.js')
];

const destDir = path.join(__dirname, '..', 'renderer', 'vendor');
const destFile = path.join(destDir, 'socket.io.min.js');

function main() {
  const source = candidates.find((p) => fs.existsSync(p));
  if (!source) {
    console.warn('[copy-vendor] socket.io-client browser bundle not found. Run "npm install" first.');
    return;
  }
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(source, destFile);
  console.log(`[copy-vendor] Copied ${path.basename(source)} -> renderer/vendor/socket.io.min.js`);
}

main();
