// Shared constants for DocViewer.

/** Soft size threshold (bytes) above which the viewer warns before rendering. */
export const SIZE_WARN_BYTES = 40 * 1024 * 1024; // 40 MB

/** Hard cap (bytes): above this we decline to render in-tab and suggest downloading. */
export const SIZE_HARD_CAP_BYTES = 300 * 1024 * 1024; // 300 MB

/**
 * Format registry. `phase` is when real rendering lands; `container` is the expected
 * physical container, used for magic-byte sniffing and mismatch warnings.
 * @type {Record<string, {label:string, family:string, container:'zip'|'ole'|'text', phase:number, mime:string}>}
 */
export const FORMATS = {
  xlsx: {
    label: 'Excel Workbook',
    family: 'excel',
    container: 'zip',
    phase: 1,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  xls: {
    label: 'Excel 97–2003',
    family: 'excel',
    container: 'ole',
    phase: 1,
    mime: 'application/vnd.ms-excel',
  },
  csv: {
    label: 'CSV',
    family: 'excel',
    container: 'text',
    phase: 0,
    mime: 'text/csv',
  },
  docx: {
    label: 'Word Document',
    family: 'word',
    container: 'zip',
    phase: 2,
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  doc: {
    label: 'Word 97–2003',
    family: 'word',
    container: 'ole',
    phase: 5,
    mime: 'application/msword',
  },
  pptx: {
    label: 'PowerPoint Presentation',
    family: 'powerpoint',
    container: 'zip',
    phase: 4,
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  ppt: {
    label: 'PowerPoint 97–2003',
    family: 'powerpoint',
    container: 'ole',
    phase: 5,
    mime: 'application/vnd.ms-powerpoint',
  },
};

/** Extensions DocViewer is responsible for. PDF is intentionally excluded (Chrome native). */
export const SUPPORTED_EXTENSIONS = Object.keys(FORMATS);

/** Office MIME types — used by the interception layer in Phase 3. */
export const OFFICE_MIME_TYPES = [...new Set(Object.values(FORMATS).map((f) => f.mime))];

/** Reverse lookup MIME → format key, for detecting extensionless URLs by their Content-Type. */
export const MIME_TO_FORMAT = Object.fromEntries(Object.entries(FORMATS).map(([fmt, meta]) => [meta.mime, fmt]));

/** chrome.storage key for user settings. */
export const SETTINGS_KEY = 'docviewer.settings';

/** Default settings. */
export const DEFAULT_SETTINGS = {
  interceptionEnabled: true,
  disabledSites: [], // hostnames where auto-preview is turned off
  pptxRenderer: 'aiden0z', // 'aiden0z' | 'ordalie' — active PowerPoint renderer
  maxFidelity: { enabled: false }, // optional self-hosted LibreOffice-WASM engine (experimental)
};

/** Extensions the interceptor currently redirects to the viewer. PPTX joins in Phase 4; legacy
 *  .doc/.ppt wait for the Phase 5 WASM path. */
export const INTERCEPT_EXTENSIONS = ['xlsx', 'xls', 'csv', 'docx', 'pptx'];

/** MIME types for the intercepted extensions (used by the downloads safety-net). */
export const INTERCEPT_MIME_TYPES = INTERCEPT_EXTENSIONS.map((e) => FORMATS[e].mime);

/** MIME types matched by declarativeNetRequest responseHeaders rules. CSV is omitted because
 *  servers label it inconsistently (text/csv vs text/plain), which would over-match. */
export const HEADER_MATCH_MIME_TYPES = ['xlsx', 'xls', 'docx', 'pptx'].map((e) => FORMATS[e].mime);

/** Domains that already preview Office files well — never intercepted (subdomains included). */
export const EXCLUDED_DOMAINS = [
  'drive.google.com',
  'docs.google.com',
  'mail.google.com',
  'googleusercontent.com',
  'onedrive.live.com',
  'sharepoint.com',
  'office.com',
  'officeapps.live.com',
  'live.com',
  'outlook.office.com',
  'box.com',
  'dropbox.com',
  'dropboxusercontent.com',
];
