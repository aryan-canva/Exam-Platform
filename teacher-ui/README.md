# Teacher UI

Web app for the teacher. Covers everything in `server/demo.http`: register teacher, log in, list problems, create contest.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and set `VITE_SERVER_URL` to the server device's IP, e.g. `http://192.168.1.50:8080`.
3. `npm run dev` (opens on port 5173; restart after editing `.env`).

## Server side (other device)
- Allow the teacher UI origin in CORS, in `server/src/main/resources/application.properties`:
  `app.cors.allowed-origins=http://<teacher-device-ip>:5173,http://localhost:5173`
- Allow port 8080 through the server device's firewall.
