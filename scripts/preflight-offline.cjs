#!/usr/bin/env node
'use strict';
// One-command LOCAL, OFFLINE preflight. No RPC, wallet, secrets, VPS or payouts.
const { spawnSync } = require('node:child_process');
const { readdirSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const root = join(__dirname, '..');
process.chdir(root);
if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('Node.js 24+ required for the consolidated preflight.');
  process.exit(2);
}
const files = [
  'server.js',
  ...['lib', 'gateway', 'test'].flatMap(dir => {
    if (!existsSync(dir)) throw Error('Missing required directory: ' + dir);
    return readdirSync(dir).filter(name => /\.(?:cjs|mjs|js)$/.test(name)).map(name => join(dir, name));
  })
];
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0 || result.error) {
    failed = true;
    console.error('[FAIL] Syntax:', file, result.stderr || result.error?.message || 'unknown error');
  }
}
if (failed) {
  console.error('Syntax checks failed. Tests not started; no services were contacted.');
  process.exit(1);
}
console.log('[PASS] Syntax:', files.length, 'JavaScript files');
const result = spawnSync(process.execPath, ['--test', 'test'], { stdio: 'inherit', cwd: root });
if (result.error || result.status !== 0) {
  console.error('[FAIL] Offline test suite. No services were contacted by this runner.');
  process.exit(1);
}
console.log('[PASS] Offline preflight complete. VPS integration and live payout tests remain separate, gated steps.');
