// Drives the mock server over HTTP: the endpoints the Integrity view uses, with the shapes documented in docs/API_ENDPOINTS.md.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { heartbeatGaps, summarize, listWarning } from "../src/integrity.js";

const PORT = 18000 + Math.floor(Math.random() * 1000), B = `http://127.0.0.1:${PORT}`;
let proc;
const j = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : null }; };

before(async () => {
  proc = spawn(process.execPath, [new URL("./mock-server.mjs", import.meta.url).pathname, String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((res) => proc.stdout.once("data", res));
});
after(() => proc.kill());

async function startedContest(nStudents) {
  const p = (await j("POST", "/problems", { title: "P" })).body;
  await j("POST", `/problems/${p.id}/testcases`, { inputRef: "1", expectedRef: "1", points: 10, isSample: true });
  const ids = [];
  for (let i = 0; i < nStudents; i++) { const u = `s${Math.random().toString(36).slice(2, 8)}${i}`; const r = await j("POST", "/users/students/bulk", { students: [{ username: u, password: "x", fullName: "N" + i }] }); ids.push(r.body.created[0].id); }
  const c = (await j("POST", "/contests", { title: "C", durationSec: 3600, scoringMode: "ICPC" })).body;
  await j("POST", `/contests/${c.id}/problems`, { problemId: p.id, label: "A", points: 10 });
  await j("POST", `/contests/${c.id}/enroll`, { userIds: ids });
  await j("POST", `/contests/${c.id}/publish`);
  await j("POST", `/contests/${c.id}/start`);
  return { c, ids };
}

test("demo sessions after start: statuses, counts and shapes", async () => {
  const { c } = await startedContest(4);
  const rows = (await j("GET", `/contests/${c.id}/sessions`)).body;
  assert.equal(rows.length, 4);
  for (const r of rows) for (const k of ["userId", "username", "fullName", "sessionId", "status", "startedAt", "endedAt", "lastHeartbeatAt", "events", "suspicious", "byType", "lastEventAt", "lastWdHeartbeatAt"]) assert.ok(k in r, "missing " + k);
  const statuses = rows.map((r) => r.status).sort();
  assert.deepEqual(statuses, ["ACTIVE", "ACTIVE", "ENDED", "NOT_STARTED"]);
  const notStarted = rows.find((r) => r.status === "NOT_STARTED");
  assert.equal(notStarted.sessionId, null);
  assert.equal(notStarted.events, 0);
  const noisy = rows.find((r) => r.suspicious === 2);
  assert.equal(noisy.byType.PROCESS_BLOCKED, 1);
  assert.equal(noisy.byType.PASTE, 1);
});

test("list warning flags exactly the student whose heartbeats stopped", async () => {
  const { c } = await startedContest(4);
  const rows = (await j("GET", `/contests/${c.id}/sessions`)).body;
  const flagged = rows.filter((r) => listWarning(r, Date.now()));
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].suspicious, 2);
});

test("GET /events?sessionId= and the detail summary agree with the list row", async () => {
  const { c } = await startedContest(4);
  const rows = (await j("GET", `/contests/${c.id}/sessions`)).body;
  for (const r of rows.filter((x) => x.sessionId)) {
    const ev = (await j("GET", `/events?sessionId=${r.sessionId}`)).body;
    assert.equal(ev.length, r.events);
    assert.deepEqual(ev.map((e) => e.seq), ev.map((_, i) => i));
    for (const k of ["seq", "type", "severity", "ts", "payloadJson", "hash", "receivedAt"]) assert.ok(k in ev[0]);
    const s = summarize(ev, r, Date.now());
    assert.equal(s.suspicious, r.suspicious);
    const warned = !!listWarning(r, Date.now());
    assert.equal(!!s.openGap, warned);
  }
  const stopped = rows.find((r) => listWarning(r, Date.now()));
  const gaps = heartbeatGaps((await j("GET", `/events?sessionId=${stopped.sessionId}`)).body, stopped, Date.now());
  assert.equal(gaps.length, 1);
  assert.ok(gaps[0].open && gaps[0].sec > 120);
});

test("test hook: seeded session with a closed gap and an unknown session id", async () => {
  const { c, ids } = await startedContest(1);                       // student 0 gets the healthy demo session; add a second contest user via hook
  const t0 = Date.now() - 1200000;
  const s = (await j("POST", "/__test/session", { contestId: c.id, userId: ids[0], status: "ENDED", startedAt: t0, endedAt: t0 + 600000,
    events: [{ type: "WD_HEARTBEAT", at: t0 + 60000 }, { type: "WD_HEARTBEAT", at: t0 + 300000 }, { type: "WD_HEARTBEAT", at: t0 + 360000 }] })).body;
  const ev = (await j("GET", `/events?sessionId=${s.id}`)).body;
  const g = heartbeatGaps(ev, s, Date.now());
  assert.deepEqual(g.map((x) => [x.sec, x.open]), [[240, false], [240, false]]);   // 1m->5m, then 6m->end(10m)
  assert.equal((await j("GET", "/events?sessionId=nope")).status, 404);
});
