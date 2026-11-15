'use strict';
const { spawn } = require('child_process');

/**
 * Run a command, capture output (capped), enforce a wall-clock timeout.
 * Resolves { code, signal, stdout, stderr, timeMs, timedOut, truncated, spawnError }.
 */
function spawnCapture(cmd, args, { cwd, input, timeoutMs = 10000, maxOut = 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    let stdout = '', stderr = '';
    let timedOut = false, truncated = false, done = false;
    let child;
    try {
      child = spawn(cmd, args, { cwd, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ code: -1, signal: null, stdout: '', stderr: '', timeMs: 0, timedOut: false, truncated: false, spawnError: e.message });
    }

    const killTree = () => {
      try {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else process.kill(-child.pid, 'SIGKILL');
      } catch { /* already gone */ }
    };
    const timer = setTimeout(() => { timedOut = true; killTree(); }, timeoutMs);

    const finish = (code, signal, spawnError) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const timeMs = Number((process.hrtime.bigint() - started) / 1000000n);
      resolve({ code, signal, stdout, stderr, timeMs, timedOut, truncated, spawnError });
    };

    child.stdout.on('data', (d) => {
      if (stdout.length + d.length > maxOut) { truncated = true; stdout += d.toString('utf8', 0, Math.max(0, maxOut - stdout.length)); killTree(); }
      else stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d) => { if (stderr.length < 64 * 1024) stderr += d.toString('utf8'); });
    child.stdin.on('error', () => { /* program exited before reading all input */ });
    child.on('error', (e) => finish(-1, null, e.message));
    child.on('close', (code, signal) => finish(code, signal));

    child.stdin.end(input == null ? '' : input);
  });
}

module.exports = { spawnCapture };
