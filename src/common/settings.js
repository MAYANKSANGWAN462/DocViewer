// Shared settings access (used by the service worker and popup).
import { SETTINGS_KEY, DEFAULT_SETTINGS } from './constants.js';

export async function readSettings() {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
}

export async function writeSettings(patch) {
  const next = { ...(await readSettings()), ...patch };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}
