// Download interception (Phase 3).
//
// Two complementary mechanisms, both gated by settings + the exclusion list:
//   1. declarativeNetRequest dynamic rules redirect top-level navigations to Office files — by
//      URL extension, and (on Chrome that supports responseHeaders conditions) by response
//      Content-Type — straight to the viewer, so the download never starts.
//   2. A chrome.downloads safety-net catches Office downloads that slip past DNR (e.g. an
//      extensionless URL with an unhelpful Content-Type), cancels them, and opens the viewer.
//
// The viewer re-fetches the bytes from its (CORS-exempt) extension origin with credentials, so
// cookie-gated files keep working. blob:/data: downloads are left alone (can't be re-fetched),
// which also means the viewer's own "Download" button is never intercepted.

import {
  SETTINGS_KEY,
  INTERCEPT_EXTENSIONS,
  INTERCEPT_MIME_TYPES,
  HEADER_MATCH_MIME_TYPES,
  EXCLUDED_DOMAINS,
} from '../common/constants.js';
import { readSettings } from '../common/settings.js';

const RULE_EXT = 1; // URL-extension redirect
const RULE_HEADER = 2; // response Content-Type redirect

// ---- Pure helpers (unit-tested in test/interception.test.mjs) ----

/** DNR/JS regex matching an http(s) URL whose path ends in one of the given extensions. */
export function officeUrlPattern(exts) {
  return `^(https?:\\/\\/[^?#]+\\.(?:${exts.join('|')})(?:[?#].*)?)$`;
}

/** True if `host` equals or is a subdomain of any excluded/disabled domain. */
export function isExcludedHost(host, excluded) {
  const h = (host || '').toLowerCase();
  return excluded.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Best-effort lowercase extension from a download's suggested filename, else its URL path. */
export function extFromUrlOrFilename(url, filename = '') {
  const name = /\.([a-z0-9]+)$/i.exec(String(filename).split(/[?#]/)[0]);
  if (name) return name[1].toLowerCase();
  try {
    const m = /\.([a-z0-9]+)$/i.exec(new URL(url).pathname);
    if (m) return m[1].toLowerCase();
  } catch {
    /* not a parseable URL */
  }
  return '';
}

// ---- Rule construction / application ----

function viewerUrlFor(originalUrl) {
  return `${chrome.runtime.getURL('viewer/viewer.html')}?src=${encodeURIComponent(originalUrl)}`;
}

function buildRules(excluded, useResponseHeaders) {
  const substitution = `${chrome.runtime.getURL('viewer/viewer.html')}?src=\\1`;
  const shared = {
    resourceTypes: ['main_frame'],
    excludedInitiatorDomains: excluded,
    excludedRequestDomains: excluded,
  };
  const rules = [
    {
      id: RULE_EXT,
      priority: 1,
      action: { type: 'redirect', redirect: { regexSubstitution: substitution } },
      condition: { ...shared, regexFilter: officeUrlPattern(INTERCEPT_EXTENSIONS) },
    },
  ];
  if (useResponseHeaders) {
    rules.push({
      id: RULE_HEADER,
      priority: 1,
      action: { type: 'redirect', redirect: { regexSubstitution: substitution } },
      condition: {
        ...shared,
        regexFilter: '^(https?:\\/\\/.*)$',
        responseHeaders: [{ header: 'content-type', values: HEADER_MATCH_MIME_TYPES.map((m) => `${m}*`) }],
      },
    });
  }
  return rules;
}

async function applyRules() {
  const settings = await readSettings();
  const current = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = current.map((r) => r.id);

  if (!settings.interceptionEnabled) {
    if (removeRuleIds.length) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
    return;
  }

  const excluded = [...EXCLUDED_DOMAINS, ...(settings.disabledSites || [])];
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules: buildRules(excluded, true),
    });
  } catch (err) {
    // Older Chrome without responseHeaders conditions: fall back to URL-extension rules only
    // (extensionless downloads are then caught by the downloads safety-net instead).
    console.warn('[DocViewer] responseHeaders DNR unsupported; URL-extension rules only.', err);
    const stale = (await chrome.declarativeNetRequest.getDynamicRules()).map((r) => r.id);
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: stale,
      addRules: buildRules(excluded, false),
    });
  }
}

const OFFICE_MIME_SET = new Set(INTERCEPT_MIME_TYPES.map((m) => m.toLowerCase()));

async function onDownloadCreated(item) {
  try {
    const settings = await readSettings();
    if (!settings.interceptionEnabled) return;

    const url = item.finalUrl || item.url || '';
    if (!/^https?:/i.test(url)) return; // skip blob:, data:, file:

    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      return;
    }
    if (isExcludedHost(host, [...EXCLUDED_DOMAINS, ...(settings.disabledSites || [])])) return;

    const ext = extFromUrlOrFilename(url, item.filename);
    const mime = (item.mime || '').toLowerCase();
    if (!INTERCEPT_EXTENSIONS.includes(ext) && !OFFICE_MIME_SET.has(mime)) return;

    await chrome.downloads.cancel(item.id).catch(() => {});
    await chrome.downloads.erase({ id: item.id }).catch(() => {});
    await chrome.tabs.create({ url: viewerUrlFor(url) });
  } catch (err) {
    console.warn('[DocViewer] download interception failed:', err);
  }
}

/** Register event listeners. Called at service-worker top level so it runs on every SW wake. */
export function registerListeners() {
  chrome.downloads.onCreated.addListener(onDownloadCreated);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[SETTINGS_KEY]) applyRules();
  });
}

export { applyRules };
