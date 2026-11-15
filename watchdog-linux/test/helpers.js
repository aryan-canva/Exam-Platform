import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { verifyChain } from "../lib/chain.js";
import { ingest, sessionKey } from "./server-rules.js";

export const tmp = (p = "wd-") => fs.mkdtempSync(path.join(os.tmpdir(), p));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(fn, ms = 8000, step = 50) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(step); }
  throw new Error("timeout waiting for condition");
}
export const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** A program that just sleeps, but whose process name is `name` (copy of /bin/sleep). */
export function fakeProgram(dir, name, seconds = 60) {
  const bin = path.join(dir, name);
  if (!fs.existsSync(bin)) { fs.copyFileSync("/bin/sleep", bin); fs.chmodSync(bin, 0o755); }
  const c = spawn(bin, [String(seconds)], { stdio: "ignore", detached: true });
  c.unref();
  return c;
}

/** Mock of the exam server's events endpoint. Rules live in server-rules.js (mirror of EventService). st.key() = the session key the real server would return from /sessions/start. */
export function mockServer({ token = "tok-1", sessionId = "11111111-1111-1111-1111-111111111111" } = {}) {
  const st = { token, sessionId, status: "ACTIVE", events: [], calls: 0, down: false, requests: [], rejects: [], key: (sid = st.sessionId) => sessionKey(sid) };
  const server = http.createServer((req, res) => {
    let raw = ""; req.on("data", (c) => (raw += c));
    req.on("end", () => {
      st.calls++;
      const send = (c, o) => { res.writeHead(c, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
      if (st.down) return req.destroy();
      if (req.method === "POST" && req.url === "/sessions/start") {
        if (req.headers.authorization !== `Bearer ${st.token}`) return send(401, { error: "expired" });
        return send(201, { id: st.sessionId, status: st.status, sessionKey: st.key() });
      }
      if (req.method === "POST" && req.url === "/events/ingest") {
        if (req.headers.authorization !== `Bearer ${st.token}`) return send(401, { error: "expired" });
        const b = JSON.parse(raw); st.requests.push(b.events.length);
        if (b.sessionId !== st.sessionId) return send(404, { error: "Session not found" });
        if (st.status !== "ACTIVE") return send(409, { error: "Session is not ACTIVE" });
        const r = ingest(st.events, st.sessionId, b);
        if (r.code !== 200) st.rejects.push(r.body.message);
        return send(r.code, r.body);
      }
      send(404, { error: "nope" });
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ st, server, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}
export { verifyChain };
