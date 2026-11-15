#!/usr/bin/env node
// Run this ON A MACHINE ON THE OTHER NETWORK (a student PC, a phone hotspot laptop, a cloud VM):
//   node tools/check-reachability.mjs http://<SERVER>:8080 [--origin http://teacher-pc:5173]
// Exit code 0 = every required check passed. No dependencies.
import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) || "").replace(/\/+$/, "");
const oi = args.indexOf("--origin"), origin = oi >= 0 ? args[oi + 1] : "http://teacher-ui.example";
if (!base) { console.error("usage: check-reachability.mjs <http(s)://host[:port]> [--origin <teacher-ui-origin>]"); process.exit(2); }
const u = new URL(base), port = +u.port || (u.protocol === "https:" ? 443 : 80);
let failed = 0, warned = 0;
const ok = (m) => console.log("  ok    " + m);
const bad = (m, hint) => { failed++; console.log("  FAIL  " + m + (hint ? "\n        -> " + hint : "")); };
const warn = (m) => { warned++; console.log("  warn  " + m); };

const isPrivate = (ip) => /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|f[cd])/i.test(ip);

console.log(`Checking ${base}`);
// 1. DNS
let ip = u.hostname;
if (!net.isIP(u.hostname)) {
  try { const r = await dns.lookup(u.hostname); ip = r.address; ok(`DNS ${u.hostname} -> ${ip}`); }
  catch (e) { bad(`DNS lookup failed (${e.code})`, "check the hostname / this machine's DNS"); }
}
if (net.isIP(ip) && isPrivate(ip)) warn(`${ip} is a private/loopback/CGNAT address: only machines on the same network (or VPN) can reach it. For other networks use a public IP with port-forward, or a tunnel (docs/NETWORKING.md).`);

// 2. TCP
const t0 = Date.now();
const tcp = await new Promise((res) => {
  const s = net.connect({ host: u.hostname, port, timeout: 6000 }, () => { s.destroy(); res(null); });
  s.on("timeout", () => { s.destroy(); res("timeout (packets dropped: firewall, wrong IP, or no port-forward)"); });
  s.on("error", (e) => res(e.code === "ECONNREFUSED" ? "connection refused (host reachable, nothing listening on this port)" : e.code));
});
if (tcp) bad(`TCP ${u.hostname}:${port}: ${tcp}`, "server running? `docker compose ps`; firewall `ufw allow 8080/tcp`; router forward TCP 8080");
else ok(`TCP ${u.hostname}:${port} open (${Date.now() - t0} ms)`);

// 3. TLS (https only)
if (!tcp && u.protocol === "https:") {
  await new Promise((res) => {
    const s = tls.connect({ host: u.hostname, port, servername: u.hostname, timeout: 6000 }, () => {
      const c = s.getPeerCertificate(); const left = Math.round((Date.parse(c.valid_to) - Date.now()) / 864e5);
      s.authorized ? ok(`TLS certificate valid, ${left} days left`) : bad(`TLS certificate rejected: ${s.authorizationError}`, "use a real certificate (Caddy/Cloudflare) or the clients will refuse it");
      s.destroy(); res();
    });
    s.on("error", (e) => { bad(`TLS error: ${e.code || e.message}`); res(); });
  });
} else if (!tcp && u.protocol === "http:" && ip && !isPrivate(ip)) warn("plain http over the internet sends passwords unencrypted: use https before a real exam");

// 4. HTTP checks
async function http(path, init = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  try { return await fetch(base + path, { ...init, signal: ctl.signal }); } finally { clearTimeout(t); }
}
if (!tcp) {
  try {
    const a = Date.now(); const r = await http("/time"); const b = Date.now();
    if (!r.ok) bad(`GET /time -> HTTP ${r.status}`, "is this the exam server? a proxy may be answering");
    else {
      const d = await r.json(); const skew = Math.round(Date.parse(d.now) - (a + b) / 2);
      ok(`GET /time answered in ${b - a} ms (server clock differs by ${skew} ms; the app corrects for it)`);
    }
  } catch (e) { bad(`GET /time failed: ${e.cause?.code || e.message}`, "port open but HTTP failed: https vs http mismatch, or a captive portal/proxy"); }

  try {
    const r = await http("/events/ingest", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    [401, 403].includes(r.status) ? ok(`protected endpoints require login (POST /events/ingest without token -> ${r.status})`)
      : bad(`POST /events/ingest without a token -> ${r.status}, expected 401/403`, "authentication is not enforced");
  } catch (e) { bad(`auth probe failed: ${e.message}`); }

  try {
    const r = await http("/auth/login", { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,authorization" } });
    const allow = r.headers.get("access-control-allow-origin");
    allow ? ok(`CORS preflight from ${origin}: allowed (${allow})`) : warn(`CORS preflight from ${origin} refused (${r.status}). The teacher UI in a browser will fail; the student app and workers are not affected. Set APP_CORS_ALLOWED_ORIGINS.`);
  } catch (e) { warn(`CORS probe failed: ${e.message}`); }

  try {
    const r = await http("/judge/poll", { method: "POST", headers: { "X-Worker-Token": "definitely-wrong" }, body: "{}" });
    [401, 403].includes(r.status) ? ok("judge endpoints reject a wrong worker token") : warn(`judge endpoint with a wrong token -> ${r.status} (expected 401/403)`);
  } catch { /* optional */ }
}
console.log(failed ? `\n${failed} check(s) failed.` : `\nReachable from this machine.${warned ? ` ${warned} warning(s).` : ""}`);
process.exit(failed ? 1 : 0);
