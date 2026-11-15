// Fake exam server for trying the student app without Postgres:  node test/mock-server.mjs [port]
// Logins: student1 / studentpass. "Running" exam lasts 1 hour, "Short" exam ends 6 s after the server starts.
import http from "node:http";
import { ingest, sessionKey } from "../../watchdog-linux/test/server-rules.js"; // same rules as the real EventService

export function startMock(port = 8080) {
  const now = () => new Date().toISOString();
  const P = { a: { id: "p-sum", title: "Sum of two numbers", statementMd: "Read **two integers** and print their sum.\n\n- `a`, `b` fit in 32 bits\n\n```\n1 2\n```", timeLimitMs: 2000, memoryLimitKb: 262144, sampleTestcases: [{ id: "t1", inputRef: "1 2", expectedRef: "3" }] },
              b: { id: "p-rev", title: "Reverse a string", statementMd: "Print the string reversed.", timeLimitMs: 1000, memoryLimitKb: 131072, sampleTestcases: [{ id: "t2", inputRef: "abc", expectedRef: "cba" }] } };
  const contests = [
    { id: "c-run", title: "Midterm Exam", status: "RUNNING", durationSec: 3600, scoringMode: "IOI", problemCount: 2, enrolledCount: 3, endsAt: new Date(Date.now() + 3600e3).toISOString(), problems: [{ id: "p-sum", label: "A", title: P.a.title, points: 100 }, { id: "p-rev", label: "B", title: P.b.title, points: 50 }] },
    { id: "c-short", title: "Short Quiz", languages: ["PYTHON", "JAVA"], status: "RUNNING", durationSec: 6, scoringMode: "ICPC", problemCount: 1, enrolledCount: 3, problems: [{ id: "p-sum", label: "A", title: P.a.title, points: 100 }] },
    { id: "c-wait", title: "Final (not started)", status: "SCHEDULED", durationSec: 7200, scoringMode: "ICPC", problemCount: 3, enrolledCount: 3, problems: [] },
  ];
  const subs = []; const runs = {}; const sessions = {}; const evStore = {};
  const bad = (s, m) => Object.assign(new Error(m), { status: s });
  const routes = [];
  const on = (m, re, fn) => routes.push([m, new RegExp("^" + re + "$"), fn]);
  on("GET", "/time", () => ({ now: now() }));
  on("POST", "/auth/login", (b) => { if (b.username !== "student1" || b.password !== "studentpass") throw bad(401, "Invalid credentials"); return { accessToken: "tok", refreshToken: "r", user: { id: "u-1", username: "student1", role: "STUDENT", fullName: "Asha Verma" } }; });
  on("GET", "/contests/mine", () => contests.map(({ problems, ...c }) => c));
  on("GET", "/contests/([^/]+)", (b, [id]) => { const c = contests.find((x) => x.id === id); if (c.id === "c-short" && !c.endsAt) c.endsAt = new Date(Date.now() + 9e3).toISOString(); /* clock starts on first open */ return { id: c.id, title: c.title, languages: c.languages, status: c.status, endsAt: c.endsAt, durationSec: c.durationSec, problems: c.problems }; });
  on("GET", "/problems/([^/]+)", (b, [id]) => ({ id, ...(id === "p-sum" ? P.a : P.b) }));
  on("POST", "/sessions/start", (b) => { const c = contests.find((x) => x.id === b.contestId); if (c.status !== "RUNNING") throw bad(409, "Contest is not currently RUNNING"); sessions[b.contestId] ||= { id: "s-" + b.contestId, status: "ACTIVE" }; return { ...sessions[b.contestId], sessionKey: sessionKey(sessions[b.contestId].id) }; });
  on("POST", "/events/ingest", (b) => { const r = ingest(evStore[b.sessionId] ||= [], b.sessionId, b); if (r.code !== 200) throw bad(r.code, r.body.message); return r.body; });
  on("POST", "/sessions/([^/]+)/heartbeat", (b, [id]) => { const s = Object.values(sessions).find((x) => x.id === id); return { ...s, lastSeq: b.seq }; });
  on("POST", "/sessions/([^/]+)/end", () => ({ status: "ENDED" }));
  on("POST", "/runs", (b) => { const id = "r" + Object.keys(runs).length; runs[id] = { n: 0, b }; return { id, status: "QUEUED" }; });
  on("GET", "/runs/([^/]+)", (b, [id]) => { const r = runs[id]; if (r.n++ < 1) return { id, status: "RUNNING" };
    const code = r.b.sourceCode; if (code.includes("SYNTAXERR")) return { id, status: "DONE", result: { verdict: "CE", compile: { ok: false, output: "main.cpp:3: error: expected ';'" } } };
    return { id, status: "DONE", result: { verdict: "OK", stdout: "echo:" + r.b.stdin, stderr: "", exitCode: 0, timeMs: 7 } }; });
  on("POST", "/submissions", (b) => { const s = { id: "sub" + subs.length, problemId: b.problemId, language: b.language, status: "PENDING", verdict: null, score: 0, createdAt: now(), n: 0, code: b.sourceCode }; subs.push(s); return { id: s.id, status: "PENDING" }; });
  on("GET", "/submissions", () => subs.map(({ n, code, ...s }) => s));
  on("GET", "/submissions/([^/]+)", (b, [id]) => { const s = subs.find((x) => x.id === id); if (s.n++ < 1) return { ...s, status: "RUNNING" };
    if (s.code.includes("SYNTAXERR")) { Object.assign(s, { status: "DONE", verdict: "CE", score: 0 }); return { ...s, tests: [], compileOutput: "error: expected ';' before '}'" }; }
    const ok = !s.code.includes("WRONG"); Object.assign(s, { status: "DONE", verdict: ok ? "AC" : "WA", score: ok ? 100 : 0, runtimeMs: 11 });
    return { ...s, tests: [{ ordinal: 1, isSample: true, verdict: "AC", timeMs: 5 }, { ordinal: 2, isSample: false, verdict: ok ? "AC" : "WA", timeMs: 6 }] }; });

  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Headers", "*"); res.setHeader("Access-Control-Allow-Methods", "*");
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    let raw = ""; req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const path = req.url.split("?")[0];
      for (const [m, re, fn] of routes) {
        const mt = m === req.method && path.match(re); if (!mt) continue;
        try { const out = fn(raw ? JSON.parse(raw) : {}, mt.slice(1)); res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(out)); }
        catch (e) { res.writeHead(e.status || 500, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ message: e.message })); }
      }
      res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ message: "Not found " + path }));
    });
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}
if (process.argv[1].endsWith("mock-server.mjs")) startMock(+(process.argv[2] || 8080)).then(() => console.log("mock exam server up (student1 / studentpass)"));
