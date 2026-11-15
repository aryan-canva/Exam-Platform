// Linux process monitor: polls /proc. Detects (a) forbidden programs already running when the exam
// starts and (b) any new process whose name matches the deny list. Optionally kills them.
// Polling (default 250 ms) can miss a process that lives shorter than the interval; the deny list
// catches long-lived apps (browsers, chat, remote desktop, terminals), which is what matters.
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_DENY = [
  // browsers
  "firefox", "firefox-esr", "firefox-bin", "chrome", "google-chrome*", "chromium", "chromium-browser", "brave", "brave-browser",
  "opera", "vivaldi*", "msedge", "microsoft-edge*", "epiphany", "falkon", "midori", "librewolf", "tor-browser*",
  // editors / IDEs
  "code", "code-oss", "codium", "subl", "sublime_text", "atom", "gedit", "kate", "pycharm*", "idea*", "clion*", "eclipse", "netbeans*", "geany", "emacs*",
  // terminals
  "gnome-terminal*", "xterm", "konsole", "xfce4-terminal", "alacritty", "kitty", "tilix", "terminator", "lxterminal", "mate-terminal", "urxvt", "st", "ptyxis",
  // chat / meeting
  "discord", "slack", "teams*", "telegram-desktop", "signal-desktop", "whatsapp*", "zoom", "skype*", "element-desktop", "thunderbird",
  // remote control
  "anydesk", "teamviewer*", "rustdesk", "vncviewer", "x11vnc", "xvnc", "remmina", "nxplayer", "nxserver*", "xdotool",
  // screen capture
  "obs", "obs-studio", "flameshot", "gnome-screenshot", "spectacle", "shutter", "peek", "simplescreenrecorder", "kazam", "vokoscreen*",
  // local compilers / debuggers (code must be judged by the judge workers)
  "gcc", "g++", "cc1", "cc1plus", "clang", "clang++", "javac", "java", "gdb", "rustc",
];

const norm = (s) => String(s || "").toLowerCase();
export function matches(patterns, name) {
  const n = norm(name);
  if (!n) return false;
  return patterns.some((p) => { p = norm(p); return p.endsWith("*") ? n.startsWith(p.slice(0, -1)) : n === p; });
}

/** Parse one /proc/<pid> entry; null if it vanished or is a kernel thread. */
export function readProc(procDir, pid) {
  try {
    const stat = fs.readFileSync(path.join(procDir, String(pid), "stat"), "utf8");
    const close = stat.lastIndexOf(")");
    const comm = stat.slice(stat.indexOf("(") + 1, close);
    const f = stat.slice(close + 2).split(" "); // f[0]=state f[1]=ppid ... f[19]=starttime
    const ppid = parseInt(f[1], 10), start = f[19];
    if (pid === 2 || ppid === 2) return null; // kthreadd and kernel threads
    let exe = "", cmdline = [];
    try { exe = path.basename(fs.readlinkSync(path.join(procDir, String(pid), "exe"))); } catch { /* other user's process */ }
    try { cmdline = fs.readFileSync(path.join(procDir, String(pid), "cmdline"), "utf8").split("\0").filter(Boolean); } catch { /* gone */ }
    if (!exe && !cmdline.length && ppid === 0) return null;
    return { pid, ppid, start, comm, exe: exe.replace(/ \(deleted\)$/, ""), argv0: cmdline[0] ? path.basename(cmdline[0]) : "", cmdline };
  } catch { return null; }
}

export function scan(procDir = "/proc") {
  const out = new Map();
  let names = [];
  try { names = fs.readdirSync(procDir); } catch { return out; }
  for (const n of names) {
    if (!/^\d+$/.test(n)) continue;
    const p = readProc(procDir, +n);
    if (p) out.set(p.pid, p);
  }
  return out;
}

export class ProcessMonitor {
  /**
   * @param {object} o
   * @param {(type,severity,payload)=>void} o.onEvent
   * @param {number[]} o.protectedPids  never touched, nor their descendants (the app, the watchdog)
   * @param {string[]} [o.deny] @param {string[]} [o.allow] allow wins over deny
   * @param {boolean} [o.kill] @param {boolean} [o.strict] treat every new non-allowed process as forbidden
   */
  constructor({ onEvent, protectedPids, deny = DEFAULT_DENY, allow = [], kill = true, strict = false, procDir = "/proc", intervalMs = 250, killFn = process.kill.bind(process) }) {
    Object.assign(this, { onEvent, protectedPids: new Set(protectedPids), deny, allow, kill, strict, procDir, intervalMs, killFn });
    this.baseline = new Set(); // "pid:start"
    this.seen = new Set();
    this.timer = null;
  }
  key(p) { return `${p.pid}:${p.start}`; }
  names(p) { return [p.comm, p.exe, p.argv0]; }
  isDenied(p) { return !this.names(p).some((n) => matches(this.allow, n)) && this.names(p).some((n) => matches(this.deny, n)); }
  isAllowed(p) { return this.names(p).some((n) => matches(this.allow, n)); }

  isProtected(p, all) {
    for (let cur = p, hops = 0; cur && hops < 64; hops++) {
      if (this.protectedPids.has(cur.pid)) return true;
      cur = all.get(cur.ppid);
    }
    return false;
  }

  /** Snapshot what is running now and report forbidden programs that are already open. */
  start() {
    const all = scan(this.procDir);
    for (const p of all.values()) {
      this.baseline.add(this.key(p));
      if (!this.isProtected(p, all) && this.isDenied(p)) this.violation(p, "present_at_start");
    }
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    this.timer.unref?.();
    return all.size;
  }
  stop() { clearInterval(this.timer); this.timer = null; }

  poll() {
    const all = scan(this.procDir);
    for (const p of all.values()) {
      const k = this.key(p);
      if (this.seen.has(k)) continue;
      const isNew = !this.baseline.has(k);
      if (this.isProtected(p, all)) continue;
      if (this.isDenied(p)) { this.violation(p, isNew ? "started" : "present_at_start"); continue; }
      if (isNew && this.strict && !this.isAllowed(p)) this.violation(p, "unlisted");
    }
  }

  violation(p, when) {
    const k = this.key(p);
    if (this.seen.has(k)) return;
    this.seen.add(k);
    let killed = false, error = null;
    if (this.kill && p.pid > 1) {
      try { this.killFn(p.pid, "SIGKILL"); killed = true; } catch (e) { error = e.code || String(e.message); }
    }
    this.onEvent("PROCESS_BLOCKED", killed ? "HIGH" : "MEDIUM", {
      name: p.exe || p.comm, pid: p.pid, ppid: p.ppid, when, killed, ...(error ? { error } : {}),
      cmd: p.cmdline.join(" ").slice(0, 200),
    });
  }
}
