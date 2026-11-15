// Main-process side of the Linux watchdog: spawns it, talks to its loopback API, respawns it if it dies.
// No Electron imports: runs (and is tested) under plain Node. Under Electron the child is started with
// ELECTRON_RUN_AS_NODE=1 so the packaged app needs no separate Node install.
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const path = require("node:path");

class WatchdogClient {
  constructor({ script, nodeBin = process.execPath, stateDir, mode = "kill", log = () => {}, onDown = () => {}, extraEnv = {} }) {
    Object.assign(this, { script, nodeBin, stateDir, mode, log, onDown, extraEnv });
    this.child = null; this.port = 0; this.key = null; this.session = null; this.restarts = 0; this.stopping = false; this.starting = null;
  }

  /** Start the child if it is not running. Resolves when its control API answers /health. */
  ensureRunning() {
    if (this.child && this.port) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      this.key = crypto.randomBytes(24).toString("hex");
      const args = [this.script, "--parent-pid", String(process.pid), "--mode", this.mode];
      if (this.stateDir) args.push("--state-dir", this.stateDir);
      const child = spawn(this.nodeBin, args, {
        env: { ...process.env, ...this.extraEnv, ELECTRON_RUN_AS_NODE: "1", WD_KEY: this.key },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let buf = "", ready = false;
      const timer = setTimeout(() => { if (!ready) { child.kill("SIGKILL"); reject(new Error("watchdog did not start in time")); } }, 8000);
      child.stdout.on("data", (d) => {
        buf += d;
        const m = buf.match(/READY (\{.*\})/);
        if (m && !ready) { ready = true; clearTimeout(timer); this.child = child; this.port = JSON.parse(m[1]).port; resolve(); }
      });
      child.stderr.on("data", (d) => this.log(String(d).trim()));
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("exit", (code, sig) => {
        clearTimeout(timer);
        const wasReady = ready;
        if (this.child === child) { this.child = null; this.port = 0; }
        if (!wasReady) reject(new Error(`watchdog exited early (${code ?? sig})`));
        else if (!this.stopping) { this.log(`watchdog exited (${code ?? sig})`); this.onDown(code ?? sig); }
      });
    }).finally(() => { this.starting = null; });
    return this.starting;
  }

  async call(method, urlPath, body, timeoutMs = 6000) {
    await this.ensureRunning();
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`http://127.0.0.1:${this.port}${urlPath}`, {
        method, signal: ctl.signal, headers: { "x-wd-key": this.key, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `watchdog HTTP ${res.status}`);
      return data;
    } finally { clearTimeout(t); }
  }

  /** Begin watching an exam session. Remembered so a respawned watchdog can resume it. */
  async start({ sessionId, serverUrl, token, sessionKey, policy }) {
    this.session = { sessionId, serverUrl, token, sessionKey, policy };
    return this.call("POST", "/session/start", { sessionId, serverUrl, token, sessionKey, appPid: process.pid, policy });
  }
  /** Fire-and-forget app event (focus lost, paste...). Never throws. */
  event(type, payload) { return this.call("POST", "/event", { type, payload }, 3000).catch((e) => this.log(`event ${type} failed: ${e.message}`)); }
  async setToken(token) { if (this.session) this.session.token = token; return this.call("POST", "/token", { token }); }
  flush(timeoutMs = 5000) { return this.call("POST", "/flush", { timeoutMs }, timeoutMs + 2000).then((r) => r.flushed).catch(() => false); }
  status() { return this.call("GET", "/status").catch(() => null); }

  /** True when the child is up and still watching our session; resumes the session if the child was respawned. */
  async healthy() {
    try {
      const st = await this.call("GET", "/status", undefined, 2000);
      if (this.session && !st.active) { await this.start(this.session); this.restarts++; }
      return true;
    } catch { return false; }
  }

  async end(reason = "exam_ended") {
    const s = this.session; this.session = null;
    if (!s || !this.child) return { ok: true };
    return this.call("POST", "/session/end", { reason }, 15000).catch((e) => ({ ok: false, error: e.message }));
  }

  stop() { this.stopping = true; this.session = null; if (this.child) { this.child.kill("SIGTERM"); this.child = null; this.port = 0; } }
}

/** Where the watchdog script lives: next to the app resources when packaged, in the repo when developing. */
function resolveScript(resourcesPath) {
  const fs = require("node:fs");
  const cands = [
    resourcesPath && path.join(resourcesPath, "watchdog", "bin", "exam-watchdog.mjs"),
    path.join(__dirname, "watchdog", "bin", "exam-watchdog.mjs"),
    path.join(__dirname, "..", "watchdog-linux", "bin", "exam-watchdog.mjs"),
  ].filter(Boolean);
  return cands.find((p) => fs.existsSync(p)) || null;
}

module.exports = { WatchdogClient, resolveScript };
