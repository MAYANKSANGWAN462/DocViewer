// Popup UI: global interception toggle + per-site opt-out for the current tab, plus a manual
// "Open viewer" button. Writing settings triggers the service worker to rebuild its DNR rules.

import { readSettings, writeSettings } from '../common/settings.js';

const globalToggle = document.getElementById('toggle-interception');
const siteRow = document.getElementById('site-row');
const siteToggle = document.getElementById('toggle-site');
const siteHost = document.getElementById('site-host');
const openBtn = document.getElementById('btn-open-viewer');
const rendererSelect = document.getElementById('pptx-renderer');
const bakeoffBtn = document.getElementById('btn-bakeoff');
const savedNote = document.getElementById('popup-saved');

let currentHost = '';

let savedTimer;
/** Briefly confirm a settings write so the change doesn't feel silent. */
function showSaved() {
  if (!savedNote) return;
  savedNote.classList.add('is-visible');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => savedNote.classList.remove('is-visible'), 1500);
}

async function activeHost() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && /^https?:/i.test(tab.url)) return new URL(tab.url).hostname;
  } catch {
    /* no host permission for this tab, or an internal page */
  }
  return '';
}

async function init() {
  const settings = await readSettings();
  globalToggle.checked = Boolean(settings.interceptionEnabled);
  rendererSelect.value = settings.pptxRenderer || 'ordalie';

  currentHost = await activeHost();
  if (currentHost) {
    siteHost.textContent = currentHost;
    siteToggle.checked = (settings.disabledSites || []).includes(currentHost);
    siteRow.hidden = false;
  }
}

globalToggle.addEventListener('change', () => {
  writeSettings({ interceptionEnabled: globalToggle.checked }).then(showSaved);
});

siteToggle.addEventListener('change', async () => {
  const settings = await readSettings();
  const set = new Set(settings.disabledSites || []);
  if (siteToggle.checked) set.add(currentHost);
  else set.delete(currentHost);
  await writeSettings({ disabledSites: [...set] });
  showSaved();
});

openBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('viewer/viewer.html') });
});

rendererSelect.addEventListener('change', () => {
  writeSettings({ pptxRenderer: rendererSelect.value }).then(showSaved);
});

bakeoffBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('viewer/bakeoff.html') });
});

init();
