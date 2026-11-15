'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnCapture } = require('./exec');
const { LANGUAGES } = require('./languages');

const WORK_ROOT = process.env.WORK_ROOT || path.join(os.tmpdir(), 'judge-work');
const COMPILE_TIMEOUT_MS = 30000;
const MAX_COMPILE_OUTPUT = 4000;

const clip = (s, n) => (s.length > n ? s.slice(0, n) + '\n...[truncated]' : s);

class BaseSandbox {
  constructor(job) {
    this.job = job;
    this.lang = LANGUAGES[job.language];
    if (!this.lang) throw new Error(`Unsupported language: ${job.language}`);
    this.memMb = Math.max(16, Math.floor((job.memoryLimitKb || 262144) / 1024));
    this.dir = null;
    this.baselineMs = 0;
  }

  prepare(sourceCode) {
    fs.mkdirSync(WORK_ROOT, { recursive: true });
    this.dir = fs.mkdtempSync(path.join(WORK_ROOT, 'job-'));
    fs.chmodSync(this.dir, 0o777); // the container user (nobody) must be able to write the binary
    const file = path.join(this.dir, this.lang.file);
    fs.writeFileSync(file, sourceCode, 'utf8');
    fs.chmodSync(file, 0o644);
  }

  cleanupDir() {
    if (this.dir) fs.rmSync(this.dir, { recursive: true, force: true });
  }

  runCommand() {
    return this.lang.run(this.memMb);
  }
}

/** UNSAFE: runs code directly on the host. For tests/dev only (SANDBOX=process). */
class ProcessSandbox extends BaseSandbox {
  async compile() {
    const cmd = this.lang.compile();
    if (!cmd) return { ok: true, output: '' };
    const r = await spawnCapture(cmd[0], cmd.slice(1), { cwd: this.dir, timeoutMs: COMPILE_TIMEOUT_MS });
    if (r.spawnError) throw new Error(`Cannot run compiler ${cmd[0]}: ${r.spawnError}`);
    if (r.timedOut) return { ok: false, output: 'Compilation timed out' };
    return { ok: r.code === 0, output: clip(r.stderr + r.stdout, MAX_COMPILE_OUTPUT) };
  }

  async start() {}

  async run(stdin, limitMs) {
    const cmd = this.runCommand();
    const exe = cmd[0].startsWith('./') ? path.join(this.dir, cmd[0]) : cmd[0];
    const r = await spawnCapture(exe, cmd.slice(1), { cwd: this.dir, input: stdin, timeoutMs: limitMs });
    if (r.spawnError) throw new Error(`Cannot start program: ${r.spawnError}`);
    return { ...r, tle: r.timedOut, oom: false };
  }

  async cleanup() { this.cleanupDir(); }
}

/** Real isolation: no network, memory/pids/cpu limits, read-only root, non-root user, caps dropped. */
class DockerSandbox extends BaseSandbox {
  constructor(job) {
    super(job);
    const id = job.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24) + Math.random().toString(36).slice(2, 6);
    this.runName = `judge-run-${id}`;
    this.compileName = `judge-cmp-${id}`;
  }

  hardening(memMb, pids) {
    return [
      '--network', 'none',
      '--memory', `${memMb}m`, '--memory-swap', `${memMb}m`,
      '--cpus', '1', '--pids-limit', String(pids),
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--user', '65534:65534', '-e', 'HOME=/tmp',
      '--ulimit', 'nofile=1024', '--ulimit', 'core=0',
    ];
  }

  mount(readonly) {
    return ['--mount', `type=bind,source=${this.dir},target=/work${readonly ? ',readonly' : ''}`, '-w', '/work'];
  }

  async docker(args, opts) {
    const r = await spawnCapture('docker', args, opts);
    if (r.spawnError) throw new Error(`docker not available: ${r.spawnError}`);
    return r;
  }

  async compile() {
    const cmd = this.lang.compile();
    if (!cmd) return { ok: true, output: '' };
    // Compilers need more memory than the student's program may use, so compile in its own container.
    const args = ['run', '--rm', '--name', this.compileName,
      ...this.hardening(1024, 256),
      '--tmpfs', '/tmp:rw,exec,size=128m',
      ...this.mount(false), this.lang.image,
      'timeout', '-s', 'KILL', String(COMPILE_TIMEOUT_MS / 1000), ...cmd];
    const r = await this.docker(args, { timeoutMs: COMPILE_TIMEOUT_MS + 15000 });
    if (r.timedOut) { await this.docker(['rm', '-f', this.compileName], { timeoutMs: 15000 }); return { ok: false, output: 'Compilation timed out' }; }
    if (r.code === 125 || r.code === 126 || r.code === 127) {
      throw new Error(`docker run failed (${r.code}): ${clip(r.stderr, 500)}`);
    }
    return { ok: r.code === 0, output: clip(r.stderr + r.stdout, MAX_COMPILE_OUTPUT) };
  }

  async start() {
    const memMb = this.memMb + (this.lang.extraMemMb || 0);
    const args = ['run', '-d', '--name', this.runName,
      ...this.hardening(Math.max(memMb, 64), 64),
      '--read-only', '--tmpfs', '/tmp:rw,size=16m',
      ...this.mount(true), this.lang.image, 'sleep', '3600'];
    const r = await this.docker(args, { timeoutMs: 120000 });
    if (r.code !== 0) throw new Error(`cannot start sandbox container: ${clip(r.stderr, 500)}`);
    // Measure fixed `docker exec` overhead so it is not charged to the student.
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const b = await this.execIn(['true'], '', 10000);
      best = Math.min(best, b.timeMs);
    }
    this.baselineMs = Number.isFinite(best) ? best : 0;
  }

  execIn(cmd, stdin, timeoutMs) {
    return this.docker(['exec', '-i', this.runName, ...cmd], { input: stdin, timeoutMs });
  }

  async run(stdin, limitMs) {
    const secs = ((limitMs + this.baselineMs) / 1000).toFixed(3);
    const cmd = ['timeout', '-s', 'KILL', secs, ...this.runCommand()];
    let r = await this.execIn(cmd, stdin, limitMs + this.baselineMs + 4000);
    if (/is not running|No such container/i.test(r.stderr)) { // container was OOM-killed earlier
      await this.docker(['start', this.runName], { timeoutMs: 30000 });
      r = await this.execIn(cmd, stdin, limitMs + this.baselineMs + 4000);
    }
    const tle = r.timedOut || r.code === 124;
    let oom = false;
    if (r.code === 137 && !tle) {
      const i = await this.docker(['inspect', '-f', '{{.State.OOMKilled}}', this.runName], { timeoutMs: 10000 });
      oom = i.stdout.trim() === 'true';
    }
    return { ...r, timeMs: Math.max(0, r.timeMs - this.baselineMs), tle, oom };
  }

  async cleanup() {
    await spawnCapture('docker', ['rm', '-f', this.runName], { timeoutMs: 20000 }).catch(() => {});
    await spawnCapture('docker', ['rm', '-f', this.compileName], { timeoutMs: 20000 }).catch(() => {});
    this.cleanupDir();
  }
}

function createSandbox(kind, job) {
  return kind === 'process' ? new ProcessSandbox(job) : new DockerSandbox(job);
}

module.exports = { createSandbox, WORK_ROOT };
