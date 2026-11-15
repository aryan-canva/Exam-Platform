#!/usr/bin/env node
// exam-watchdog [--port N] [--state-dir D] [--key-file F | env WD_KEY] [--mode kill|log] [--parent-pid P]
// Prints one line `READY {"port":N,"pid":P}` on stdout when the control API is up.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Watchdog } from "../lib/watchdog.js";
import { startControl } from "../lib/control.js";

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : d; };
const key = process.env.WD_KEY || (arg("key-file") && fs.readFileSync(arg("key-file"), "utf8").trim());
if (!key || key.length < 16) { console.error("exam-watchdog: need a key (env WD_KEY or --key-file, 16+ chars)"); process.exit(2); }

function defaultStateDir() {
  if (process.env.WD_STATE_DIR) return process.env.WD_STATE_DIR;
  const sys = "/var/lib/exam-watchdog";
  try { fs.mkdirSync(sys, { recursive: true, mode: 0o700 }); fs.accessSync(sys, fs.constants.W_OK); return sys; } catch { /* not root */ }
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "exam-watchdog");
}

const verbose = process.env.WD_VERBOSE === "1";
const log = (m) => { if (verbose) console.error(`[watchdog ${new Date().toISOString()}] ${m}`); };
const wd = new Watchdog({
  stateDir: arg("state-dir", defaultStateDir()), kill: arg("mode", "kill").toLowerCase() !== "log", log,
  onExit: () => setTimeout(() => process.exit(0), 200),
});
const { port } = await startControl({ watchdog: wd, key, host: arg("host", "127.0.0.1"), port: +arg("port", 0) });
console.log(`READY ${JSON.stringify({ port, pid: process.pid })}`);

const parent = +arg("parent-pid", 0);
if (parent) setInterval(async () => {
  try { process.kill(parent, 0); } catch { if (!wd.s) process.exit(0); /* active session: appGone() handles flush */ }
}, 2000).unref();
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, async () => { await wd.endSession("signal"); process.exit(0); });
