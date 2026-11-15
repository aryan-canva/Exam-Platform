// Tiny in-memory fake of the Spring server, for trying the teacher UI without Postgres:  node test/mock-server.mjs [port]
import http from "node:http";
import { randomUUID as uuid } from "node:crypto";

const PORT = +(process.argv[2] || 8080);
const db = { problems: [], tcs: {}, contests: [], students: [], teacherExists: false, sessions: [], events: {} };
const now = () => new Date().toISOString();
const sum = (c) => ({ id: c.id, title: c.title, status: c.status, durationSec: c.durationSec, scoringMode: c.scoringMode, startsAt: c.startsAt || null, endsAt: c.endsAt || null, problemCount: c.problems.length, enrolledCount: c.students.length, languages: c.languages || ["C", "CPP", "JAVA", "PYTHON"] });
const detail = (c) => ({ ...sum(c), problems: c.problems.map((p) => ({ ...p, title: db.problems.find((x) => x.id === p.problemId).title })), students: c.students.map((id) => { const s = db.students.find((x) => x.id === id); return { userId: s.id, username: s.username, fullName: s.fullName, studentRef: s.studentRef }; }) });
const ver = (c) => ({ ...c });

// ── sessions / events (mirrors AdminService.contestSessions and EventService.getEvents) ──
const SUSPICIOUS = ["PASTE", "FOCUS_LOST", "TAB_SWITCH", "SCREENSHOT_ATTEMPT", "PROCESS_BLOCKED", "KIOSK_EXIT_ATTEMPT", "APP_EXITED"];
const iso = (t) => new Date(t).toISOString();
function addSession(contestId, userId, status, startedAt, evs, endedAt = null) {
  const s = { id: uuid(), contestId, userId, status, startedAt: iso(startedAt), endedAt: endedAt && iso(endedAt) };
  db.sessions.push(s);
  db.events[s.id] = evs.map((e, i) => ({ seq: i, type: e.type, severity: e.severity || "INFO", ts: iso(e.at), payloadJson: JSON.stringify(e.payload || {}), hash: "h" + i, receivedAt: iso(e.at + 500) }));
  return s;
}
const beats = (from, to) => { const out = []; for (let t = from; t <= to; t += 60000) out.push({ type: "WD_HEARTBEAT", at: t, payload: { blocked: 0, pending: 0 } }); return out; };
/** Demo data on exam start, 10 min backdated: student 0 healthy, 1 heartbeats stopped 5 min ago + suspicious events, 2 not started, 3 ended cleanly. */
function seedDemo(c) {
  const t0 = Date.now() - 600000;
  c.students.forEach((uid, i) => {
    if (db.sessions.some((s) => s.contestId === c.id && s.userId === uid)) return;
    if (i % 4 === 0) addSession(c.id, uid, "ACTIVE", t0, [{ type: "SESSION_START", at: t0 }, ...beats(t0 + 60000, Date.now() - 30000)]);
    else if (i % 4 === 1) addSession(c.id, uid, "ACTIVE", t0, [{ type: "SESSION_START", at: t0 }, ...beats(t0 + 60000, t0 + 300000),
      { type: "PROCESS_BLOCKED", at: t0 + 320000, severity: "HIGH", payload: { name: "discord" } }, { type: "PASTE", at: t0 + 400000, severity: "MEDIUM", payload: { chars: 812 } }]);
    else if (i % 4 === 3) addSession(c.id, uid, "ENDED", t0, [{ type: "SESSION_START", at: t0 }, ...beats(t0 + 60000, t0 + 540000), { type: "FOCUS_LOST", at: t0 + 100000, severity: "MEDIUM", payload: {} }], t0 + 560000);
  });
}
function sessionRows(c) {
  return c.students.map((uid) => {
    const u = db.students.find((x) => x.id === uid), s = db.sessions.find((x) => x.contestId === c.id && x.userId === uid);
    const evs = s ? db.events[s.id] : [], byType = {};
    for (const e of evs) byType[e.type] = (byType[e.type] || 0) + 1;
    const max = (l) => (l.length ? l.map((e) => e.ts).sort().pop() : null);
    return { userId: uid, username: u.username, fullName: u.fullName, sessionId: s ? s.id : null, status: s ? s.status : "NOT_STARTED",
      startedAt: s ? s.startedAt : null, endedAt: s ? s.endedAt : null, lastHeartbeatAt: s ? max(evs) : null,
      events: evs.length, suspicious: evs.filter((e) => SUSPICIOUS.includes(e.type)).length, byType,
      lastEventAt: max(evs), lastWdHeartbeatAt: max(evs.filter((e) => e.type === "WD_HEARTBEAT")) };
  }).sort((a, b) => a.username.localeCompare(b.username));
}

const routes = [];
const on = (m, re, fn) => routes.push([m, new RegExp("^" + re + "$"), fn]);
const bad = (status, message) => Object.assign(new Error(message), { status });

on("GET", "/time", () => ({ now: now() }));
on("POST", "/auth/register", (b) => { if (db.teacherExists) throw bad(401, "Login required"); db.teacherExists = true; return { ok: 1 }; });
on("POST", "/auth/login", (b) => { if (b.password !== "teacherpass") throw bad(401, "Invalid credentials"); return { accessToken: "t", refreshToken: "r", user: { id: "u1", username: b.username, role: "TEACHER", fullName: "Test Teacher" } }; });
on("GET", "/problems", () => db.problems.map((p) => ({ ...p, testcaseCount: db.tcs[p.id].length })));
on("POST", "/problems", (b) => { const p = { id: uuid(), version: 1, ...b }; db.problems.push(p); db.tcs[p.id] = []; return { ...p, testcaseCount: 0 }; });
on("GET", "/problems/([^/]+)/testcases", (b, [id]) => db.tcs[id]);
on("POST", "/problems/([^/]+)/testcases", (b, [id]) => { const t = { id: uuid(), ordinal: db.tcs[id].length + 1, input: b.inputRef, expected: b.expectedRef, points: b.points, isSample: !!b.isSample, isHidden: !b.isSample }; db.tcs[id].push(t); return t; });
on("DELETE", "/problems/([^/]+)/testcases/([^/]+)", (b, [id, tc]) => { db.tcs[id] = db.tcs[id].filter((t) => t.id !== tc); return null; });
on("PUT", "/contests/([^/]+)/languages", (b, [id]) => { const c = db.contests.find((x) => x.id === id); c.languages = b.languages; return sum(c); });
on("GET", "/contests", () => db.contests.map(sum));
on("POST", "/contests", (b) => { const c = { id: uuid(), status: "DRAFT", problems: [], students: [], ...b }; db.contests.push(c); return sum(c); });
on("GET", "/contests/([^/]+)/detail", (b, [id]) => detail(db.contests.find((c) => c.id === id)));
on("POST", "/contests/([^/]+)/problems", (b, [id]) => { const c = db.contests.find((x) => x.id === id); if (c.status !== "DRAFT") throw bad(409, "Contest is not DRAFT"); c.problems.push(b); return null; });
on("POST", "/contests/([^/]+)/enroll", (b, [id]) => { const c = db.contests.find((x) => x.id === id); b.userIds.forEach((u) => !c.students.includes(u) && c.students.push(u)); return { enrolled: b.userIds.length }; });
on("DELETE", "/contests/([^/]+)/enroll/([^/]+)", (b, [id, u]) => { const c = db.contests.find((x) => x.id === id); c.students = c.students.filter((s) => s !== u); return null; });
on("POST", "/contests/([^/]+)/publish", (b, [id]) => { const c = db.contests.find((x) => x.id === id); c.status = "SCHEDULED"; return sum(c); });
on("POST", "/contests/([^/]+)/start", (b, [id]) => { const c = db.contests.find((x) => x.id === id); c.status = "RUNNING"; c.startsAt = now(); seedDemo(c); c.endsAt = new Date(Date.now() + c.durationSec * 1000).toISOString(); return sum(c); });
on("POST", "/contests/([^/]+)/stop", (b, [id]) => { const c = db.contests.find((x) => x.id === id); c.status = "ENDED"; return sum(c); });
on("GET", "/contests/([^/]+)/standings", (b, [id]) => { const c = db.contests.find((x) => x.id === id); return c.students.map((u, i) => { const s = db.students.find((x) => x.id === u); const per = {}; c.problems.forEach((p) => { if (i % 2 === 0) per[p.label] = p.points; }); return { userId: u, username: s.username, fullName: s.fullName, total: i % 2 === 0 ? c.problems.reduce((a, p) => a + p.points, 0) : 0, solved: i % 2 === 0 ? c.problems.length : 0, problems: per }; }); });
on("GET", "/contests/([^/]+)/submissions", (b, [id]) => { const c = db.contests.find((x) => x.id === id); return c.students.slice(0, 1).flatMap((u) => c.problems.map((p) => ({ id: uuid(), username: db.students.find((x) => x.id === u).username, fullName: "", label: p.label, problemTitle: "x", language: "PYTHON", status: "DONE", verdict: "AC", score: p.points, runtimeMs: 12, createdAt: now() }))); });
on("GET", "/contests/([^/]+)/sessions", (b, [id]) => sessionRows(db.contests.find((c) => c.id === id)));
on("GET", "/events", (b, m, q) => { const sid = q.get("sessionId"); if (!db.events[sid]) throw bad(404, "Session not found: " + sid); return db.events[sid]; });
// test hook: POST /__test/session {contestId,userId,status,startedAt,endedAt,events:[{type,at,severity,payload}]}
on("POST", "/__test/session", (b) => { const s = addSession(b.contestId, b.userId, b.status, b.startedAt, b.events || [], b.endedAt || null); return s; });
on("GET", "/users", () => db.students);
on("POST", "/users/students/bulk", (b) => { const created = [], skipped = []; for (const s of b.students) { if (db.students.some((x) => x.username === s.username)) skipped.push({ username: s.username, reason: "already exists" }); else { const u = { id: uuid(), role: "STUDENT", active: true, ...s }; db.students.push(u); created.push({ id: u.id, username: u.username }); } } return { created, skipped }; });
on("POST", "/users/([^/]+)/password", () => null);
on("GET", "/admin/judge/workers", () => ({ workers: [{ workerId: "judge-1", host: "lab-pc", version: "1.0", currentJob: null, jobsDone: 12, lastSeenAt: now(), online: true }, { workerId: "judge-2", host: "lab-pc", version: "1.0", currentJob: uuid(), jobsDone: 9, lastSeenAt: now(), online: true }], queue: { queued: 2, running: 1 } }));

http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    const path = req.url.split("?")[0];
    for (const [m, re, fn] of routes) {
      const mt = m === req.method && path.match(re);
      if (!mt) continue;
      try {
        const out = fn(raw ? JSON.parse(raw) : {}, mt.slice(1), new URL(req.url, "http://x").searchParams);
        res.writeHead(out === null ? 204 : 200, { "Content-Type": "application/json" });
        return res.end(out === null ? "" : JSON.stringify(out));
      } catch (e) { res.writeHead(e.status || 500, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ message: e.message })); }
    }
    res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ message: "Not found " + path }));
  });
}).listen(PORT, () => console.log(`mock API on :${PORT}  (teacher login: any username / password "teacherpass")`));
