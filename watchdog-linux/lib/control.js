// Loopback-only control API used by the student app's main process. Every call needs the shared key.
import http from "node:http";
import crypto from "node:crypto";

export function startControl({ watchdog, key, host = "127.0.0.1", port = 0 }) {
  const want = Buffer.from(key);
  const server = http.createServer((req, res) => {
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    const got = Buffer.from(String(req.headers["x-wd-key"] || ""));
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return send(401, { error: "bad key" });
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 65536) req.destroy(); });
    req.on("end", async () => {
      let b = {};
      try { b = raw ? JSON.parse(raw) : {}; } catch { return send(400, { error: "bad json" }); }
      try {
        switch (`${req.method} ${req.url}`) {
          case "GET /health": return send(200, { ok: true, pid: process.pid });
          case "GET /status": return send(200, watchdog.status());
          case "POST /session/start": return send(200, watchdog.startSession(b));
          case "POST /event": { const r = watchdog.appEvent(b.type, b.payload); return send(200, { ok: true, dropped: !!r?.dropped }); }
          case "POST /token": watchdog.setToken(b.token); return send(200, { ok: true });
          case "POST /flush": return send(200, { flushed: await watchdog.flush(b.timeoutMs || 5000) });
          case "POST /session/end": return send(200, await watchdog.endSession(b.reason));
          default: return send(404, { error: "not found" });
        }
      } catch (e) { send(400, { error: e.message }); }
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve({ server, port: server.address().port }));
  });
}
