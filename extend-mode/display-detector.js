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

/** Call after adding a virtual monitor. Polls for up to ~50 seconds by
 *  default, since enabling the driver can trigger a UAC prompt the user
 *  has to click through by hand - a short fixed retry window isn't
 *  enough to cover that human-reaction-time gap. */
async function findNewDisplay(beforeIds, { retries = 100, delayMs = 500 } = {}) {
  for (let i = 0; i < retries; i++) {
    const after = screen.getAllDisplays();
    const found = after.find((d) => !beforeIds.includes(d.id));
    if (found) return found;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

module.exports = { snapshotDisplayIds, findNewDisplay };
