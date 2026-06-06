#!/usr/bin/env node
// Above Live — smoke check.
// Starts the backend, waits for it to come up, then verifies the basics:
//   1. the backend process starts and responds
//   2. /api/status returns backend "ok" with a provider
//   3. /api/aircraft returns a non-empty aircraft array (mock data by default)
// Exits 0 on success, 1 on failure. Pure Node so it runs the same on a laptop
// (macOS / Windows / Linux) and on a Raspberry Pi. Run it with:
//   node scripts/smoke-check.mjs      (from the project root)
//   npm run smoke                     (from the backend folder)

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, '..', 'backend');
const PORT = process.env.PORT || 4100; // use a side port so we don't clash with a running server
const BASE = `http://localhost:${PORT}`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await getJson('/api/status');
      return true;
    } catch {
      await wait(500);
    }
  }
  return false;
}

let failed = false;
function check(ok, msg) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failed = true;
}

console.log(`Above Live — smoke check (port ${PORT})`);
console.log('Starting backend...');

const server = spawn('node', ['server.js'], {
  cwd: BACKEND,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'development' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
server.stdout.on('data', (d) => (serverOut += d));
server.stderr.on('data', (d) => (serverOut += d));
server.on('error', (err) => {
  console.error('Could not start backend:', err.message);
});

try {
  const up = await waitForServer();
  check(up, 'backend starts and responds');

  if (up) {
    const status = await getJson('/api/status');
    check(status.backend === 'ok', `/api/status backend = "ok" (got "${status.backend}")`);
    check(
      typeof status.effectiveProvider === 'string' && status.effectiveProvider.length > 0,
      `/api/status reports a provider (${status.effectiveProvider})`
    );

    const data = await getJson('/api/aircraft');
    const n = Array.isArray(data.aircraft) ? data.aircraft.length : 0;
    check(n > 0, `/api/aircraft returns aircraft (count = ${n})`);
  } else {
    console.log('\n--- backend output ---\n' + serverOut);
  }
} catch (err) {
  check(false, `unexpected error: ${err.message}`);
  console.log('\n--- backend output ---\n' + serverOut);
} finally {
  server.kill('SIGTERM');
  await wait(300);
  try { server.kill('SIGKILL'); } catch { /* already gone */ }
}

console.log(failed ? '\nSMOKE CHECK FAILED' : '\nSMOKE CHECK PASSED');
process.exit(failed ? 1 : 0);
