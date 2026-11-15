import test from "node:test";
import assert from "node:assert/strict";
import { ProcessMonitor, matches, scan } from "../lib/procmon.js";
import { tmp, fakeProgram, until, alive, sleep } from "./helpers.js";

const mk = (extra = {}) => { const ev = []; const m = new ProcessMonitor({ onEvent: (t, s, p) => ev.push({ t, s, p }), protectedPids: [process.pid], intervalMs: 50, ...extra }); return { m, ev }; };

test("name matching: exact, prefix wildcard, case-insensitive", () => {
  assert.ok(matches(["firefox"], "Firefox")); assert.ok(matches(["google-chrome*"], "google-chrome-stable"));
  assert.ok(!matches(["code"], "codec")); assert.ok(!matches([], "x"));
});

test("scan sees this process and skips kernel threads", () => {
  const all = scan(); assert.ok(all.has(process.pid)); assert.ok(!all.has(2));
  assert.equal(all.get(process.pid).exe, "node");
});

test("kills a forbidden program started after the baseline, leaves others alone", async () => {
  const dir = tmp(); const { m, ev } = mk(); m.start();
  // spawned by a *different* parent than a protected one: detach via sh so it is not our descendant
  const { spawn } = await import("node:child_process");
  const sh = (name) => spawn("sh", ["-c", `cp /bin/sleep ${dir}/${name} 2>/dev/null; setsid ${dir}/${name} 60 >/dev/null 2>&1 & echo $!`], { stdio: ["ignore", "pipe", "ignore"] });
  const pid = (c) => new Promise((r) => { let o = ""; c.stdout.on("data", (d) => (o += d)); c.on("close", () => r(+o.trim())); });
  const bad = await pid(sh("firefox")), good = await pid(sh("harmless-tool"));
  await until(() => ev.some((e) => e.p.pid === bad));
  await until(() => !alive(bad));
  const e = ev.find((x) => x.p.pid === bad);
  assert.equal(e.t, "PROCESS_BLOCKED"); assert.equal(e.s, "HIGH"); assert.equal(e.p.when, "started"); assert.equal(e.p.killed, true);
  await sleep(300);
  assert.ok(alive(good)); assert.ok(!ev.some((x) => x.p.pid === good));
  assert.equal(ev.filter((x) => x.p.pid === bad).length, 1); // reported once
  process.kill(good, "SIGKILL"); m.stop();
});

test("forbidden program already open at start is reported as present_at_start", async () => {
  const dir = tmp(); const c = fakeProgram(dir, "chromium");
  await until(() => scan().has(c.pid));
  const { m, ev } = mk({ protectedPids: [] }); m.start(); m.stop();
  const e = ev.find((x) => x.p.pid === c.pid);
  assert.equal(e.p.when, "present_at_start"); assert.equal(e.p.killed, true);
  await until(() => !alive(c.pid));
});

test("descendants of a protected pid and allow-listed names are never touched", async () => {
  const dir = tmp(); const { m, ev } = mk(); m.start();
  const child = fakeProgram(dir, "firefox");          // our own child: protected tree
  const sh = (await import("node:child_process")).spawn("sh", ["-c", `cp /bin/sleep ${dir}/slack; setsid ${dir}/slack 30 >/dev/null 2>&1 & echo $!`], { stdio: ["ignore", "pipe", "ignore"] });
  let out = ""; sh.stdout.on("data", (d) => (out += d)); await new Promise((r) => sh.on("close", r));
  const slack = +out.trim(); m.allow = ["slack"];
  await sleep(500);
  assert.ok(alive(child.pid)); assert.ok(alive(slack)); assert.equal(ev.length, 0);
  process.kill(child.pid, "SIGKILL"); process.kill(slack, "SIGKILL"); m.stop();
});

test("LOG mode reports but does not kill; kill failure is reported", async () => {
  const dir = tmp(); const { m, ev } = mk({ kill: false, protectedPids: [] });
  const c = fakeProgram(dir, "discord"); await until(() => scan().has(c.pid));
  m.start(); m.stop();
  assert.equal(ev[0].s, "MEDIUM"); assert.equal(ev[0].p.killed, false); assert.ok(alive(c.pid));
  process.kill(c.pid, "SIGKILL");
  const { m: m2, ev: ev2 } = mk({ protectedPids: [], killFn: () => { const e = new Error("x"); e.code = "EPERM"; throw e; } });
  const d = fakeProgram(dir, "discord"); await until(() => scan().has(d.pid));
  m2.start(); m2.stop();
  assert.equal(ev2.find((x) => x.p.pid === d.pid).p.error, "EPERM");
  process.kill(d.pid, "SIGKILL");
});
