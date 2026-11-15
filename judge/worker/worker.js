#!/usr/bin/env node
'use strict';
/**
 * Judge worker. Connects OUT to the exam server (IP or hostname), claims jobs,
 * judges them in Docker, posts results. Run several of them (judge-1, judge-2, ...).
 *
 *   node worker.js --server http://203.0.113.5:8080 --id judge-1 --token <secret>
 * or env: SERVER_URL, WORKER_ID, WORKER_TOKEN, SANDBOX (docker|process), WAIT_SECONDS
 */
const { judgeJob } = require('./judge');
const { LANGUAGES } = require('./languages');
const { spawnCapture } = require('./exec');

const VERSION = '1.0.0';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const cfg = {
  server: (args.server || process.env.SERVER_URL || 'http://localhost:8080').replace(/\/+$/, ''),
  id: args.id || process.env.WORKER_ID || `judge-${require('os').hostname()}`,
  token: args.token || process.env.WORKER_TOKEN || 'dev-worker-token',
  sandbox: (args.sandbox || process.env.SANDBOX || 'docker').toLowerCase(),
  wait: Number(args.wait || process.env.WAIT_SECONDS || 20),
};

const log = (...a) => console.log(new Date().toISOString(), `[${cfg.id}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stopping = false;

const headers = { 'X-Worker-Token': cfg.token, 'Content-Type': 'application/json' };

async function claim() {
  const url = `${cfg.server}/judge/claim?workerId=${encodeURIComponent(cfg.id)}&version=${VERSION}&wait=${cfg.wait}`;
  const res = await fetch(url, { method: 'POST', headers, signal: AbortSignal.timeout((cfg.wait + 15) * 1000) });
  if (res.status === 204) return null;
  if (res.status === 401) throw new Error('server rejected the worker token (check WORKER_TOKEN / APP_JUDGE_WORKER_TOKEN)');
  if (!res.ok) throw new Error(`claim failed: HTTP ${res.status}`);
  return res.json();
}

async function postResult(jobId, result) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`${cfg.server}/judge/jobs/${jobId}/result`, {
        method: 'POST', headers, body: JSON.stringify({ workerId: cfg.id, ...result }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) return true;
      if (res.status === 409 || res.status === 404) { log(`job ${jobId}: result rejected (HTTP ${res.status}), discarding`); return false; }
      log(`job ${jobId}: result upload HTTP ${res.status}, retrying`);
    } catch (e) {
      log(`job ${jobId}: result upload error (${e.message}), retrying`);
    }
    await sleep(2000 * attempt);
  }
  log(`job ${jobId}: giving up on result upload; server will re-queue after lease expiry`);
  return false;
}

async function processJob(job) {
  log(`job ${job.id} ${job.kind} ${job.language} attempt ${job.attempt}`);
  let aborted = false;
  const keepAlive = setInterval(async () => {
    try {
      const res = await fetch(`${cfg.server}/judge/jobs/${job.id}/extend?workerId=${encodeURIComponent(cfg.id)}`, {
        method: 'POST', headers, signal: AbortSignal.timeout(10000),
      });
      if (res.status === 409) aborted = true;
    } catch { /* transient network error: keep going */ }
  }, 30000);

  const started = Date.now();
  const result = await judgeJob(job, { sandbox: cfg.sandbox, isAborted: () => aborted });
  clearInterval(keepAlive);

  const summary = result.systemError ? `systemError=${result.systemError}`
    : job.kind === 'RUN' ? `verdict=${result.verdict}`
    : result.compile && !result.compile.ok ? 'CE'
    : result.tests.map((t) => t.verdict).join(',');
  log(`job ${job.id} judged in ${Date.now() - started}ms: ${summary}`);
  if (!aborted) await postResult(job.id, result);
}

async function preflight() {
  log(`server=${cfg.server} sandbox=${cfg.sandbox} version=${VERSION}`);
  if (cfg.sandbox === 'process') {
    log('WARNING: SANDBOX=process runs student code directly on this machine. Use only for testing.');
    return;
  }
  const v = await spawnCapture('docker', ['version', '--format', '{{.Server.Version}}'], { timeoutMs: 15000 });
  if (v.spawnError || v.code !== 0) throw new Error(`Docker is not usable: ${v.spawnError || v.stderr.trim()}`);
  log(`docker engine ${v.stdout.trim()}`);
  const images = [...new Set(Object.values(LANGUAGES).map((l) => l.image))];
  for (const img of images) {
    const i = await spawnCapture('docker', ['image', 'inspect', img], { timeoutMs: 15000 });
    if (i.code !== 0) {
      log(`pulling image ${img} ...`);
      const p = await spawnCapture('docker', ['pull', img], { timeoutMs: 15 * 60 * 1000 });
      if (p.code !== 0) throw new Error(`cannot pull ${img}: ${p.stderr.trim()}`);
    }
  }
}

async function main() {
  await preflight();
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { log(`${sig}: finishing current job, then exiting`); stopping = true; });
  let backoff = 1000;
  while (!stopping) {
    try {
      const job = await claim();
      backoff = 1000;
      if (job) await processJob(job);
    } catch (e) {
      log(`cannot reach server: ${e.message} (retry in ${backoff / 1000}s)`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 15000);
    }
  }
  log('stopped');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
