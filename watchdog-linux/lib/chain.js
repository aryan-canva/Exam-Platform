// Hash chain + HMAC, same rule as the Windows harness (EventChain):
//   hash = SHA256(prevHash + canonical({type,severity,ts,payload}))   (lower-case hex)
//   hmac = HMAC-SHA256(sessionKey, hash as UTF-8 hex text)
// sessionKey is the server's per-session key (returned by POST /sessions/start); the watchdog never makes its own
// and does not write it to disk (a resumed watchdog is handed it again by the app).
// Differences forced by the server: seq starts at 0 (EventService expects 0), payload travels as the
// string `payloadJson` (= canonical(payload)).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonical } from "./canonical.js";

export const GENESIS = "0".repeat(64);
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
export const computeHash = (prev, type, severity, ts, payload) =>
  sha256(prev + canonical({ type, severity, ts, payload }));
export const computeHmac = (keyHex, hash) =>
  crypto.createHmac("sha256", Buffer.from(keyHex, "hex")).update(hash, "utf8").digest("hex");

/** Re-derives every link of a list of records (as sent to the server). Returns {ok, badSeq, problem}. */
export function verifyChain(records, keyHex) {
  let prev = GENESIS, seq = 0;
  for (const r of records) {
    if (r.seq !== seq) return { ok: false, badSeq: r.seq, problem: `sequence gap/reorder: expected ${seq}` };
    if (r.prevHash !== prev) return { ok: false, badSeq: r.seq, problem: "prevHash mismatch" };
    const h = computeHash(r.prevHash, r.type, r.severity, r.ts, JSON.parse(r.payloadJson));
    if (h !== r.hash) return { ok: false, badSeq: r.seq, problem: "hash mismatch (edited event)" };
    if (r.hmac !== computeHmac(keyHex, h)) return { ok: false, badSeq: r.seq, problem: "HMAC invalid" };
    prev = r.hash; seq++;
  }
  return { ok: true };
}

/** Append-only on-disk journal for one session: survives watchdog restarts and server outages. */
export class Journal {
  constructor(dir, sessionId, keyHex) {
    if (!/^(?:[0-9a-fA-F]{2}){16,64}$/.test(String(keyHex ?? ""))) throw new Error("a session key (hex, 16-64 bytes) from the server is required");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.base = path.join(dir, String(sessionId).replace(/[^A-Za-z0-9-]/g, "_"));
    this.logFile = this.base + ".jsonl";
    this.ackFile = this.base + ".ack";
    this.key = String(keyHex).toLowerCase();
    this.records = [];
    if (fs.existsSync(this.logFile)) {
      for (const line of fs.readFileSync(this.logFile, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try { this.records.push(JSON.parse(line)); } catch { /* torn last line after a crash: drop it */ }
      }
    }
    this.acked = -1;
    try { this.acked = parseInt(fs.readFileSync(this.ackFile, "utf8"), 10); if (Number.isNaN(this.acked)) this.acked = -1; } catch { /* none */ }
    const last = this.records.at(-1);
    this.prev = last ? last.hash : GENESIS;
    this.next = last ? last.seq + 1 : 0;
  }

  emit(type, severity, payload = {}, now = new Date()) {
    const ts = now.toISOString(); // yyyy-MM-ddTHH:mm:ss.sssZ
    const frozen = JSON.parse(canonical(payload));
    const hash = computeHash(this.prev, type, severity, ts, frozen);
    const rec = { seq: this.next, type, severity, ts, payloadJson: canonical(frozen), prevHash: this.prev, hash, hmac: computeHmac(this.key, hash) };
    fs.appendFileSync(this.logFile, JSON.stringify(rec) + "\n", { mode: 0o600 });
    this.records.push(rec); this.prev = hash; this.next++;
    return rec;
  }
  pending(max = 50) {
    const out = [];
    for (let i = this.acked + 1; i < this.records.length && out.length < max; i++) out.push(this.records[i]);
    return out;
  }
  ack(lastSeq) {
    if (lastSeq <= this.acked) return;
    this.acked = Math.min(lastSeq, this.records.length - 1);
    fs.writeFileSync(this.ackFile, String(this.acked));
  }
  get pendingCount() { return this.records.length - 1 - this.acked; }
}
