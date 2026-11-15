# Connecting the parts across networks

Only the **server** needs to be reachable. The teacher UI, every student app and every judge worker make **outbound** HTTP(S) calls to one address, the *server URL*. Nothing connects back to them, so students, teachers and judges can all sit behind different routers.

```
 student app  ─┐
 teacher UI   ─┼──►  server URL (port 8080)  ──►  Postgres (local only)
 judge worker ─┘
```

## 1. Start the server (any machine with Docker)
```bash
cd server
cp .env.example .env        # set POSTGRES_PASSWORD, APP_JWT_SECRET, APP_JUDGE_WORKER_TOKEN, APP_INTEGRITY_SECRET (openssl rand -base64 32)
docker compose up -d --build
curl http://localhost:8080/time      # -> {"now":"..."}
```
Without Docker: run Postgres 16, create database `coding_exam_platform`, then `mvn spring-boot:run` (override with `SPRING_DATASOURCE_URL/USERNAME/PASSWORD`, `APP_JWT_SECRET`, `APP_JUDGE_WORKER_TOKEN`, `APP_INTEGRITY_SECRET`).
The first teacher is created on the teacher UI login screen ("Create the first teacher account").

## 2. Pick how people reach it

| Situation | Server URL to use | Setup |
|---|---|---|
| Everyone on one LAN | `http://<server-LAN-IP>:8080` | open the firewall (below) |
| Server has a public IP, or the router forwards a port | `http://<public-IP>:8080` | router: forward TCP 8080 to the server; firewall rule |
| Server is behind NAT/CGNAT and you cannot forward ports | `https://<name>.trycloudflare.com` or your own hostname | Cloudflare Tunnel (below) |
| You control all machines (teacher, judge) and want a private network | `http://100.x.y.z:8080` or the MagicDNS name | Tailscale (below) |

Find the LAN IP: `ipconfig` (Windows) or `ip addr` (Linux).

**Firewall, Windows** (admin PowerShell): `New-NetFirewallRule -DisplayName "Exam server" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow`
**Firewall, Linux**: `sudo ufw allow 8080/tcp`
Never open 5432; compose already binds Postgres to localhost.

### Cloudflare Tunnel (no inbound ports, gives HTTPS)
```bash
cloudflared tunnel --url http://localhost:8080
```
It prints `https://<random>.trycloudflare.com`. That is the server URL for all three components. The address changes each time you restart it, which is fine for one exam day: share the new one. For a permanent address create a named tunnel on a domain you own (`cloudflared tunnel create`, route a hostname to `http://localhost:8080`). Workers long-poll for 20 s, well under Cloudflare's 100 s limit.

### Tailscale
Install Tailscale on the server and on each judge/teacher machine and sign in to the same tailnet; use the server's `100.x.y.z` address or MagicDNS name. Student PCs would also need Tailscale, so for students prefer a LAN or a tunnel. `tailscale funnel 8080` publishes the server on a public HTTPS name without a Cloudflare account.

## 3. Tell each component the address
| Component | Where |
|---|---|
| Student app | first screen (remembered). Lab installs: `student-app/defaults.json` before building, or `--server=URL` |
| Teacher UI | login screen "Server address" (remembered), default from `teacher-ui/.env` `VITE_SERVER_URL` |
| Judge workers | `./start-workers.sh <URL> <WORKER_TOKEN>` or `.\start-workers.ps1 -Server <URL> -Token <WORKER_TOKEN>` |

The worker token must equal the server's `APP_JUDGE_WORKER_TOKEN`.

## 3b. Prove it is reachable from another network
On a machine **outside** the server's network (a laptop on a phone hotspot, a cloud VM, a student PC at home):
```bash
node tools/check-reachability.mjs http://<SERVER-or-tunnel-URL>
```
It checks DNS, TCP, TLS certificate, `GET /time`, that protected endpoints demand a login, CORS for the teacher UI (`--origin http://<teacher-ui-origin>`) and that the judge endpoint rejects a wrong token. Exit code 0 = reachable. A `warn` about a private/loopback address means only the same network can reach it.

What the server itself does: it listens on all interfaces (`server.address=0.0.0.0`, compose publishes `8080`), so **any IP can connect once the network path exists**. The path is what you must provide: public IP or router port-forward (TCP 8080), or a tunnel. Nothing in the app restricts source IPs.

## 4. Before a real exam
- Use HTTPS (tunnel, or a reverse proxy such as Caddy: `exam.example.com { reverse_proxy localhost:8080 }`). Plain `http://` over the internet sends passwords unencrypted.
- Keep `APP_REQUIRE_STRONG_SECRETS=true` (in `.env.example`): the server then refuses to start with placeholder secrets.
- Replace every default secret (JWT secret, worker token, Postgres password). Set `APP_CORS_ALLOWED_ORIGINS` to the teacher UI origin if it is hosted somewhere fixed.
- Run workers on a machine with Docker, not in `SANDBOX=process`.
- Run `node tools/integration-test.mjs <URL>` once from any machine.

## Troubleshooting
| Symptom | Cause |
|---|---|
| "Cannot reach the server" | wrong IP/port, firewall, different network without a tunnel, `http` vs `https` |
| Teacher UI: network error but `curl` works | CORS: set `APP_CORS_ALLOWED_ORIGINS` |
| Worker log: 401/403 | token differs from `APP_JUDGE_WORKER_TOKEN` |
| Submissions stay "In queue" | no worker online: check the Judge tab in the teacher UI |
| Student clocks look wrong | the app uses the server's clock (`/time`), so local clock skew does not matter |
