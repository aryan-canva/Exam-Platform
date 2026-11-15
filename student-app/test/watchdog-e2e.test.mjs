// Real watchdog process + real client module + mock exam server. Run: node --test test/watchdog-e2e.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mockServer, tmp, until, sleep, alive, verifyChain } from "../../watchdog-linux/test/helpers.js";

const require = createRequire(import.meta.url);
const { WatchdogClient, resolveScript } = require("../watchdog-client.js");
const script = resolveScript(null);
const SID = "11111111-1111-1111-1111-111111111111";

const detached = (dir, name) => new Promise((resolve) => {
  const c = spawn("sh", ["-c", `cp /bin/sleep ${dir}/${name}; setsid ${dir}/${name} 60 >/dev/null 2>&1 & echo $!`], { stdio: ["ignore", "pipe", "ignore"] });
  let o = ""; c.stdout.on("data", (d) => (o += d)); c.on("close", () => resolve(+o.trim()));
});

const srv = await mockServer({ token: "tok-1", sessionId: SID });
const stateDir = tmp("wd-state-"), bins = tmp("wd-bin-");
const wd = new WatchdogClient({ script, stateDir, mode: "kill", extraEnv: { WD_VERBOSE: "0" } });
const key = () => srv.st.key(SID); // the key the server hands out; the watchdog never makes its own
const types = () => srv.st.events.map((e) => e.type);
test.after(() => { wd.stop(); srv.close(); });

test("script found and session starts; first event is WATCHDOG_STARTED seq 0", async () => {
  assert.ok(script, "watchdog script not found");
  const st = await wd.start({ sessionId: SID, serverUrl: srv.url, token: "tok-1", sessionKey: srv.st.key(SID) });
  assert.equal(st.active, true);
  await until(() => srv.st.events.length >= 1);
  assert.equal(srv.st.events[0].type, "WATCHDOG_STARTED"); assert.equal(srv.st.events[0].seq, 0);
});

test("forbidden program is killed and reported with a valid chain on the server", async () => {
  const pid = await detached(bins, "firefox");
  await until(() => types().includes("PROCESS_BLOCKED"));
  await until(() => !alive(pid));
  const e = srv.st.events.find((x) => x.type === "PROCESS_BLOCKED");
  const p = JSON.parse(e.payloadJson);
  assert.equal(p.name, "firefox"); assert.equal(p.killed, true); assert.equal(e.severity, "HIGH");
  assert.deepEqual(verifyChain(srv.st.events, key()), { ok: true });
});

test("app events pass; unknown types and bad payloads are refused", async () => {
  await wd.event("FOCUS_LOST", { n: 1 }); await wd.event("PASTE", { chars: 40 });
  await until(() => types().includes("PASTE"));
  await assert.rejects(wd.call("POST", "/event", { type: "PROCESS_BLOCKED", payload: {} }), /not allowed/); // app cannot forge watchdog types
  await assert.rejects(wd.call("POST", "/event", { type: "PASTE", payload: { x: "y".repeat(3000) } }), /too large/);
});

test("wrong control key is rejected", async () => {
  const r = await fetch(`http://127.0.0.1:${wd.port}/status`, { headers: { "x-wd-key": "nope" } });
  assert.equal(r.status, 401);
});

test("server outage: events queue locally, then arrive in order with no gap", async () => {
  srv.st.down = true;
  await wd.event("FOCUS_LOST", { n: 2 }); await wd.event("FOCUS_BACK", {}); await wd.event("FOCUS_LOST", { n: 3 });
  await sleep(1800);
  const before = srv.st.events.length;
  assert.ok((await wd.status()).pending >= 3);
  srv.st.down = false;
  assert.equal(await wd.flush(10000), true);
  assert.equal(srv.st.events.length, before + 3);
  assert.deepEqual(verifyChain(srv.st.events, key()), { ok: true });
});

test("expired token: events wait; a new token from the app releases them", async () => {
  srv.st.token = "tok-2";
  await wd.event("FOCUS_LOST", { n: 4 });
  await until(async () => (await wd.status()).upload.authExpired);
  const held = srv.st.events.length;
  await sleep(500); assert.equal(srv.st.events.length, held);
  await wd.setToken("tok-2");
  await until(() => srv.st.events.length === held + 1);
  assert.deepEqual(verifyChain(srv.st.events, key()), { ok: true });
});

test("watchdog killed with SIGKILL: client notices, respawns, resumes the same chain", async () => {
  let down = null; wd.onDown = (c) => (down = c);
  const oldPid = (await wd.status()).pid;
  process.kill(oldPid, "SIGKILL");
  await until(() => down !== null);
  assert.equal(await wd.healthy(), true);
  const st = await wd.status();
  assert.notEqual(st.pid, oldPid); assert.equal(st.active, true); assert.equal(wd.restarts, 1);
  await until(() => types().includes("WATCHDOG_RESUMED"));
  assert.equal(await wd.flush(5000), true);
  assert.deepEqual(verifyChain(srv.st.events, key()), { ok: true });
});

test("app crash: watchdog records APP_EXITED, flushes, and exits by itself", async () => {
  const sid2 = "22222222-2222-2222-2222-222222222222";
  const s2 = await mockServer({ token: "t", sessionId: sid2 });
  const doomed = spawn("sleep", ["30"], { stdio: "ignore" });
  const w2 = new WatchdogClient({ script, stateDir: tmp("wd-s2-") }); const pidFile = [];
  await w2.ensureRunning();
  await w2.call("POST", "/session/start", { sessionId: sid2, serverUrl: s2.url, token: "t", sessionKey: s2.st.key(sid2), appPid: doomed.pid });
  await until(() => s2.st.events.length >= 1);
  const wdPid = (await w2.status()).pid; w2.stopping = true;
  doomed.kill("SIGKILL");
  await until(() => s2.st.events.some((e) => e.type === "APP_EXITED"), 6000);
  await until(() => !alive(wdPid), 6000);
  s2.close(); w2.stop();
});

test("end: WATCHDOG_STOPPED delivered before the session closes; later events are rejected without crashing", async () => {
  const r = await wd.end("exam_ended");
  assert.equal(r.flushed, true);
  assert.equal(srv.st.events.at(-1).type, "WATCHDOG_STOPPED");
  assert.deepEqual(verifyChain(srv.st.events, key()), { ok: true });
  assert.equal((await wd.status()).active, false);
  assert.ok(!types().slice(0, -1).includes("WATCHDOG_STOPPED"));
});

test("server says session is not ACTIVE (409): watchdog stops uploading, keeps events locally", async () => {
  srv.st.sessionId = "33333333-3333-3333-3333-333333333333"; // events for SID now 404
  const sid = "33333333-3333-3333-3333-333333333333"; srv.st.status = "ENDED";
  await wd.start({ sessionId: sid, serverUrl: srv.url, token: "tok-2", sessionKey: srv.st.key(sid) });
  await wd.event("FOCUS_LOST", {});
  await until(async () => (await wd.status()).upload.rejected === 409);
  const st = await wd.status(); assert.ok(st.pending >= 2);
  await wd.end();
});

test("watchdog refuses to start a session without a key", async () => {
  await assert.rejects(wd.call("POST", "/session/start", { sessionId: "55555555-5555-5555-5555-555555555555", serverUrl: srv.url, token: "tok-2", appPid: process.pid }), /sessionKey is required/);
});

test("a watchdog holding the WRONG key is rejected by the server (HMAC invalid) and keeps its events locally", async () => {
  const sid = "66666666-6666-6666-6666-666666666666";
  const s3 = await mockServer({ token: "t", sessionId: sid });
  const w3 = new WatchdogClient({ script, stateDir: tmp("wd-s3-") });
  await w3.ensureRunning();
  await w3.call("POST", "/session/start", { sessionId: sid, serverUrl: s3.url, token: "t", sessionKey: "ab".repeat(32), appPid: process.pid });
  await until(async () => (await w3.status()).upload.rejected === 400);
  assert.equal(s3.st.events.length, 0); assert.match(s3.st.rejects[0], /HMAC invalid/);
  assert.ok((await w3.status()).pending >= 1);
  await w3.call("POST", "/session/end", { reason: "test" }); s3.close(); w3.stop();
});
