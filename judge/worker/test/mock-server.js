'use strict';
// Minimal stand-in for the Spring server's /judge/** endpoints, used by run-tests.js.
const http = require('http');

function createMock(token = 'test-token') {
  const queue = [];
  const results = new Map();
  const claimedBy = new Map();
  const waiters = [];
  const seenWorkers = new Set();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.headers['x-worker-token'] !== token) { res.writeHead(401); return res.end('{}'); }
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (url.pathname === '/judge/claim') {
        const worker = url.searchParams.get('workerId');
        seenWorkers.add(worker);
        const tryClaim = () => {
          const job = queue.shift();
          if (!job) return false;
          claimedBy.set(job.id, worker);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(job));
          return true;
        };
        if (tryClaim()) return;
        const w = { tryClaim, timer: setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); res.writeHead(204); res.end(); }, 1500) };
        waiters.push(w);
        return;
      }
      const m = url.pathname.match(/^\/judge\/jobs\/([^/]+)\/(result|extend)$/);
      if (m) {
        if (m[2] === 'extend') { res.writeHead(200); return res.end('{"ok":true}'); }
        results.set(m[1], { worker: claimedBy.get(m[1]), ...JSON.parse(body) });
        res.writeHead(200); return res.end('{"ok":true}');
      }
      res.writeHead(404); res.end();
    });
  });

  return {
    server, results, seenWorkers,
    enqueue(job) {
      queue.push(job);
      for (let i = 0; i < waiters.length; i++) {
        const w = waiters[i];
        if (queue.length && w.tryClaim()) { clearTimeout(w.timer); waiters.splice(i, 1); break; }
      }
    },
    listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port))),
    close: () => server.close(),
  };
}

module.exports = { createMock };
