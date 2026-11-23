// DocViewer viewer orchestrator.
//
// Responsibilities: accept a document (via ?src= URL, file picker, or drag & drop), detect its
// format, run heavy parsing in a Web Worker, route to the right renderer, and manage the
// toolbar / loading / error / size-cap UI. The Download button is always backed by the original
// bytes so the user can save the file at any time.

import { sniffType } from './typeSniff.js';
import { getRenderer } from './renderers/router.js';
import { FORMATS, MIME_TO_FORMAT, SIZE_WARN_BYTES, SIZE_HARD_CAP_BYTES } from '../common/constants.js';

const $ = (id) => document.getElementById(id);
const el = {
  filename: $('filename'),
  typeBadge: $('type-badge'),
  btnOpen: $('btn-open'),
  btnPick: $('btn-pick'),
  btnOpenOriginal: $('btn-open-original'),
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
  btnLoadingDownload: $('btn-loading-download'),
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

// Bounded waits so a broken or silently-dead worker can never hang the UI forever. A module
// worker that throws while importing a bundled dependency does not reliably fire `onerror` in an
// extension context, so we also wait on an explicit readiness ping the worker posts once booted.
const WORKER_START_TIMEOUT_MS = 10_000; // worker must announce { ready:true } within this
const WORKER_PARSE_TIMEOUT_MS = 120_000; // hard backstop for an alive-but-stuck parse

let worker = null;
let workerReady = null; // Promise that resolves once the worker posts { ready:true }
let workerSeq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  // Reference the built worker by its extension path (avoids esbuild rewriting new URL()).
  worker = new Worker(chrome.runtime.getURL('viewer/workers/parse.worker.js'), { type: 'module' });

  let markReady;
  let markFailed;
  workerReady = new Promise((resolve, reject) => {
    markReady = resolve;
    markFailed = reject;
  });
  workerReady.catch(() => {}); // swallow "unhandled rejection" if no parse is waiting yet
  const startTimer = setTimeout(
    () => markFailed(new Error('The document parser did not start in time.')),
    WORKER_START_TIMEOUT_MS,
  );

  // Tear down a dead worker and reject everything waiting on it; the next parse rebuilds it fresh.
  const killWorker = (message) => {
    clearTimeout(startTimer);
    markFailed(new Error(message)); // no-op if the ready promise already settled
    for (const { reject } of pending.values()) reject(new Error(message));
    pending.clear();
    try {
      worker?.terminate();
    } catch {
      /* best effort */
    }
    worker = null;
    workerReady = null;
  };

  worker.onmessage = (e) => {
    const data = e.data || {};
    if (data.ready) {
      clearTimeout(startTimer);
      markReady();
      return;
    }
    const resolver = pending.get(data.id);
    if (!resolver) return;
    pending.delete(data.id);
    if (data.ok) resolver.resolve(data.result);
    else resolver.reject(new Error(data.error));
  };
  worker.onerror = (e) => killWorker(e.message || 'The document parser crashed.');
  worker.onmessageerror = () => killWorker('The document parser sent an unreadable message.');
  return worker;
}

function parseInWorker(blob, format) {
  const w = getWorker();
  const ready = workerReady;
  const id = ++workerSeq;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pending.delete(id);
      fn(arg);
    };
    const timer = setTimeout(
      () => finish(reject, new Error('Parsing timed out — the file may be extremely large or corrupt.')),
      WORKER_PARSE_TIMEOUT_MS,
    );
    pending.set(id, { resolve: (r) => finish(resolve, r), reject: (err) => finish(reject, err) });
    // Post only once the worker has booted; if it never boots, `ready` rejects and so do we.
    ready.then(
      () => {
        try {
          w.postMessage({ id, blob, format });
        } catch (err) {
          finish(reject, err instanceof Error ? err : new Error(String(err)));
        }
      },
      (err) => finish(reject, err),
    );
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

/** Disable actions that start or replace a render while one is in flight (prevents re-entrancy and
 *  mid-render churn). Download stays enabled on purpose — it's the escape hatch for a slow render. */
function setToolbarBusy(busy) {
  el.btnOpen.disabled = busy;
  el.btnPick.disabled = busy;
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

// After this long with nothing painted, stop implying "almost done": keep rendering but tell the
// user and surface a Download escape hatch, so the spinner can never read as a silent dead-end.
const SLOW_RENDER_MS = 12_000;
// Hard cap: if NOTHING has painted by now, give up and show an actionable error instead of an
// endless spinner. The fast engine paints in a second or two, so this only trips on a stuck render.
const RENDER_HARD_TIMEOUT_MS = 30_000;
let renderToken = 0; // bumped per render so a superseded one can't clobber a newer file's UI

async function renderActive(sniff) {
  // Render into a VISIBLE content stage with the spinner overlaid on top (the overlay is
  // absolutely positioned over the stage). Renderers that scale to fit — PPTX fit-to-width and
  // the virtualized grid — must measure a real clientWidth; a hidden (display:none) container
  // measures 0, which makes slides render at the wrong size and triggers re-layout churn once
  // the container is finally shown.
  const token = ++renderToken;
  teardownViewer();
  hideAll();
  el.content.replaceChildren();
  el.content.hidden = false;
  el.loadingText.textContent = `Rendering ${FORMATS[sniff.format]?.label || 'document'}…`;
  el.btnLoadingDownload.hidden = true;
  el.loading.hidden = false;
  setToolbarBusy(true);

  let painted = false;
  const onFirstPaint = () => {
    if (token !== renderToken) return; // a newer render owns the overlay now
    painted = true;
    el.loading.hidden = true; // drop the overlay the moment content appears
  };
  const slowTimer = setTimeout(() => {
    if (painted || token !== renderToken) return;
    el.loadingText.textContent = 'Still working — large files can take a while. You can download it instead.';
    el.btnLoadingDownload.hidden = !state.blob;
  }, SLOW_RENDER_MS);

  // One try/catch/finally around the WHOLE parse+render sequence: the parse await used to sit
  // outside it, so a worker that never answered left the overlay up forever. Now every exit —
  // success, error, or timeout — flows through `finally` and clears the overlay.
  let controller = null;
  let hardTimer = null;
  try {
    let parsed = null;
    if (WORKER_PARSED.has(sniff.format)) {
      parsed = await parseInWorker(state.blob, sniff.format);
    }
    if (token !== renderToken) return; // a newer file superseded this one while parsing
    const render = getRenderer(sniff.format);
    const rendered = render(el.content, {
      blob: state.blob,
      filename: state.filename,
      sniff,
      parsed,
      scrollContainer: el.stage, // the real scroll ancestor; used by the PPTX windowed renderer
      onFirstPaint,
    });
    // Race the render against a hard cap: if nothing paints, fail loudly instead of forever.
    controller = await Promise.race([
      rendered,
      new Promise((_resolve, reject) => {
        hardTimer = setTimeout(() => {
          if (!painted) {
            reject(
              new Error(
                'Rendering is taking too long. Download the file, or switch PowerPoint quality to “Fast” in the DocViewer popup.',
              ),
            );
          }
        }, RENDER_HARD_TIMEOUT_MS);
      }),
    ]);
    if (token !== renderToken) return;
  } catch (err) {
    if (token !== renderToken) return;
    console.error('[DocViewer] render failed', err);
    showError('Could not display this file', String(err?.message || err), {
      allowDownload: true,
      allowOpen: Boolean(state.srcUrl),
    });
    return;
  } finally {
    if (token === renderToken) {
      clearTimeout(slowTimer);
      clearTimeout(hardTimer);
      el.btnLoadingDownload.hidden = true;
      el.loading.hidden = true;
      setToolbarBusy(false);
    }
  }
  scrubDangerous(el.content);
  setupViewerControls(controller);
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
      if (typeof controller.fitToWidth === 'function') {
        // The renderer owns its fit math (e.g. Ordalie's absolute zoomToFit).
        await controller.fitToWidth();
      } else {
        // aiden0z: effective scale = fitScale * zoomPercent/100, so contain-mode at 100% fits.
        if (typeof controller.setFitMode === 'function') await controller.setFitMode('contain');
        await controller.setZoom(100);
      }
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
el.btnLoadingDownload.addEventListener('click', triggerDownload);
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
