// DocViewer background service worker.
//
// Keep this thin and event-driven — MV3 service workers are ephemeral, so no large buffers or
// long-lived state live here; all file fetching/parsing happens in the viewer tab. The download
// interception logic lives in interception.js.

import { SETTINGS_KEY, DEFAULT_SETTINGS } from '../common/constants.js';
import { registerListeners, applyRules } from './interception.js';

// Register listeners synchronously at top level so the worker wakes for their events.
registerListeners();

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) {
    await chrome.storage.sync.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  }
  await applyRules();
  console.info(`[DocViewer] ${reason}: download interception active.`);
});

chrome.runtime.onStartup.addListener(() => {
  applyRules();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'ping') {
    sendResponse({ ok: true, phase: 3 });
  }
  return false; // synchronous response only
});
