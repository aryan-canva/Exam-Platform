// JS mirror of the server's event rules (EventService.ingestEvents + EventChain.java + SessionKeyService), used by
// every mock server in the repo. Deliberately written the way the Java is (hash over the payloadJson TEXT, not over a
// re-serialised object) so the watchdog's canonical-JSON hash is checked against the server's formula.
import crypto from "node:crypto";

export const SECRET = "test-integrity-secret-0123456789abcdef";
export const GENESIS = "0".repeat(64);
const SEV = new Set(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const hex64 = (s) => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

export const sessionKey = (sessionId, secret = SECRET) => crypto.createHmac("sha256", Buffer.from(secret, "utf8")).update(String(sessionId), "utf8").digest("hex");
export const serverHash = (prev, type, severity, ts, payloadJson) => sha256(prev + `{"payload":${payloadJson},"severity":"${severity}","ts":"${ts}","type":"${type}"}`);
const hmacHex = (keyHex, hash) => crypto.createHmac("sha256", Buffer.from(keyHex, "hex")).update(hash, "utf8").digest("hex");

export const SUSPICIOUS = ["PASTE", "FOCUS_LOST", "TAB_SWITCH", "SCREENSHOT_ATTEMPT", "PROCESS_BLOCKED", "KIOSK_EXIT_ATTEMPT", "APP_EXITED"];

/** events = array stored for this session (mutated). Returns {code, body}. All-or-nothing, like the @Transactional method. */
export function ingest(events, sessionId, body, secret = SECRET) {
  const bad = (e, why) => ({ code: 400, body: { code: "INTEGRITY_VIOLATION", message: `Event seq ${e.seq} rejected: ${why}` } });
  if (!Array.isArray(body.events) || !body.events.length || body.events.length > 200) return { code: 400, body: { code: "BAD_REQUEST", message: "events: 1..200 required" } };
  const key = sessionKey(sessionId, secret), add = [];
  let prev = events.length ? events.at(-1).hash : GENESIS, next = events.length ? events.at(-1).seq + 1 : 0, accepted = 0, duplicates = 0;
  for (const e of body.events) {
    const sev = e.severity ?? "INFO";
    if (!/^[A-Z][A-Z0-9_]{1,49}$/.test(e.type ?? "")) return bad(e, "invalid type");
    if (!SEV.has(sev)) return bad(e, "invalid severity");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(e.ts ?? "")) return bad(e, "ts must be yyyy-MM-ddTHH:mm:ss.SSSZ");
    if (typeof e.payloadJson !== "string" || e.payloadJson.length > 8192) return bad(e, "payloadJson missing or too large");
    if (![e.prevHash, e.hash, e.hmac].every(hex64)) return bad(e, "prevHash, hash and hmac must be 64 lower-case hex characters");
    if (e.seq < next) {
      const stored = events[e.seq] ?? add[e.seq - events.length];
      if (!stored) return bad(e, "seq is behind the chain but not stored");
      if (stored.hash !== e.hash) return bad(e, "seq already stored with a different hash");
      duplicates++; continue;
    }
    if (e.seq !== next) return bad(e, `expected seq ${next}`);
    if (e.prevHash !== prev) return bad(e, "prevHash does not match the previous event");
    const h = serverHash(e.prevHash, e.type, sev, e.ts, e.payloadJson);
    if (h !== e.hash) return bad(e, "hash does not match the event content");
    const want = Buffer.from(hmacHex(key, h)), got = Buffer.from(e.hmac);
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return bad(e, "HMAC invalid");
    add.push({ ...e, severity: sev }); prev = h; next++; accepted++;
  }
  events.push(...add);
  return { code: 200, body: { accepted, duplicates, nextSeq: next } };
}
