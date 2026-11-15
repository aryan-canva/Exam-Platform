import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SUSPICIOUS_TYPES, GAP_LIMIT_MS, heartbeatGaps, summarize, listWarning, buildTimeline, payloadText, fmtGap } from "../src/integrity.js";

const T0 = Date.parse("2026-11-13T10:00:00.000Z");
const iso = (ms) => new Date(T0 + ms).toISOString();
const hb = (sec, seq = sec) => ({ seq, type: "WD_HEARTBEAT", severity: "INFO", ts: iso(sec * 1000), payloadJson: "{}" });
const ev = (type, sec, seq = sec) => ({ seq, type, severity: "INFO", ts: iso(sec * 1000), payloadJson: "{}" });
const sess = (o = {}) => ({ status: "ACTIVE", startedAt: iso(0), endedAt: null, ...o });

test("suspicious list matches EventService.SUSPICIOUS_TYPES on the server", () => {
  const src = fs.readFileSync(new URL("../../server/src/main/java/com/codingexam/platform/service/EventService.java", import.meta.url), "utf8");
  const block = src.match(/SUSPICIOUS_TYPES\s*=\s*List\.of\(([^)]*)\)/s)[1];
  const server = [...block.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual([...SUSPICIOUS_TYPES].sort(), server);
});

test("gap limit is 2 minutes", () => assert.equal(GAP_LIMIT_MS, 120000));

test("regular 60 s heartbeats: no gap", () => {
  const e = [0, 60, 120, 180, 240].map((s) => hb(s));
  assert.deepEqual(heartbeatGaps(e, sess(), T0 + 250000), []);
});

test("exactly 2 minutes is not a gap, 2 min 1 s is", () => {
  assert.equal(heartbeatGaps([hb(0), hb(120)], sess({ startedAt: iso(0) }), T0 + 121000).length, 0);
  const g = heartbeatGaps([hb(0), hb(121)], sess(), T0 + 122000);
  assert.equal(g.length, 1);
  assert.equal(g[0].sec, 121);
  assert.equal(g[0].open, false);
});

test("heartbeats that stopped: open gap measured to now", () => {
  const g = heartbeatGaps([hb(0), hb(60), hb(120)], sess(), T0 + 120000 + 300000);
  assert.equal(g.length, 1);
  assert.equal(g[0].open, true);
  assert.equal(g[0].sec, 300);
});

test("no heartbeat ever: gap counted from session start; quiet within 2 min", () => {
  assert.equal(heartbeatGaps([], sess(), T0 + 119000).length, 0);
  const g = heartbeatGaps([ev("SESSION_START", 0)], sess(), T0 + 200000);
  assert.equal(g[0].sec, 200);
  assert.equal(g[0].open, true);
});

test("late first heartbeat is a closed gap from session start", () => {
  const g = heartbeatGaps([hb(300)], sess(), T0 + 310000);
  assert.equal(g.length, 1);
  assert.equal(g[0].sec, 300);
  assert.equal(g[0].open, false);
});

test("ended session: no open gap, but stopping long before the end shows", () => {
  const s = sess({ status: "ENDED", endedAt: iso(900000) });
  const g = heartbeatGaps([hb(0), hb(60), hb(120)], s, T0 + 9e9);
  assert.equal(g.length, 1);
  assert.equal(g[0].open, false);
  assert.equal(g[0].sec, 780);
  assert.equal(heartbeatGaps([hb(0), hb(60), hb(120)], sess({ status: "ENDED", endedAt: iso(150000) }), T0 + 9e9).length, 0);
});

test("unsorted events and garbage timestamps do not break it", () => {
  const e = [hb(120), { seq: 9, type: "WD_HEARTBEAT", ts: "not a date" }, hb(0), hb(60)];
  assert.deepEqual(heartbeatGaps(e, sess(), T0 + 130000), []);
  assert.deepEqual(heartbeatGaps(null, {}, T0), []);
});

test("summarize counts suspicious using the server's list only", () => {
  const e = [hb(0), ev("PASTE", 5), ev("PROCESS_BLOCKED", 6), ev("APP_EXITED", 7), ev("KIOSK_EXIT_ATTEMPT", 8), ev("FOCUS_BACK", 9), ev("DEVTOOLS_ATTEMPT", 10), ev("FOCUS_LOST", 11)];
  const s = summarize(e, sess(), T0 + 30000);
  assert.equal(s.total, 8);
  assert.equal(s.suspicious, 5);
  assert.equal(s.byType.PASTE, 1);
  assert.equal(s.openGap, null);
});

test("listWarning: only ACTIVE sessions, uses lastWdHeartbeatAt", () => {
  const row = { status: "ACTIVE", startedAt: iso(0), lastWdHeartbeatAt: iso(60000) };
  assert.equal(listWarning(row, T0 + 60000 + 120000), null);
  const w = listWarning(row, T0 + 60000 + 121000);
  assert.ok(w && w.sec === 121 && /2m 01s/.test(w.text));
  assert.equal(listWarning({ ...row, status: "ENDED" }, T0 + 9e9), null);
  assert.equal(listWarning({ status: "NOT_STARTED" }, T0 + 9e9), null);
  const none = listWarning({ status: "ACTIVE", startedAt: iso(0), lastWdHeartbeatAt: null }, T0 + 300000);
  assert.match(none.text, /since the session started/);
  assert.equal(listWarning({ status: "ACTIVE", startedAt: null, lastWdHeartbeatAt: null }, T0), null);
});

test("timeline: newest first, heartbeats hidden by default, gap marker merged, suspicious-only", () => {
  const e = [ev("SESSION_START", 0), hb(60), ev("PASTE", 100), hb(300)];
  const gaps = heartbeatGaps(e, sess(), T0 + 310000);
  const t = buildTimeline(e, gaps);
  assert.deepEqual(t.map((x) => x.kind === "gap" ? "GAP" : x.e.type), ["PASTE", "GAP", "SESSION_START"]);
  assert.equal(buildTimeline(e, gaps, { hideHeartbeats: false }).length, 5);
  assert.deepEqual(buildTimeline(e, gaps, { onlySuspicious: true }).map((x) => x.e.type), ["PASTE"]);
});

test("payloadText and fmtGap", () => {
  assert.equal(payloadText('{"name":"discord","pid":4}'), "name: discord, pid: 4");
  assert.equal(payloadText("not json"), "not json");
  assert.equal(payloadText(null), "");
  assert.ok(payloadText("x".repeat(500)).length <= 120);
  assert.equal(fmtGap(45), "45s");
  assert.equal(fmtGap(125), "2m 05s");
  assert.equal(fmtGap(3780), "1h 03m");
});
