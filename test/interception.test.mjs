// Unit tests for the interceptor's pure matching helpers (no chrome APIs touched).
// Run: npm test
import assert from 'node:assert/strict';
import { officeUrlPattern, isExcludedHost, extFromUrlOrFilename } from '../src/background/interception.js';
import { INTERCEPT_EXTENSIONS, EXCLUDED_DOMAINS } from '../src/common/constants.js';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`✓ ${name}`);
};

check('officeUrlPattern matches office file URLs only', () => {
  const re = new RegExp(officeUrlPattern(INTERCEPT_EXTENSIONS));
  assert.ok(re.test('https://x.com/a.xlsx'), 'plain xlsx');
  assert.ok(re.test('https://x.com/path/report.docx?dl=1'), 'docx with query');
  assert.ok(re.test('http://x.com/data.csv#frag'), 'csv with fragment');
  assert.ok(re.test('https://x.com/deck.pptx'), 'pptx intercepted (Phase 4)');
  assert.ok(!re.test('https://x.com/a.pdf'), 'pdf left alone');
  assert.ok(!re.test('https://x.com/page?file=a.xlsx'), 'extension only in query');
  assert.ok(!re.test('https://x.com/old.ppt'), 'legacy .ppt not intercepted (waits for Phase 5)');
});

check('isExcludedHost covers domains and subdomains', () => {
  assert.ok(isExcludedHost('drive.google.com', EXCLUDED_DOMAINS));
  assert.ok(isExcludedHost('team.sharepoint.com', EXCLUDED_DOMAINS), 'subdomain of sharepoint.com');
  assert.ok(!isExcludedHost('example.com', EXCLUDED_DOMAINS));
  assert.ok(isExcludedHost('example.com', [...EXCLUDED_DOMAINS, 'example.com']), 'user-disabled site');
});

check('extFromUrlOrFilename prefers filename, falls back to URL path', () => {
  assert.equal(extFromUrlOrFilename('https://x.com/a.xlsx'), 'xlsx');
  assert.equal(extFromUrlOrFilename('https://x.com/download?id=5', 'Report.DOCX'), 'docx');
  assert.equal(extFromUrlOrFilename('https://x.com/nope'), '');
});

console.log(`\n${passed} checks passed`);
