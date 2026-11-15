#!/usr/bin/env node
// Drives a REAL server over HTTP (Node 18+, no dependencies):
//   node tools/integration-test.mjs http://host:8080 [--teacher user:pass] [--timeout 120]
// Needs at least one judge worker online for the verdict steps.
import crypto from "node:crypto";
const args = process.argv.slice(2);
const BASE = (args.find((a) => /^https?:/.test(a)) || process.env.SERVER_URL || "http://localhost:8080").replace(/\/+$/, "");
const opt = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : undefined; };
const [TUSER, TPASS] = (opt("teacher") || process.env.TEACHER || "itest-teacher:itest-pass-123").split(":");
const TIMEOUT = +(opt("timeout") || 120) * 1000;
const sfx = Date.now().toString(36);
let failed = 0;

async function api(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let r;
  try { r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch (e) { throw Object.assign(new Error(`cannot reach ${BASE} (${e.cause?.code || e.message})`), { status: 0 }); }
  const t = await r.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
  if (!r.ok) throw Object.assign(new Error(`${method} ${path} -> ${r.status} ${d?.message || d?.error || t}`), { status: r.status });
  return d;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function step(name, fn) {
  try { const v = await fn(); console.log("ok  ", name); return v; }
  catch (e) { failed++; console.log("FAIL", name, "-", e.message); return undefined; }
}
const need = (c, m) => { if (!c) throw new Error(m); };
async function until(fn, what) {
  const end = Date.now() + TIMEOUT;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(1000); }
}

console.log(`Server: ${BASE}`);
const T = {}; // shared state
await step("server reachable (/time)", async () => need((await api("GET", "/time")).now, "no time"));
if (failed) process.exit(1);

await step("teacher: register (first run) or reuse", async () => {
  try { await api("POST", "/auth/register", { username: TUSER, password: TPASS }); } catch (e) { if (![401, 403, 409].includes(e.status)) throw e; }
  const r = await api("POST", "/auth/login", { username: TUSER, password: TPASS });
  need(r.user.role === "TEACHER" || r.user.role === "ADMIN", "not a teacher"); T.tok = r.accessToken;
});
if (!T.tok) { console.log("Cannot log in as a teacher. Pass --teacher user:password of an existing teacher."); process.exit(1); }

await step("judge worker online", async () => {
  const j = await api("GET", "/admin/judge/workers", undefined, T.tok);
  const on = j.workers.filter((w) => w.online); need(on.length > 0, "no worker online; start judge/start-workers first");
  console.log(`      workers online: ${on.map((w) => w.workerId).join(", ")}`);
});
await step("students: bulk create", async () => {
  const mk = (n) => ({ username: `it-${sfx}-${n}`, password: "student-pass-1", fullName: `IT Student ${n}`, studentRef: `IT${n}` });
  T.stu = [mk(1), mk(2)];
  const r = await api("POST", "/users/students/bulk", { students: T.stu }, T.tok);
  need(r.created.length === 2, `created ${r.created.length}`); T.ids = r.created.map((c) => c.id);
});
await step("problem + sample + hidden testcase", async () => {
  const p = await api("POST", "/problems", { title: `IT Sum ${sfx}`, statementMd: "Print a+b.", timeLimitMs: 2000, memoryLimitKb: 262144, checkerType: "TOKEN" }, T.tok);
  T.pid = p.id;
  await api("POST", `/problems/${T.pid}/testcases`, { inputRef: "1 2\n", expectedRef: "3\n", points: 50, isSample: true }, T.tok);
  await api("POST", `/problems/${T.pid}/testcases`, { inputRef: "10 20\n", expectedRef: "30\n", points: 50, isSample: false }, T.tok);
  need((await api("GET", `/problems/${T.pid}/testcases`, undefined, T.tok)).length === 2, "testcase count");
});
await step("contest: create, add problem, enroll, publish, start", async () => {
  const c = await api("POST", "/contests", { title: `IT Exam ${sfx}`, durationSec: 900, scoringMode: "IOI" }, T.tok); T.cid = c.id;
  await api("POST", `/contests/${T.cid}/problems`, { problemId: T.pid, label: "A", points: 100 }, T.tok);
  await api("POST", `/contests/${T.cid}/enroll`, { userIds: T.ids }, T.tok);
  await api("POST", `/contests/${T.cid}/publish`, undefined, T.tok);
  const s = await api("POST", `/contests/${T.cid}/start`, undefined, T.tok); need(s.status === "RUNNING", "status " + s.status);
});

await step("student: login, sees exam, opens session", async () => {
  const r = await api("POST", "/auth/login", { username: T.stu[0].username, password: T.stu[0].password }); T.st = r.accessToken;
  const mine = await api("GET", "/contests/mine", undefined, T.st);
  need(mine.some((c) => c.id === T.cid && c.status === "RUNNING"), "exam not listed as RUNNING");
  const started = await api("POST", "/sessions/start", { contestId: T.cid, deviceFp: "itest", clientVersion: "itest" }, T.st);
  T.sess = started.id; T.key = started.sessionKey;
  need(T.sess, "no session id");
  need(/^[0-9a-f]{64}$/.test(T.key || ""), "/sessions/start did not return a 64-hex sessionKey");
  const hb = await api("POST", `/sessions/${T.sess}/heartbeat`, { seq: 1 }, T.st); need(hb.status === "ACTIVE", "heartbeat " + hb.status);
});
await step("student: statement shows only the sample", async () => {
  const d = await api("GET", `/contests/${T.cid}`, undefined, T.st); need(d.problems.length === 1, "problem list");
  const p = await api("GET", `/problems/${T.pid}?contestId=${T.cid}`, undefined, T.st);
  need(p.sampleTestcases.length === 1, `sample count ${p.sampleTestcases.length} (hidden test leaked?)`);
});
await step("student: run with custom input -> 9", async () => {
  const { id } = await api("POST", "/runs", { language: "PYTHON", sourceCode: "print(sum(map(int,input().split())))", stdin: "4 5\n", problemId: T.pid }, T.st);
  const r = await until(async () => { const g = await api("GET", `/runs/${id}`, undefined, T.st); return g.status === "DONE" ? g : null; }, "run result");
  need(r.result.stdout.trim() === "9", `stdout ${JSON.stringify(r.result.stdout)} verdict ${r.result.verdict}`);
});
const submit = async (language, sourceCode) => {
  const { id } = await api("POST", "/submissions", { sessionId: T.sess, contestId: T.cid, problemId: T.pid, language, sourceCode }, T.st);
  return until(async () => { const g = await api("GET", `/submissions/${id}`, undefined, T.st); return ["DONE", "ERROR"].includes(g.status) ? g : null; }, "verdict");
};
await step("submit correct (Python) -> AC, score 100", async () => { const s = await submit("PYTHON", "print(sum(map(int,input().split())))"); need(s.verdict === "AC" && s.score === 100, `${s.verdict} score ${s.score}`); need(s.tests.length === 2, "tests " + s.tests.length); });
await step("submit wrong -> WA, score 0", async () => { const s = await submit("PYTHON", "print(0)"); need(s.verdict === "WA" && s.score === 0, `${s.verdict} score ${s.score}`); });
await step("submit non-compiling C -> CE with compiler output", async () => { const s = await submit("C", "int main( {"); need(s.verdict === "CE", s.verdict); need(s.compileOutput, "no compileOutput"); });
await step("student cannot use teacher endpoints", async () => { const r = await api("GET", "/contests", undefined, T.st).then(() => false, (e) => e.status === 403 || e.status === 401); need(r, "student could list all contests"); });

// ── Event integrity: same chain/HMAC rules as watchdog-linux/lib/chain.js and EventChain.java ────────────────
const canon = (v) => (v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}");
const mkChain = (key, specs, seq0 = 0, prev0 = "0".repeat(64)) => {
  let prev = prev0, seq = seq0; const out = [];
  for (const [type, severity, payload] of specs) {
    const ts = new Date().toISOString(), hash = crypto.createHash("sha256").update(prev + canon({ type, severity, ts, payload }), "utf8").digest("hex");
    out.push({ seq: seq++, type, severity, ts, payloadJson: canon(payload), prevHash: prev, hash, hmac: crypto.createHmac("sha256", Buffer.from(key, "hex")).update(hash, "utf8").digest("hex") });
    prev = hash;
  }
  return out;
};
const ingest = (events) => api("POST", "/events/ingest", { sessionId: T.sess, events }, T.st);
const rejected = (p, re) => p.then(() => { throw new Error("server accepted a bad batch"); }, (e) => { need(e.status === 400 && re.test(e.message), `expected 400 ${re}, got ${e.status} ${e.message}`); });
await step("events: signed chain accepted; stored in order (seq from 0)", async () => {
  const c = mkChain(T.key, [["WATCHDOG_STARTED", "INFO", { pid: 1 }], ["PASTE", "MEDIUM", { chars: 40, s: "é\"" }], ["PROCESS_BLOCKED", "HIGH", { name: "firefox", killed: true }]]);
  T.chain = c;
  const r = await ingest(c); need(r.accepted === 3 && r.nextSeq === 3, JSON.stringify(r));
  const back = await api("GET", `/events?sessionId=${T.sess}`, undefined, T.tok);
  need(back.length === 3 && back.map((e) => e.seq).join() === "0,1,2", "stored " + back.map((e) => e.seq));
  need(back[1].payloadJson === c[1].payloadJson, "payload text changed in storage");
});
await step("events: retry of a stored batch is harmless", async () => { const r = await ingest(T.chain.slice(1)); need(r.accepted === 0 && r.duplicates === 2, JSON.stringify(r)); });
await step("events: gap rejected (400)", async () => rejected(ingest(mkChain(T.key, [["PASTE", "MEDIUM", {}]], 5, T.chain[2].hash)), /expected seq 3/));
await step("events: wrong prevHash rejected (400)", async () => rejected(ingest(mkChain(T.key, [["PASTE", "MEDIUM", {}]], 3, "1".repeat(64))), /prevHash/));
await step("events: edited content rejected (400)", async () => { const [e] = mkChain(T.key, [["PASTE", "MEDIUM", {}]], 3, T.chain[2].hash); e.payloadJson = '{"x":1}'; await rejected(ingest([e]), /hash does not match/); });
await step("events: events signed with a made-up key rejected (400)", async () => rejected(ingest(mkChain("ab".repeat(32), [["PASTE", "MEDIUM", {}]], 3, T.chain[2].hash)), /HMAC invalid/));
await step("events: another student cannot upload into this session", async () => {
  const r = await api("POST", "/auth/login", { username: T.stu[1].username, password: T.stu[1].password });
  const c = mkChain(T.key, [["PASTE", "MEDIUM", {}]], 3, T.chain[2].hash);
  const refused = await api("POST", "/events/ingest", { sessionId: T.sess, events: c }, r.accessToken).then(() => false, (e) => e.status === 403);
  need(refused, "student 2 could write events into student 1's session");
});
await step("events: a student cannot read the teacher's suspicious count; teacher sees per-student counts", async () => {
  const denied = await api("GET", `/events/suspicious?sessionId=${T.sess}`, undefined, T.st).then(() => false, (e) => e.status === 403);
  need(denied, "student could read /events/suspicious");
  const rows = await api("GET", `/contests/${T.cid}/sessions`, undefined, T.tok);
  const mine = rows.find((r) => r.sessionId === T.sess), other = rows.find((r) => r.sessionId !== T.sess);
  need(mine && mine.events === 3 && mine.suspicious === 2, `counts ${JSON.stringify(mine)}`);
  need(mine.byType.PROCESS_BLOCKED === 1 && mine.byType.PASTE === 1, "byType " + JSON.stringify(mine.byType));
  need(other && other.status === "NOT_STARTED" && other.events === 0, "enrolled student without a session should be NOT_STARTED: " + JSON.stringify(other));
  const sus = await api("GET", `/events/suspicious?sessionId=${T.sess}`, undefined, T.tok); need(sus.suspiciousEvents === 2, JSON.stringify(sus));
  const stu = await api("GET", "/contests/" + T.cid + "/sessions", undefined, T.st).then(() => false, (e) => e.status === 403); need(stu, "student could list contest sessions");
});

await step("teacher: standings and submissions", async () => {
  const st = await api("GET", `/contests/${T.cid}/standings`, undefined, T.tok);
  const row = st.find((r) => r.username === T.stu[0].username); need(row && row.total === 100, `total ${row?.total}`);
  const subs = await api("GET", `/contests/${T.cid}/submissions`, undefined, T.tok); need(subs.length === 3, `submissions ${subs.length}`);
});
await step("teacher: stop exam, then submissions are refused and session ends", async () => {
  await api("POST", `/contests/${T.cid}/stop`, undefined, T.tok);
  const refused = await api("POST", "/submissions", { sessionId: T.sess, contestId: T.cid, problemId: T.pid, language: "PYTHON", sourceCode: "print(3)" }, T.st).then(() => false, (e) => e.status === 409 || e.status === 403);
  need(refused, "submission accepted after the exam ended");
});

console.log(failed ? `\n${failed} step(s) failed` : "\nAll steps passed");
process.exit(failed ? 1 : 0);
