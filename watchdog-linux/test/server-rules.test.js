// The server's ingest rules (JS mirror of EventService), exercised with chains made by the real watchdog Journal.
import test from "node:test";
import assert from "node:assert/strict";
import { Journal, computeHash, computeHmac } from "../lib/chain.js";
import { ingest, sessionKey, serverHash, SUSPICIOUS, GENESIS } from "./server-rules.js";
import { tmp } from "./helpers.js";

const SID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const mk = (n = 4, sid = SID) => { const j = new Journal(tmp(), sid, sessionKey(sid)); for (let i = 0; i < n; i++) j.emit("PASTE", "MEDIUM", { i, s: 'é"\\' }); return j; };
const send = (store, recs, sid = SID) => ingest(store, sid, { sessionId: sid, events: recs });

test("server hash formula (text based, as in Java) equals the watchdog's canonical-JSON hash", () => {
  const j = mk(3);
  for (const r of j.records) assert.equal(serverHash(r.prevHash, r.type, r.severity, r.ts, r.payloadJson), r.hash);
});

test("session key: per session, stable, 64 hex", () => {
  assert.match(sessionKey(SID), /^[0-9a-f]{64}$/);
  assert.equal(sessionKey(SID), sessionKey(SID));
  assert.notEqual(sessionKey(SID), sessionKey("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"));
  assert.notEqual(sessionKey(SID), sessionKey(SID, "another-secret-another-secret-123456"));
});

test("a valid chain is accepted, in one batch or several", () => {
  const j = mk(5), store = [];
  assert.deepEqual(send(store, j.records.slice(0, 2)), { code: 200, body: { accepted: 2, duplicates: 0, nextSeq: 2 } });
  assert.deepEqual(send(store, j.records.slice(2)), { code: 200, body: { accepted: 3, duplicates: 0, nextSeq: 5 } });
  assert.equal(store.length, 5);
});

test("first event must be seq 0 with the all-zero prevHash", () => {
  const j = mk(3);
  const r = send([], j.records.slice(1));
  assert.equal(r.code, 400); assert.match(r.body.message, /expected seq 0/);
  assert.equal(j.records[0].prevHash, GENESIS);
});

test("a gap or reorder is rejected and nothing from the batch is stored", () => {
  const j = mk(5), store = [];
  assert.equal(send(store, j.records.slice(0, 2)).code, 200);
  const r = send(store, [j.records[2], j.records[4]]);
  assert.equal(r.code, 400); assert.match(r.body.message, /expected seq 3/);
  assert.equal(store.length, 2, "all-or-nothing: event 2 must not have been kept");
  assert.equal(send(store, [j.records[3]]).code, 400);
});

test("wrong prevHash is rejected", () => {
  const j = mk(3), store = [];
  const bad = structuredClone(j.records); bad[1].prevHash = "1".repeat(64);
  assert.match(send(store, bad).body.message, /prevHash/);
});

test("edited payload is rejected (hash mismatch); re-hashing without the key is rejected (HMAC)", () => {
  const j = mk(3);
  const edit = structuredClone(j.records); edit[1].payloadJson = '{"i":99}';
  assert.match(send([], edit).body.message, /hash does not match/);
  const forged = structuredClone(j.records); forged[0].payloadJson = '{"i":7}';
  forged[0].hash = computeHash(forged[0].prevHash, forged[0].type, forged[0].severity, forged[0].ts, { i: 7 });
  assert.match(send([], forged).body.message, /HMAC invalid/);
});

test("events signed with a key the server did not issue are rejected", () => {
  const j = new Journal(tmp(), SID, "ab".repeat(32)); j.emit("PASTE", "MEDIUM", {});
  assert.match(send([], j.records).body.message, /HMAC invalid/);
  const other = new Journal(tmp(), SID, sessionKey("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")); other.emit("PASTE", "MEDIUM", {});
  assert.match(send([], other.records).body.message, /HMAC invalid/); // another session's key does not work here
});

test("retry after a lost response is safe; a different event for a stored seq is tampering", () => {
  const j = mk(3), store = [];
  send(store, j.records);
  assert.deepEqual(send(store, j.records.slice(1)).body, { accepted: 0, duplicates: 2, nextSeq: 3 });
  const swapped = structuredClone(j.records[1]); swapped.payloadJson = '{"i":5}';
  swapped.hash = computeHash(swapped.prevHash, swapped.type, swapped.severity, swapped.ts, { i: 5 }); swapped.hmac = computeHmac(sessionKey(SID), swapped.hash);
  assert.match(send(store, [swapped]).body.message, /different hash/);
  assert.equal(store.length, 3);
});

test("format checks: type, severity, ts, hex", () => {
  const j = mk(1), r = j.records[0];
  const t = (patch, re) => assert.match(send([], [{ ...r, ...patch }]).body.message, re);
  t({ type: "paste" }, /invalid type/); t({ severity: "URGENT" }, /invalid severity/);
  t({ ts: "2026-11-13T10:00:00Z" }, /ts must be/); t({ hmac: r.hmac.toUpperCase() }, /lower-case hex/);
});

test("suspicious list includes the three watchdog types", () => {
  for (const t of ["PROCESS_BLOCKED", "KIOSK_EXIT_ATTEMPT", "APP_EXITED", "PASTE", "FOCUS_LOST"]) assert.ok(SUSPICIOUS.includes(t), t);
});
