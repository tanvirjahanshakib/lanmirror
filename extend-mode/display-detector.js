/**
 * NexaScreen - extend-mode/display-detector.js
 * -----------------------------------------------------------------------
 * Electron's screen.getAllDisplays() doesn't flag which display is
 * "virtual" - so we snapshot the display list right before asking the
 * driver to add a monitor, then diff after, to find the new one.
 * -----------------------------------------------------------------------
 */

'use strict';

const { screen } = require('electron');

function snapshotDisplayIds() {
  return screen.getAllDisplays().map((d) => d.id);
}

/** Call after adding a virtual monitor. Retries briefly since Windows
 *  can take a moment to enumerate the new display. */
async function findNewDisplay(beforeIds, { retries = 6, delayMs = 300 } = {}) {
  for (let i = 0; i < retries; i++) {
    const after = screen.getAllDisplays();
    const found = after.find((d) => !beforeIds.includes(d.id));
    if (found) return found;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

module.exports = { snapshotDisplayIds, findNewDisplay };
