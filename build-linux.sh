#!/usr/bin/env bash
# Builds the Linux student app (AppImage + .deb) with the watchdog bundled. Needs internet for npm/electron.
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node 18+ required"; exit 1; }
echo "== watchdog tests";    (cd watchdog-linux && npm test)
echo "== student-app deps";  (cd student-app && npm install)
echo "== wiring tests";      (cd student-app && npm run test:watchdog)
echo "== package";           (cd student-app && npm run dist:linux)
echo; ls -1 student-app/dist/*.AppImage student-app/dist/*.deb
echo "Install: sudo apt install ./student-app/dist/exam-client-*.deb   or   chmod +x *.AppImage && ./exam-client-*.AppImage"
