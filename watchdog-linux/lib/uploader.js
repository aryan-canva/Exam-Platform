// Sends pending journal records to POST /events/ingest. The server skips seq it already has, so a retry
// after a lost response is safe. 401 = token expired (the app pushes a fresh one); 400/403/404/409 = the
// server will never take these (session ended / not ours): stop and keep them locally.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Uploader {
  constructor({ journal, sessionId, serverUrl, getToken, onAuthExpired = () => {}, fetchFn = globalThis.fetch, batch = 50, intervalMs = 1500, log = () => {} }) {
    Object.assign(this, { journal, sessionId, serverUrl: serverUrl.replace(/\/+$/, ""), getToken, onAuthExpired, fetchFn, batch, intervalMs, log });
    this.busy = false; this.fails = 0; this.notBefore = 0; this.timer = null;
    this.state = { authExpired: false, rejected: null, lastError: null, lastOkAt: null };
  }
  start() { this.timer = setInterval(() => this.tick(), this.intervalMs); this.timer.unref?.(); }
  stop() { clearInterval(this.timer); this.timer = null; }
  kick() { setImmediate(() => this.tick()); }
  resetAuth() { this.state.authExpired = false; this.notBefore = 0; }

  async tick() {
    if (this.busy || this.state.rejected || Date.now() < this.notBefore) return;
    const events = this.journal.pending(this.batch);
    if (!events.length) return;
    const token = this.getToken();
    if (!token || this.state.authExpired) return;
    this.busy = true;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
      let res;
      try {
        res = await this.fetchFn(this.serverUrl + "/events/ingest", {
          method: "POST", signal: ctl.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ sessionId: this.sessionId, events }),
        });
      } finally { clearTimeout(t); }
      if (res.ok) {
        this.journal.ack(events.at(-1).seq);
        this.fails = 0; this.state.lastError = null; this.state.lastOkAt = Date.now();
      } else if (res.status === 401) {
        this.state.authExpired = true; this.onAuthExpired();
      } else if ([400, 403, 404, 409].includes(res.status)) {
        this.state.rejected = res.status; this.state.lastError = `server rejected events (${res.status})`;
        this.log(this.state.lastError);
      } else throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      this.state.lastError = String(e.cause?.code || e.message);
      this.fails++; this.notBefore = Date.now() + Math.min(10000, 500 * 2 ** this.fails);
    } finally { this.busy = false; }
  }

  /** Resolve true when everything is acknowledged, false on timeout/rejection. */
  async flush(timeoutMs = 5000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (!this.journal.pendingCount) return true;
      if (this.state.rejected) return false;
      this.notBefore = 0; // user-requested flush ignores backoff
      await this.tick();
      if (this.journal.pendingCount) await sleep(100);
    }
    return this.journal.pendingCount === 0;
  }
}
