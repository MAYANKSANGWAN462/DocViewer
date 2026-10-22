// Build DocViewer into dist/ with esbuild: bundles each extension entry point (service worker,
// viewer, parse worker, popup) with its dependencies, then copies static assets. Load dist/ as
// the unpacked extension. Pass --watch for incremental rebuilds.

import { build, context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

const options = {
  entryPoints: {
    'service-worker': 'src/background/service-worker.js',
    'viewer/viewer': 'src/viewer/viewer.js',
    'viewer/workers/parse.worker': 'src/viewer/workers/parse.worker.js',
    'viewer/renderers/pptx-aiden': 'src/viewer/renderers/pptx-aiden.js',
    'viewer/renderers/pptx-ordalie': 'src/viewer/renderers/pptx-ordalie.js',
    'viewer/bakeoff': 'src/viewer/bakeoff.js',
    'popup/popup': 'src/popup/popup.js',
  },
  outdir,
  bundle: true,
  format: 'esm',
  splitting: false, // keep each entry self-contained (module workers can't share chunks cleanly)
  target: 'chrome116',
  minify: true, // these renderer bundles are large; minify to keep the packaged extension sane
  legalComments: 'eof', // retain bundled-dependency license notices (MIT/Apache compliance)
  logLevel: 'info',
  // Bundled renderer deps were written for Node and reference `process` / NODE_ENV. Fold the env
  // check to production (strips dev-only branches) and provide a tiny `process` shim so a stray
  // `process.nextTick` can never throw "process is not defined" at runtime in the browser.
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: {
    js: "globalThis.process=globalThis.process||{env:{},nextTick:(cb,...a)=>queueMicrotask(()=>cb(...a)),platform:'browser'};",
  },
};

// Static assets copied verbatim, preserving their path under dist/.
const STATIC = [
  ['src/manifest.json', 'manifest.json'],
  ['src/viewer/viewer.html', 'viewer/viewer.html'],
  ['src/viewer/viewer.css', 'viewer/viewer.css'],
  ['src/viewer/bakeoff.html', 'viewer/bakeoff.html'],
  ['src/popup/popup.html', 'popup/popup.html'],
  ['src/popup/popup.css', 'popup/popup.css'],
];

async function copyStatic() {
  for (const [from, to] of STATIC) {
    await cp(from, `${outdir}/${to}`);
  }
  if (existsSync('icons')) await cp('icons', `${outdir}/icons`, { recursive: true });
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  await copyStatic();
  console.log('[build] watching src/ → dist/ (static assets copied once; re-run for HTML/CSS changes)');
} else {
  await build(options);
  await copyStatic();
  console.log('[build] done → dist/');
}
