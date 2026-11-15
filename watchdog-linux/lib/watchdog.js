// One watchdog = at most one active exam session: journal (signed chain) + uploader + process monitor.
import { Journal } from "./chain.js";
import { Uploader } from "./uploader.js";
import { ProcessMonitor, DEFAULT_DENY } from "./procmon.js";

// Events the student app may report (it cannot invent other types or severities).
const APP_EVENTS = {
  FOCUS_LOST: "MEDIUM", FOCUS_BACK: "INFO", PASTE: "MEDIUM", CLIPBOARD_BLOCKED: "LOW",
  KIOSK_EXIT_ATTEMPT: "HIGH", DEVTOOLS_ATTEMPT: "HIGH", SCREENSHOT_ATTEMPT: "HIGH", APP_ERROR: "LOW",
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

export class Watchdog {
  constructor({ stateDir, kill = true, deny = DEFAULT_DENY, allow = [], strict = false, procDir = "/proc", pollMs = 250,
    fetchFn = globalThis.fetch, heartbeatMs = 60000, uploadMs = 1500, log = () => {}, onExit = () => {} }) {
    Object.assign(this, { stateDir, kill, deny, allow, strict, procDir, pollMs, fetchFn, heartbeatMs, uploadMs, log, onExit });
    this.s = null; // active session
    this.rate = new Map();
  }

  startSession({ sessionId, serverUrl, token, appPid, sessionKey, policy = {} }) {
    if (!sessionId || !serverUrl || !token || !appPid) throw new Error("sessionId, serverUrl, token and appPid are required");
    if (!sessionKey) throw new Error("sessionKey is required (returned by POST /sessions/start)");
    if (this.s && this.s.sessionId === sessionId) { this.s.token = token; this.s.uploader.resetAuth(); return this.status(); }
    if (this.s) this.#teardown("replaced");
    const journal = new Journal(this.stateDir, sessionId, sessionKey);
    const resumed = journal.records.length > 0;
    const s = this.s = { sessionId, appPid, token, journal, ended: false, startedAt: Date.now(), blocked: 0, timers: [] };
    s.uploader = new Uploader({
      journal, sessionId, serverUrl, getToken: () => s.token, fetchFn: this.fetchFn, intervalMs: this.uploadMs, log: this.log,
      onAuthExpired: () => this.log("token expired: waiting for the app to send a new one"),
    });
    const emit = (t, sev, p) => this.#emit(t, sev, p);
    const kill = policy.mode ? String(policy.mode).toUpperCase() === "KILL" : this.kill;
    s.monitor = new ProcessMonitor({
      onEvent: (t, sev, p) => { if (t === "PROCESS_BLOCKED") s.blocked++; emit(t, sev, p); },
      protectedPids: [process.pid, process.ppid, appPid].filter(Boolean),
      deny: [...(policy.deny ?? this.deny), ...(policy.extraDeny ?? [])], allow: policy.allow ?? this.allow,
      kill, strict: policy.strict ?? this.strict, procDir: this.procDir, intervalMs: this.pollMs,
    });
    emit(resumed ? "WATCHDOG_RESUMED" : "WATCHDOG_STARTED", "INFO", { pid: process.pid, appPid, mode: kill ? "KILL" : "LOG", platform: process.platform });
    const n = s.monitor.start();
    s.uploader.start();
    s.timers.push(setInterval(() => emit("WD_HEARTBEAT", "INFO", { blocked: s.blocked, pending: s.journal.pendingCount }), this.heartbeatMs));
    s.timers.push(setInterval(() => { if (!alive(s.appPid)) this.#appGone(); }, 1000));
    s.timers.forEach((t) => t.unref?.());
    this.log(`session ${sessionId} started, ${n} processes in baseline`);
    return this.status();
  }

  #emit(type, severity, payload = {}) {
    const s = this.s; if (!s || s.ended) return null;
    const rec = s.journal.emit(type, severity, payload);
    s.uploader.kick();
    return rec;
  }

  /** Event reported by the student app. Unknown types are refused; floods are counted, not stored. */
  appEvent(type, payload = {}) {
    if (!this.s) throw new Error("no active session");
    const sev = APP_EVENTS[type];
    if (!sev) throw new Error(`event type not allowed: ${type}`);
    const now = Date.now(), r = this.rate.get(type) ?? { t: now, n: 0 };
    if (now - r.t > 60000) { r.t = now; r.n = 0; }
    this.rate.set(type, r);
    if (++r.n > 300) return { dropped: true };
    const clean = JSON.parse(JSON.stringify(payload ?? {}));
    if (JSON.stringify(clean).length > 2048) throw new Error("payload too large");
    return this.#emit(type, sev, clean);
  }

  setToken(token) { if (!this.s) throw new Error("no active session"); this.s.token = token; this.s.uploader.resetAuth(); this.s.uploader.kick(); }
  flush(ms = 5000) { return this.s ? this.s.uploader.flush(ms) : Promise.resolve(true); }

  async endSession(reason = "exam_ended") {
    if (!this.s) return { ok: true };
    this.#emit("WATCHDOG_STOPPED", "INFO", { reason, blocked: this.s.blocked });
    const flushed = await this.s.uploader.flush(8000);
    const st = this.status(); this.#teardown(reason);
    return { ...st, flushed };
  }

  async #appGone() {
    const s = this.s; if (!s || s.ended) return;
    this.#emit("APP_EXITED", "HIGH", { appPid: s.appPid });
    s.timers.forEach(clearInterval); s.monitor.stop();
    await s.uploader.flush(30000);
    this.#teardown("app_exited"); this.onExit("app_exited");
  }

  #teardown() {
    const s = this.s; if (!s) return;
    s.ended = true; s.monitor.stop(); s.uploader.stop(); s.timers.forEach(clearInterval); this.s = null;
  }

  status() {
    const s = this.s;
    if (!s) return { active: false };
    return { active: true, sessionId: s.sessionId, pid: process.pid, events: s.journal.next, pending: s.journal.pendingCount,
      blocked: s.blocked, uptimeSec: Math.round((Date.now() - s.startedAt) / 1000), upload: { ...s.uploader.state } };
  }
}
