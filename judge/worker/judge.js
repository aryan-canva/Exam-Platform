'use strict';
const { createSandbox } = require('./sandbox');
const { check } = require('./checker');

const clip = (s, n) => (s.length > n ? s.slice(0, n) : s);

function verdictOf(r, expected, checker) {
  if (r.tle) return 'TLE';
  if (r.truncated) return 'RE'; // output limit exceeded
  if (r.code === 137 || r.signal === 'SIGKILL') return r.oom ? 'MLE' : 'RE';
  if (r.code !== 0) return 'RE';
  return check(checker, r.stdout, expected) ? 'AC' : 'WA';
}

/**
 * Judge one job. Never throws: infrastructure problems come back as { systemError }
 * so the server can retry the job on another worker.
 * ctx = { sandbox: 'docker'|'process', isAborted: () => boolean }
 */
async function judgeJob(job, ctx) {
  let sb;
  try {
    sb = createSandbox(ctx.sandbox, job);
    sb.prepare(job.sourceCode);
    const compile = await sb.compile();
    if (!compile.ok) return { compile, tests: [], verdict: 'CE', stdout: '', stderr: compile.output, exitCode: 1, timeMs: 0 };
    await sb.start();

    const limitMs = Math.round(job.timeLimitMs * sb.lang.timeFactor);

    if (job.kind === 'RUN') {
      const r = await sb.run(job.stdin || '', limitMs);
      let verdict = 'OK';
      if (r.tle) verdict = 'TLE';
      else if (r.truncated) verdict = 'RE';
      else if (r.code === 137) verdict = r.oom ? 'MLE' : 'RE';
      else if (r.code !== 0) verdict = 'RE';
      return {
        compile, tests: [], verdict,
        stdout: clip(r.stdout, 20000), stderr: clip(r.stderr, 8000),
        exitCode: r.code, timeMs: Math.min(r.timeMs, limitMs),
      };
    }

    const tests = [];
    for (const tc of job.testcases || []) {
      if (ctx.isAborted()) return { systemError: 'lease lost, job abandoned' };
      const r = await sb.run(tc.input || '', limitMs);
      const verdict = verdictOf(r, tc.expected || '', job.checker);
      tests.push({
        testcaseId: tc.id, verdict,
        timeMs: Math.min(r.timeMs, limitMs), memoryKb: 0,
        points: tc.points || 0,
        stdout: verdict === 'WA' || verdict === 'AC' ? clip(r.stdout, 300) : clip(r.stderr, 300),
      });
    }
    return { compile, tests };
  } catch (e) {
    return { systemError: String(e.message || e) };
  } finally {
    if (sb) await sb.cleanup().catch(() => {});
  }
}

module.exports = { judgeJob };
