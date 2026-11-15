// Pure helpers for the Integrity view (no React, no browser APIs, so node:test can run them).

/** Must match EventService.SUSPICIOUS_TYPES on the server (test/integrity.test.mjs checks this). */
export const SUSPICIOUS_TYPES = ["PASTE", "FOCUS_LOST", "TAB_SWITCH", "SCREENSHOT_ATTEMPT", "PROCESS_BLOCKED", "KIOSK_EXIT_ATTEMPT", "APP_EXITED"];
export const HEARTBEAT_TYPE = "WD_HEARTBEAT";
export const GAP_LIMIT_MS = 2 * 60 * 1000;          // warn when heartbeats stop for MORE than 2 minutes

const ms = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? null : t; };
export const isSuspicious = (type) => SUSPICIOUS_TYPES.includes(type);

/** Seconds -> "2m 05s" / "45s" / "1h 03m". */
export function fmtGap(sec) {
  sec = Math.round(sec);
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s).padStart(2, "0")}s`;
}

/**
 * Heartbeat gaps of one session.
 *  events:  rows of GET /events?sessionId= (any order)
 *  session: {status, startedAt, endedAt} (a /contests/{id}/sessions row); optional
 *  nowMs:   "now" on the server's clock (caller corrects for clock offset)
 * Returns [{from, to, sec, open}] oldest first. `open` = the gap is still running (ACTIVE session, no heartbeat since `from`).
 * Between heartbeats the gap is closed. Before the first one it is measured from startedAt; after the last one to endedAt
 * (ENDED) or to nowMs (ACTIVE). A session with no heartbeat at all counts from startedAt.
 */
export function heartbeatGaps(events, session = {}, nowMs = Date.now()) {
  const beats = (events || []).filter((e) => e.type === HEARTBEAT_TYPE).map((e) => ms(e.ts)).filter((t) => t !== null).sort((a, b) => a - b);
  const start = session.startedAt ? ms(session.startedAt) : null;
  const end = session.endedAt ? ms(session.endedAt) : null;
  const active = session.status === "ACTIVE";
  const points = [];
  if (start !== null) points.push(start);
  points.push(...beats);
  if (end !== null && !active) points.push(end);
  const gaps = [];
  for (let i = 1; i < points.length; i++) {
    const d = points[i] - points[i - 1];
    if (d > GAP_LIMIT_MS) gaps.push({ from: points[i - 1], to: points[i], sec: d / 1000, open: false });
  }
  if (active && points.length) {
    const last = points[points.length - 1], d = nowMs - last;
    if (d > GAP_LIMIT_MS) gaps.push({ from: last, to: nowMs, sec: d / 1000, open: true });
  }
  return gaps;
}

/** Summary used by the detail page header. */
export function summarize(events, session = {}, nowMs = Date.now()) {
  const byType = {};
  for (const e of events || []) byType[e.type] = (byType[e.type] || 0) + 1;
  const suspicious = SUSPICIOUS_TYPES.reduce((n, t) => n + (byType[t] || 0), 0);
  const gaps = heartbeatGaps(events, session, nowMs);
  return { total: (events || []).length, suspicious, byType, gaps, openGap: gaps.find((g) => g.open) || null };
}

/**
 * Warning for one row of the contest list (only lastWdHeartbeatAt is known there, not every beat).
 * Returns null or {open:true, sec, text}. Only ACTIVE sessions can have a live gap.
 */
export function listWarning(row, nowMs = Date.now()) {
  if (!row || row.status !== "ACTIVE") return null;
  const last = row.lastWdHeartbeatAt ? ms(row.lastWdHeartbeatAt) : (row.startedAt ? ms(row.startedAt) : null);
  if (last === null) return null;
  const d = nowMs - last;
  if (d <= GAP_LIMIT_MS) return null;
  return { open: true, sec: d / 1000, text: row.lastWdHeartbeatAt ? `No watchdog heartbeat for ${fmtGap(d / 1000)}` : `No watchdog heartbeat since the session started (${fmtGap(d / 1000)})` };
}

/** Timeline rows: events (optionally without heartbeats) with gap markers merged in by time, newest first. */
export function buildTimeline(events, gaps, { hideHeartbeats = true, onlySuspicious = false } = {}) {
  const rows = [];
  for (const e of events || []) {
    if (onlySuspicious ? !isSuspicious(e.type) : (hideHeartbeats && e.type === HEARTBEAT_TYPE)) continue;
    rows.push({ kind: "event", at: ms(e.ts) ?? 0, seq: e.seq, e });
  }
  if (!onlySuspicious) for (const g of gaps || []) rows.push({ kind: "gap", at: g.from, g });
  return rows.sort((a, b) => b.at - a.at || (b.seq ?? 0) - (a.seq ?? 0));
}

/** payloadJson (text or object) -> short one-line text, never throws. */
export function payloadText(p, max = 120) {
  if (p == null || p === "") return "";
  let o = p;
  if (typeof p === "string") { try { o = JSON.parse(p); } catch { return p.length > max ? p.slice(0, max - 1) + "…" : p; } }
  if (o && typeof o === "object") {
    const s = Object.entries(o).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ");
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }
  return String(o);
}
