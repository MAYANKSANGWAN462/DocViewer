// Lightweight source check for the build-free phases: runs `node --check` on every
// JS/MJS file under src/ and scripts/, and validates that JSON config parses.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const CODE_ROOTS = ['src', 'scripts'];
const JSON_FILES = ['src/manifest.json', 'package.json'];

/** @param {string} dir @param {string[]} out */
function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (['.js', '.mjs'].includes(extname(p))) out.push(p);
  }
}

const files = [];
for (const root of CODE_ROOTS) {
  try {
    walk(root, files);
  } catch {
    /* root may not exist yet */
  }
}

let failed = 0;

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    console.error(`✗ ${file}\n${err.stderr?.toString() || err.message}`);
  }
}

for (const file of JSON_FILES) {
  try {
    JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    failed++;
    console.error(`✗ ${file}: ${err.message}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} file(s) failed the check.`);
  process.exit(1);
}
console.log(`✓ ${files.length} JS file(s) + ${JSON_FILES.length} JSON file(s) OK`);
