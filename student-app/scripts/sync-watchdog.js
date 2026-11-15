// Copies ../watchdog-linux (bin, lib, package.json; no tests) into ./watchdog so electron-builder can ship it
// as an extra resource. Run automatically by `npm run dist:linux`.
const fs = require("node:fs");
const path = require("node:path");
const src = path.join(__dirname, "..", "..", "watchdog-linux"), dst = path.join(__dirname, "..", "watchdog");
if (!fs.existsSync(path.join(src, "bin", "exam-watchdog.mjs"))) { console.error("watchdog-linux/ not found next to student-app/"); process.exit(1); }
fs.rmSync(dst, { recursive: true, force: true });
for (const d of ["bin", "lib"]) fs.cpSync(path.join(src, d), path.join(dst, d), { recursive: true });
fs.copyFileSync(path.join(src, "package.json"), path.join(dst, "package.json"));
console.log("watchdog synced to", dst);
