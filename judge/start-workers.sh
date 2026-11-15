#!/usr/bin/env bash
# Starts two judge workers that connect to the exam server over its IP/hostname.
#   ./start-workers.sh http://203.0.113.5:8080 <worker-token>
set -euo pipefail
SERVER_URL="${1:-${SERVER_URL:-}}"; TOKEN="${2:-${WORKER_TOKEN:-dev-worker-token}}"
[ -n "$SERVER_URL" ] || { echo "usage: $0 <server-url> [worker-token]"; exit 1; }
cd "$(dirname "$0")/worker"
pids=()
for id in judge-1 judge-2; do
  node worker.js --server "$SERVER_URL" --id "$id" --token "$TOKEN" --sandbox docker 2>&1 | sed -u "s/^/[$id] /" &
  pids+=($!)
done
trap 'kill ${pids[*]} 2>/dev/null || true' INT TERM EXIT
wait
