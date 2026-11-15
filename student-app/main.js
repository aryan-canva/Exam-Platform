// Electron main process: window/kiosk, native HTTP (no CORS), config storage.
// Includes in-app integrity reporting for Windows (signed event chain to server + best-effort suspicious app blocking).
const { app, BrowserWindow, ipcMain, globalShortcut, Menu, clipboard, session } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { WatchdogClient, resolveScript } = require("./watchdog-client");

// Ubuntu 24.04 blocks the SUID sandbox helper inside an AppImage; the renderer is still process-sandboxed by Chromium's namespace sandbox where available.
if (process.platform === "linux" && process.env.APPIMAGE) app.commandLine.appendSwitch("no-sandbox");

const WINDOWED = process.argv.includes("--windowed") || process.env.EXAM_DEV === "1";
const cfgFile = () => path.join(app.getPath("userData"), "config.json");
let win = null;
let examMode = false;

// ── Linux integrity watchdog (process monitor + signed events).
let wd = null;
function watchdog() {
  if (process.platform !== "linux" || process.argv.includes("--no-watchdog")) return null;
  if (wd) return wd;
  const script = resolveScript(process.resourcesPath);
  if (!script) return null;
  const cfg = readCfg();
  // windowed/dev runs only log: never kill the developer's browser
  wd = new WatchdogClient({ script, stateDir: path.join(app.getPath("userData"), "watchdog"), mode: WINDOWED ? "log" : (cfg.watchdogMode || "kill"), log: (m) => console.error("[watchdog]", m) });
  return wd;
}
// Event-signing keys from POST /sessions/start. The main process strips them from the response, so renderer code
// (and anything injected into it) never holds a key it could use to forge events.
const sessionKeys = new Map();
const sessionTokens = new Map(); // sessionId -> latest access token (for event ingest)
let reporter = null; // in-process reporter (Windows/fallback)

// ── Event chain helpers (must match server EventChain / watchdog-linux lib/chain.js)
const GENESIS = "0".repeat(64);
function canonical(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
}
function sha256(s) { return crypto.createHash("sha256").update(s, "utf8").digest("hex"); }
function computeHash(prev, type, severity, ts, payload) { return sha256(prev + canonical({ type, severity, ts, payload })); }
function computeHmac(keyHex, hash) { return crypto.createHmac("sha256", Buffer.from(keyHex, "hex")).update(hash, "utf8").digest("hex"); }

class IntegrityReporter {
  constructor() { this.active = null; this.queue = []; this.timer = null; this.procTimer = null; this.flushing = false; this.seenProcs = new Map(); }
  get session() { return this.active ? { token: this.active.token } : null; }
  async start({ sessionId, serverUrl, token, sessionKey }) {
    if (!sessionKey) throw new Error("missing session key");
    const stateDir = path.join(app.getPath("userData"), "watchdog");
    fs.mkdirSync(stateDir, { recursive: true });
    const base = path.join(stateDir, String(sessionId).replace(/[^A-Za-z0-9-]/g, "_"));
    let records = [];
    try {
      if (fs.existsSync(base + ".jsonl")) {
        for (const line of fs.readFileSync(base + ".jsonl", "utf8").split("\n")) {
          if (!line.trim()) continue;
          try { records.push(JSON.parse(line)); } catch { /* drop torn line */ }
        }
      }
    } catch { records = []; }
    const last = records.at(-1);
    this.active = { sessionId, serverUrl: (serverUrl || "").replace(/\/+$/, ""), token, key: String(sessionKey).toLowerCase(), base, seq: last ? last.seq + 1 : 0, prev: last ? last.hash : GENESIS };
    this.timer = setInterval(() => this.flush().catch(() => {}), 2500);
    this.startProcessMonitor();
    this.emit("SESSION_ATTACHED", "INFO", { platform: process.platform, windowed: WINDOWED });
    await this.flush();
    return { active: true };
  }
  emit(type, severity = "INFO", payload = {}) {
    if (!this.active) return Promise.resolve();
    try {
      const frozen = JSON.parse(canonical(payload && typeof payload === "object" ? payload : {}));
      const ts = new Date().toISOString();
      const hash = computeHash(this.active.prev, type, severity, ts, frozen);
      const rec = { seq: this.active.seq, type, severity, ts, payloadJson: canonical(frozen), prevHash: this.active.prev, hash, hmac: computeHmac(this.active.key, hash) };
      fs.appendFileSync(this.active.base + ".jsonl", JSON.stringify(rec) + "\n", { mode: 0o600 });
      this.queue.push(rec);
      this.active.prev = hash; this.active.seq++;
    } catch { /* ignore malformed payload */ }
    return Promise.resolve();
  }
  event(type, payload) { return this.emit(String(type), "MEDIUM", payload && typeof payload === "object" ? payload : {}); }
  async setToken(t) { if (this.active && typeof t === "string") this.active.token = t; return true; }
  async flush(timeoutMs = 5000) {
    if (!this.active || this.flushing || this.queue.length === 0) return this.queue.length === 0;
    this.flushing = true;
    try {
      const batch = this.queue.slice(0, 50);
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeoutMs);
      let res;
      try {
        res = await fetch(this.active.serverUrl + "/events/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + this.active.token },
          body: JSON.stringify({ sessionId: this.active.sessionId, events: batch }),
          signal: ctl.signal,
        });
      } finally { clearTimeout(t); }
      if (res.ok) { this.queue.splice(0, batch.length); return this.queue.length === 0; }
      // keep queued for retry on transient/auth/network issues
      return false;
    } catch { return false; }
    finally { this.flushing = false; }
  }
  async end(reason = "exam_ended") {
    try { await this.emit("SESSION_END", "INFO", { reason: String(reason || "exam_ended") }); await this.flush(6000); } catch { /* best effort */ }
    this.stop();
    return { ok: true };
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.procTimer) clearInterval(this.procTimer);
    this.timer = null; this.procTimer = null; this.active = null; this.queue = []; this.seenProcs.clear();
  }
  async healthy() { return !!this.active; }
  startProcessMonitor() {
    if (process.platform !== "win32" || WINDOWED) return;
    const blocked = ["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "iexplore.exe",
      "whatsapp.exe", "telegram.exe", "discord.exe", "slack.exe", "teams.exe", "zoom.exe", "skype.exe",
      "steam.exe", "epicgameslauncher.exe", "obs64.exe", "obs32.exe", "anydesk.exe", "teamviewer.exe"];
    const scan = () => {
      if (!this.active || !examMode) return;
      execFile("tasklist", ["/FO", "CSV", "/NH"], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
        if (err || !stdout || !this.active || !examMode) return;
        const names = new Set();
        for (const line of stdout.split(/\r?\n/)) {
          const m = line.match(/^"([^"]+)"/);
          if (m) names.add(m[1].toLowerCase());
        }
        for (const name of blocked) {
          if (!names.has(name)) continue;
          const now = Date.now();
          const last = this.seenProcs.get(name) || 0;
          if (now - last < 15000) continue; // avoid spamming
          this.seenProcs.set(name, now);
          this.emit("PROCESS_BLOCKED", "HIGH", { name, action: "kill_attempt" });
          execFile("taskkill", ["/IM", name, "/F", "/T"], { windowsHide: true, timeout: 5000 }, () => {});
        }
      });
    };
    scan();
    this.procTimer = setInterval(scan, 4000);
  }
}

const wdEvent = (type, payload) => {
  if (reporter && reporter.active) reporter.emit(String(type), type === "FOCUS_LOST" ? "MEDIUM" : "HIGH", payload && typeof payload === "object" ? payload : {});
  else if (wd && wd.session) wd.event(type, payload);
};

function readCfg() {
  let d = {};
  try { d = JSON.parse(fs.readFileSync(path.join(__dirname, "defaults.json"), "utf8")); } catch { /* none */ }
  try { d = { ...d, ...JSON.parse(fs.readFileSync(cfgFile(), "utf8")) }; } catch { /* first run */ }
  const arg = process.argv.find((a) => a.startsWith("--server="));
  if (arg) d.serverUrl = arg.slice(9);
  return d;
}
function writeCfg(patch) {
  const next = { ...readCfg(), ...patch };
  delete next.__proto__;
  fs.mkdirSync(path.dirname(cfgFile()), { recursive: true });
  fs.writeFileSync(cfgFile(), JSON.stringify(next, null, 2));
  return next;
}
function deviceId() {
  const c = readCfg();
  if (c.deviceId) return c.deviceId;
  const id = crypto.createHash("sha256").update(os.hostname() + os.userInfo().username + crypto.randomUUID()).digest("hex").slice(0, 32);
  writeCfg({ deviceId: id });
  return id;
}

// Keys that could leave the exam, reload the page or open tools.
function blocked(input) {
  if (input.type !== "keyDown") return false;
  const k = (input.key || "").toLowerCase();
  const ctrl = input.control || input.meta, alt = input.alt, shift = input.shift;
  if (["f5", "f11", "f12", "f4"].includes(k) && !alt) return true;
  if (alt && ["f4", "tab", "arrowleft", "arrowright", "home"].includes(k)) return true;
  if (ctrl && ["r", "w", "q", "p", "n", "t", "o", "s", "u", "l", "j", "h", "f5"].includes(k) && !shift) return true;
  if (ctrl && shift && ["i", "j", "c", "r", "n", "t", "w"].includes(k)) return true;
  if (k === "escape" && examMode) return false; // Monaco needs Escape
  return false;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 980, minHeight: 640,
    backgroundColor: "#10161d", title: "Exam Client", show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      devTools: WINDOWED, spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.once("ready-to-show", () => { win.show(); if (!WINDOWED) win.maximize(); });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  win.webContents.on("before-input-event", (e, input) => { if (!WINDOWED && blocked(input)) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.on("context-menu", (e) => e.preventDefault());
  win.on("blur", () => {
    if (examMode) {
      win.webContents.send("focus-lost");
      wdEvent("FOCUS_LOST", { windowed: WINDOWED });
      if (!WINDOWED) setTimeout(() => { try { if (examMode && win && !win.isDestroyed()) { win.show(); win.focus(); win.setAlwaysOnTop(true, "screen-saver"); } } catch {} }, 150);
    }
  });
  win.on("focus", () => { if (examMode) { win.webContents.send("focus-back"); wdEvent("FOCUS_BACK", {}); } });
  win.on("close", (e) => { if (examMode && !app.quitting) { e.preventDefault(); wdEvent("KIOSK_EXIT_ATTEMPT", { via: "close" }); } });
  win.on("leave-full-screen", () => { if (examMode && !WINDOWED) { wdEvent("KIOSK_EXIT_ATTEMPT", { via: "leave-fullscreen" }); win.setFullScreen(true); } });
  win.on("minimize", () => { if (examMode && !WINDOWED) { wdEvent("KIOSK_EXIT_ATTEMPT", { via: "minimize" }); win.restore(); win.focus(); } });
}

function setExamMode(on) {
  examMode = !!on;
  if (!win) return;
  if (WINDOWED) return;
  win.setKiosk(examMode);
  win.setAlwaysOnTop(examMode, "screen-saver");
  win.setMinimizable(!examMode);
  if (examMode) { win.focus(); } else { win.setFullScreen(false); win.maximize(); }
}

ipcMain.handle("cfg:get", () => ({ ...readCfg(), windowed: WINDOWED, version: app.getVersion() }));
ipcMain.handle("cfg:set", (_e, patch) => writeCfg({ serverUrl: String(patch.serverUrl || "") }));
ipcMain.handle("device", () => deviceId());
ipcMain.handle("exam:mode", (_e, on) => setExamMode(on));
ipcMain.handle("quit", () => { app.quitting = true; app.quit(); });

ipcMain.handle("wd:start", async (_e, a) => {
  const sessionKey = sessionKeys.get(a.sessionId);
  if (!sessionKey) return { ok: false, supported: true, error: "the server did not send a session key (is the server up to date?)" };
  sessionTokens.set(a.sessionId, a.token);

  // Prefer Linux watchdog when available (full process monitor there); otherwise use in-process reporter (Windows demo).
  const c = watchdog();
  if (c) {
    try { const st = await c.start({ sessionId: a.sessionId, serverUrl: a.serverUrl, token: a.token, sessionKey }); return { ok: st.active === true, supported: true, mode: "linux-watchdog" }; }
    catch (e) { /* fall through to reporter */ }
  }
  try {
    reporter = new IntegrityReporter();
    await reporter.start({ sessionId: a.sessionId, serverUrl: a.serverUrl, token: a.token, sessionKey });
    return { ok: true, supported: true, mode: "in-app" };
  } catch (e) {
    reporter = null;
    return { ok: false, supported: true, error: e.message };
  }
});
ipcMain.handle("wd:event", (_e, { type, payload }) => {
  const p = payload && typeof payload === "object" ? payload : {};
  if (reporter && reporter.active) return reporter.event(String(type), p).then(() => true);
  if (wd?.session) return wd.event(String(type), p).then(() => true);
  return false;
});
ipcMain.handle("wd:token", (_e, t) => {
  if (typeof t !== "string") return false;
  if (reporter && reporter.active) return reporter.setToken(t);
  if (wd?.session) return wd.setToken(t).then(() => true).catch(() => false);
  return false;
});
ipcMain.handle("wd:flush", () => {
  if (reporter && reporter.active) return reporter.flush(5000);
  if (wd?.session) return wd.flush(5000);
  return true;
});
ipcMain.handle("wd:end", (_e, reason) => {
  const r = String(reason || "exam_ended");
  if (reporter) return reporter.end(r);
  if (wd) return wd.end(r);
  return { ok: true };
});
ipcMain.handle("wd:health", async () => {
  if (reporter && reporter.active) return { ok: await reporter.healthy(), mode: "in-app" };
  if (wd?.session) return { ok: await wd.healthy(), mode: "linux-watchdog" };
  return { ok: false };
});
ipcMain.handle("clipboard:clear", () => clipboard.clear());

// All server calls go through here: no CORS, and the renderer never sees raw network access.
ipcMain.handle("http", async (_e, { method, url, headers, body, timeoutMs }) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs || 15000);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctl.signal });
    let text = await res.text();
    // Strip sessionKey from response to renderer but keep it for integrity reporting.
    if (method === "POST" && /\/sessions\/start$/.test(new URL(url).pathname) && res.ok) {
      try { const j = JSON.parse(text); if (j.sessionKey && j.id) { sessionKeys.set(j.id, j.sessionKey); sessionTokens.set(j.id, (headers && headers.Authorization ? String(headers.Authorization).replace(/^Bearer\s+/i, "") : null)); delete j.sessionKey; text = JSON.stringify(j); } } catch { /* not JSON: pass through */ }
    }
    return { status: res.status, text };
  } catch (err) {
    return { status: 0, error: err.name === "AbortError" ? "timeout" : String(err.cause?.code || err.message) };
  } finally { clearTimeout(t); }
});

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
    createWindow();
    if (!WINDOWED) ["Alt+Tab", "Alt+Esc", "CommandOrControl+Shift+Esc"].forEach((a) => { try { globalShortcut.register(a, () => {}); } catch { /* OS-reserved */ } });
  });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => { globalShortcut.unregisterAll(); try { wd?.stop?.(); } catch {} try { reporter?.stop?.(); } catch {} });
}
