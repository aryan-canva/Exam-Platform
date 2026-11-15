import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { canonical } from "../lib/canonical.js";
import { computeHash, computeHmac, GENESIS, Journal, verifyChain } from "../lib/chain.js";
import { tmp } from "./helpers.js";

const KEY = Buffer.from([...Array(32).keys()]).toString("hex");

test("matches an independent Python computation (hash and HMAC)", () => {
  const payload = { name: "firefox", pid: 123, killed: true, cmd: 'é"x' };
  const h = computeHash(GENESIS, "PROCESS_BLOCKED", "HIGH", "2026-11-13T10:00:00.000Z", payload);
  assert.equal(h, "306d5f77e7e1c4616df89a771ff3cfeb23fff8206287cd82e7fbc8b9cb19cade");
  const key = Buffer.from([...Array(32).keys()]).toString("hex");
  assert.equal(computeHmac(key, h), "1390fe41ed0006ef14dad6cfa5db68d96d2f0e77b55d3b732d3bcf6d41df9584");
});

test("canonical JSON sorts keys deeply and rejects non-finite numbers", () => {
  assert.equal(canonical({ b: [3, { z: 1, a: null }], a: "x", u: undefined }), '{"a":"x","b":[3,{"a":null,"z":1}]}');
  assert.throws(() => canonical({ n: NaN }));
});

test("journal chains, verifies, and detects tampering", () => {
  const j = new Journal(tmp(), "s-1", KEY);
  for (let i = 0; i < 5; i++) j.emit("T", "INFO", { i });
  assert.equal(j.records[0].seq, 0);
  assert.equal(j.records[0].prevHash, GENESIS);
  assert.deepEqual(verifyChain(j.records, j.key), { ok: true });
  const edit = structuredClone(j.records); edit[2].payloadJson = '{"i":99}';
  assert.equal(verifyChain(edit, j.key).badSeq, 2);
  const del = j.records.filter((r) => r.seq !== 3);
  assert.match(verifyChain(del, j.key).problem, /gap/);
  assert.equal(verifyChain(j.records, "00".repeat(32)).problem, "HMAC invalid");
  const forged = structuredClone(j.records); forged[1].payloadJson = '{"i":7}';
  forged[1].hash = computeHash(forged[1].prevHash, "T", "INFO", forged[1].ts, { i: 7 });
  assert.notEqual(verifyChain(forged, j.key).ok, true); // re-hashing without the key still fails
});

test("journal survives restart, keeps ack, and tolerates a torn last line", () => {
  const dir = tmp(); const j = new Journal(dir, "s-2", KEY);
  j.emit("A", "INFO"); j.emit("B", "INFO"); j.emit("C", "INFO"); j.ack(1);
  fs.appendFileSync(j.logFile, '{"seq":3,"type":"TORN'); // crash mid-write
  const k = new Journal(dir, "s-2", KEY);
  assert.equal(k.key, KEY); assert.equal(k.records.length, 3); assert.equal(k.pendingCount, 1);
  const r = k.emit("D", "INFO");
  assert.equal(r.seq, 3); assert.equal(r.prevHash, j.records[2].hash);
  assert.equal(verifyChain(k.records, k.key).ok, true);
});

test("journal refuses to start without the server's key, and never writes it to disk", () => {
  assert.throws(() => new Journal(tmp(), "s-3"), /session key/);
  assert.throws(() => new Journal(tmp(), "s-3", "not-hex"), /session key/);
  const dir = tmp(); const j = new Journal(dir, "s-4", KEY); j.emit("A", "INFO");
  assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith(".key")));
  assert.ok(!fs.readFileSync(j.logFile, "utf8").includes(KEY));
});
