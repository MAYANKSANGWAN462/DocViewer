// DocViewer viewer orchestrator.
//
// Responsibilities: accept a document (via ?src= URL, file picker, or drag & drop), detect its
// format, run heavy parsing in a Web Worker, route to the right renderer, and manage the
// toolbar / loading / error / size-cap UI. The Download button is always backed by the original
// bytes so the user can save the file at any time.

import { sniffType } from './typeSniff.js';
import { getRenderer } from './renderers/router.js';
import { FORMATS, MIME_TO_FORMAT, SIZE_WARN_BYTES, SIZE_HARD_CAP_BYTES } from '../common/constants.js';
import { readSettings } from '../common/settings.js';
import { openInMaxFidelity } from './renderers/wasm-office.js';

const $ = (id) => document.getElementById(id);
const el = {
  filename: $('filename'),
  typeBadge: $('type-badge'),
  btnOpen: $('btn-open'),
  btnPick: $('btn-pick'),
  btnOpenOriginal: $('btn-open-original'),
  btnMaxFidelity: $('btn-max-fidelity'),
  btnDownload: $('btn-download'),
  zoomControls: $('zoom-controls'),
  btnZoomOut: $('btn-zoom-out'),
  btnZoomIn: $('btn-zoom-in'),
  btnZoomLevel: $('btn-zoom-level'),
  btnZoomFit: $('btn-zoom-fit'),
  fileInput: $('file-input'),
  stage: $('stage'),
  dropzone: $('dropzone'),
  content: $('content'),
  loading: $('loading'),
  loadingText: $('loading-text'),
  sizeWarn: $('size-warn'),
  sizeWarnText: $('size-warn-text'),
  btnRenderAnyway: $('btn-render-anyway'),
  btnCancelRender: $('btn-cancel-render'),
  error: $('error'),
  errorTitle: $('error-title'),
  errorText: $('error-text'),
  btnErrorDownload: $('btn-error-download'),
  btnErrorOpen: $('btn-error-open'),
};

/** @type {{blob: Blob|null, filename: string, format: string, srcUrl: string|null, viewer: any}} */
const state = { blob: null, filename: '', format: 'unknown', srcUrl: null, viewer: null };

// --------------------------------------------------------------------------
// Parse worker (single shared instance; requests correlated by id)
// --------------------------------------------------------------------------
// Formats parsed off-thread in the worker. DOM-building renderers (docx) run on the main thread.
const WORKER_PARSED = new Set(['xlsx', 'xls', 'csv']);

let worker = null;
let workerSeq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  // Reference the built worker by its extension path (avoids esbuild rewriting new URL()).
  worker = new Worker(chrome.runtime.getURL('viewer/workers/parse.worker.js'), { type: 'module' });
  worker.onmessage = (e) => {
    const { id, ok, result, error } = e.data || {};
    const resolver = pending.get(id);
    if (!resolver) return;
    pending.delete(id);
    if (ok) resolver.resolve(result);
    else resolver.reject(new Error(error));
  };
  worker.onerror = (e) => {
    for (const { reject } of pending.values()) reject(new Error(e.message || 'parse worker error'));
    pending.clear();
  };
  return worker;
}

function parseInWorker(blob, format) {
  const id = ++workerSeq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, blob, format });
  });
}

// --------------------------------------------------------------------------
// View-state helpers
// --------------------------------------------------------------------------
function hideAll() {
  for (const node of [el.dropzone, el.content, el.loading, el.sizeWarn, el.error]) node.hidden = true;
  el.zoomControls.hidden = true; // zoom bar only applies to a live PPTX view
}

/** Tear down a previously rendered viewer (observers/workers) and hide its zoom controls. */
function teardownViewer() {
  if (state.viewer && typeof state.viewer.destroy === 'function') {
    try {
      state.viewer.destroy();
    } catch {
      /* best effort */
    }
  }
  state.viewer = null;
  el.zoomControls.hidden = true;
}
function showLoading(text = 'Loading…') {
  hideAll();
  el.loadingText.textContent = text;
  el.loading.hidden = false;
}
function showDropzone() {
  hideAll();
  el.dropzone.hidden = false;
}
function showError(title, message, { allowDownload = true, allowOpen = false } = {}) {
  hideAll();
  el.errorTitle.textContent = title;
  el.errorText.textContent = message;
  el.btnErrorDownload.hidden = !(allowDownload && state.blob);
  el.btnErrorOpen.hidden = !(allowOpen && state.srcUrl);
  el.error.hidden = false;
}

// --------------------------------------------------------------------------
// Download / metadata
// --------------------------------------------------------------------------
function triggerDownload() {
  if (!state.blob) return;
  const url = URL.createObjectURL(state.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = state.filename || 'document';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function setActiveFile(blob, filename, format) {
  state.blob = blob;
  state.filename = filename;
  state.format = format;
  el.filename.textContent = filename || '(untitled)';
  const meta = FORMATS[format];
  el.typeBadge.textContent = meta ? meta.label : (format || 'file').toUpperCase();
  el.typeBadge.hidden = false;
  el.btnDownload.disabled = !blob;
  el.btnOpenOriginal.hidden = !state.srcUrl;
}

function formatBytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

// --------------------------------------------------------------------------
// Core pipeline
// --------------------------------------------------------------------------
async function handleBlob(blob, filename, mimeHint) {
  try {
    showLoading('Inspecting…');
    const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    const sniff = sniffType(head, filename);
    // Extensionless sources (content-disposition downloads, blob: URLs) can't be subtyped from
    // bytes alone; fall back to the server/OS-provided MIME when the extension didn't resolve one.
    if (sniff.format === 'unknown' && !sniff.isPdf && mimeHint) {
      const m = mimeHint.split(';')[0].trim().toLowerCase();
      if (MIME_TO_FORMAT[m]) sniff.format = MIME_TO_FORMAT[m];
    }
    setActiveFile(blob, filename, sniff.format);

    if (sniff.isPdf) {
      showError(
        'PDF detected',
        'PDFs open in Chrome’s built-in viewer — DocViewer does not handle them. Use the Download button to save a copy.',
        { allowDownload: true },
      );
      return;
    }

    if (blob.size > SIZE_HARD_CAP_BYTES) {
      showError(
        'File too large',
        `This file is ${formatBytes(blob.size)}, above the ${formatBytes(SIZE_HARD_CAP_BYTES)} in-tab limit. Please download it instead.`,
      );
      return;
    }

    if (blob.size > SIZE_WARN_BYTES) {
      const proceed = await confirmLargeFile(blob.size);
      if (!proceed) {
        showDropzone();
        return;
      }
    }

    await renderActive(sniff);
  } catch (err) {
    console.error('[DocViewer] handleBlob failed', err);
    showError('Could not open file', String(err?.message || err));
  }
}

function confirmLargeFile(size) {
  return new Promise((resolve) => {
    hideAll();
    el.sizeWarnText.textContent = `This file is ${formatBytes(size)}. Rendering large files can be slow and memory-heavy. Render it anyway?`;
    el.sizeWarn.hidden = false;
    const done = (value) => {
      el.btnRenderAnyway.onclick = null;
      el.btnCancelRender.onclick = null;
      resolve(value);
    };
    el.btnRenderAnyway.onclick = () => done(true);
    el.btnCancelRender.onclick = () => done(false);
  });
}

const MAX_FIDELITY_FORMATS = new Set(['pptx', 'docx', 'doc', 'ppt']);

/** Remove active-content vectors from renderer output (defense-in-depth; CSP already blocks JS). */
function scrubDangerous(root) {
  root.querySelectorAll('script, object, embed').forEach((n) => n.remove());
  root.querySelectorAll('iframe').forEach((f) => {
    f.setAttribute('sandbox', '');
    const src = f.getAttribute('src') || '';
    if (src && !/^(blob:|data:)/i.test(src)) f.removeAttribute('src');
  });
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.currentNode; node; node = walker.nextNode()) {
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) node.removeAttribute(attr.name);
      else if (/^(href|src|xlink:href)$/.test(name) && /^\s*javascript:/i.test(attr.value)) {
        node.removeAttribute(attr.name);
      }
    }
  }
}

/** Reveal the Max-fidelity button only for formats where it helps, and only when enabled. */
async function maybeShowMaxFidelity(format) {
  if (!MAX_FIDELITY_FORMATS.has(format)) {
    el.btnMaxFidelity.hidden = true;
    return;
  }
  try {
    el.btnMaxFidelity.hidden = !(await readSettings()).maxFidelity?.enabled;
  } catch {
    el.btnMaxFidelity.hidden = true;
  }
}

async function renderActive(sniff) {
  // Render into a VISIBLE content stage with the spinner overlaid on top (the overlay is
  // absolutely positioned over the stage). Renderers that scale to fit — PPTX fit-to-width and
  // the virtualized grid — must measure a real clientWidth; a hidden (display:none) container
  // measures 0, which makes slides render at the wrong size and triggers re-layout churn once
  // the container is finally shown.
  teardownViewer();
  hideAll();
  el.content.replaceChildren();
  el.content.hidden = false;
  el.loadingText.textContent = `Rendering ${FORMATS[sniff.format]?.label || 'document'}…`;
  el.loading.hidden = false;

  let parsed = null;
  if (WORKER_PARSED.has(sniff.format)) {
    try {
      parsed = await parseInWorker(state.blob, sniff.format);
    } catch (err) {
      console.warn('[DocViewer] parse worker failed (continuing to renderer):', err);
    }
  }
  const render = getRenderer(sniff.format);
  let controller = null;
  try {
    controller = await render(el.content, {
      blob: state.blob,
      filename: state.filename,
      sniff,
      parsed,
      scrollContainer: el.stage, // the real scroll ancestor; used by the PPTX windowed renderer
      onFirstPaint: () => (el.loading.hidden = true), // drop the overlay the moment content appears
    });
  } finally {
    el.loading.hidden = true; // content is already visible — just drop the overlay
  }
  scrubDangerous(el.content);
  setupViewerControls(controller);
  await maybeShowMaxFidelity(sniff.format);
}

/** Wire the zoom/fit toolbar to a renderer that supports it (the PPTX viewer). No-op otherwise. */
function setupViewerControls(controller) {
  if (!controller || typeof controller.setZoom !== 'function') return;
  state.viewer = controller;
  const ZOOM_MIN = 25;
  const ZOOM_MAX = 400;
  const clamp = (n) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(n)));
  const paint = () => {
    el.btnZoomLevel.textContent = `${Math.round(controller.zoomPercent ?? 100)}%`;
  };
  const setZoom = async (percent) => {
    try {
      await controller.setZoom(clamp(percent));
    } catch {
      /* ignore transient zoom errors */
    }
    paint();
  };
  const fitToWidth = async () => {
    try {
      if (typeof controller.setFitMode === 'function') await controller.setFitMode('contain');
      await controller.setZoom(100);
    } catch {
      /* ignore */
    }
    paint();
  };
  el.btnZoomIn.onclick = () => setZoom((controller.zoomPercent ?? 100) + 10);
  el.btnZoomOut.onclick = () => setZoom((controller.zoomPercent ?? 100) - 10);
  el.btnZoomLevel.onclick = fitToWidth;
  el.btnZoomFit.onclick = fitToWidth;
  paint();
  el.zoomControls.hidden = false;
}

async function loadFromUrl(src) {
  state.srcUrl = src;
  showLoading('Fetching document…');
  let res;
  try {
    res = await fetch(src, { credentials: 'include' });
  } catch {
    if (/^file:\/\//i.test(src)) {
      showError(
        'Local file access is off',
        'To preview file:// documents, enable “Allow access to file URLs” for DocViewer at chrome://extensions, then reload — or just drag the file onto this page.',
        { allowDownload: false, allowOpen: true },
      );
    } else {
      showError(
        'Could not fetch the file',
        'The document could not be fetched — it may require a login, use a one-time link, or block cross-origin access. You can open the original or download it directly.',
        { allowDownload: false, allowOpen: true },
      );
    }
    return;
  }
  if (!res.ok) {
    showError('Fetch failed', `The server responded with ${res.status} ${res.statusText}.`, {
      allowDownload: false,
      allowOpen: true,
    });
    return;
  }
  const blob = await res.blob();
  const nameOverride = new URLSearchParams(location.search).get('name');
  await handleBlob(blob, nameOverride || filenameFromResponse(res, src), res.headers.get('content-type'));
}

function filenameFromResponse(res, src) {
  const cd = res.headers.get('content-disposition') || '';
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd);
  if (star) {
    try {
      return decodeURIComponent(star[1].replace(/"/g, ''));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  if (plain) return plain[1];
  try {
    const last = new URL(src).pathname.split('/').pop();
    if (last) return decodeURIComponent(last);
  } catch {
    /* ignore */
  }
  return 'document';
}

// --------------------------------------------------------------------------
// Wiring
// --------------------------------------------------------------------------
function openFilePicker() {
  el.fileInput.click();
}

el.btnOpen.addEventListener('click', openFilePicker);
el.btnPick.addEventListener('click', openFilePicker);
el.fileInput.addEventListener('change', () => {
  const file = el.fileInput.files?.[0];
  if (file) handleBlob(file, file.name, file.type);
  el.fileInput.value = '';
});
el.btnDownload.addEventListener('click', triggerDownload);
el.btnErrorDownload.addEventListener('click', triggerDownload);
el.btnMaxFidelity.addEventListener('click', () => {
  if (state.blob) openInMaxFidelity(el.content, state.blob, state.format);
});
el.btnOpenOriginal.addEventListener('click', () => state.srcUrl && window.open(state.srcUrl, '_blank', 'noopener'));
el.btnErrorOpen.addEventListener('click', () => state.srcUrl && window.open(state.srcUrl, '_blank', 'noopener'));

el.stage.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (!el.dropzone.hidden) el.dropzone.classList.add('dropzone--active');
});
el.stage.addEventListener('dragleave', () => el.dropzone.classList.remove('dropzone--active'));
el.stage.addEventListener('drop', (e) => {
  e.preventDefault();
  el.dropzone.classList.remove('dropzone--active');
  const file = e.dataTransfer?.files?.[0];
  if (file) handleBlob(file, file.name, file.type);
});

// Entry point: ?src= loads from a URL (used by the interception layer in Phase 3);
// otherwise show the drop zone for manual testing.
/**
 * Extract the original document URL from our own query string. The interceptor passes it raw
 * (DNR regex substitution) or percent-encoded (downloads safety-net), so handle both: take
 * everything after `src=` and decode only if it looks percent-encoded.
 */
function getSrcParam() {
  const m = /[?&]src=(.*)$/s.exec(location.href);
  if (!m || !m[1]) return null;
  let raw = m[1];
  if (/^https?%3a/i.test(raw)) {
    try {
      raw = decodeURIComponent(raw);
    } catch {
      /* fall back to the raw value */
    }
  }
  return raw;
}

(function init() {
  const src = getSrcParam();
  if (src) loadFromUrl(src);
  else showDropzone();
})();
