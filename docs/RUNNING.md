# How to run everything (step by step)

Do the steps in order. Use a separate terminal for steps 2, 3 and 4 because they keep running. Stop at the first step that fails and read its "If it fails" line.

Replace `<PROJECT>` with the folder that contains `server`, `teacher-ui`, `student-app` and `judge` (e.g. `~/Desktop/Exam-Platform/Exam-Platform-main`).

## 0. Install once
| Tool | Linux (Ubuntu) | Windows |
|---|---|---|
| Docker + Compose | `docker --version` and `docker compose version` must work. Your user must be in the `docker` group. | Docker Desktop, then wait for "Engine running" |
| Node.js 18 or newer | `node -v` | nodejs.org LTS |

You do not need Java or Maven: Docker builds the server.

## 1. Server and database
```bash
cd <PROJECT>/server
cp .env.example .env          # Windows: copy .env.example .env
nano .env                     # Windows: notepad .env
```
Set `POSTGRES_PASSWORD`, `APP_JWT_SECRET` (32+ random characters), `APP_JUDGE_WORKER_TOKEN` and `APP_INTEGRITY_SECRET` (32+ random characters, signs the student event chain). Create random values with `openssl rand -base64 32`. Do not share this file.
```bash
docker compose up -d --build
```
First build takes several minutes.
**Check:** `curl http://localhost:8080/time` (or open it in a browser) shows `{"now":"..."}`.
**If it fails:** `docker compose logs server` and read the last 50 lines.

To restart after changing server code: `docker compose up -d --build server`. **Never** run `docker compose down -v`; it deletes the database.

## 2. Teacher UI
```bash
cd <PROJECT>/teacher-ui
npm install
npm run dev
```
Open http://localhost:5173. Type `http://localhost:8080` as the server address and press Test. Choose "Create the first teacher account", then log in.
**Check:** tabs Problems, Exams, Students, Judge are visible.

## 3. Judge workers
Linux / macOS:
```bash
cd <PROJECT>/judge
set -a; source ../server/.env; set +a
bash ./start-workers.sh http://localhost:8080 "$APP_JUDGE_WORKER_TOKEN"
```
Windows PowerShell:
```powershell
cd <PROJECT>\judge
.\start-workers.ps1 -Server http://localhost:8080 -Token <your worker token>
```
(If scripts are blocked: `Set-ExecutionPolicy -Scope Process Bypass`.)
The first start pulls three Docker images.
**Check:** teacher UI, Judge tab: `judge-1` and `judge-2` are online.

## 4. Student app
```bash
cd <PROJECT>/student-app
npm install
npm run dev        # normal window, safe for testing
```
Use `npm start` only for the real locked-down kiosk (full screen, cannot be closed from inside).
Enter the server address, press Test, and log in as a student created in the teacher UI.

**Linux only:** if Electron complains about `chrome-sandbox`:
```bash
sudo chown root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```
As a last resort for testing only: `npx electron . --windowed --no-sandbox`.

## 5. Make an exam (teacher UI)
1. Problems: create "Add Two Numbers", then add testcases: input `1 2` expected `3` (tick **sample**), input `10 20` expected `30`, input `-5 5` expected `0` (leave **sample** unticked so they are hidden).
2. Students: paste `student1,pass1234,Asha Verma,R001` and add.
3. Exams: create, tick the languages allowed, add the problem, enroll the student, **Publish**, **Start**.

## 6. Check the judge as a student
Run with an empty input box: it should run the sample (`1 2`) and show `Expected output: 3`. Then submit each of these:
| Code | Expect |
|---|---|
| Correct C++ | AC, score 100, all tests pass |
| Prints `0` always | WA |
| `int main( {` | CE with compiler text |
| `int main(){ return 1/0; }` style crash (`abort();`) | RE |
| `while(true){}` | TLE |
| Allocate a huge array in a loop | MLE or RE |
| Python `print(sum(map(int,input().split())))` | AC |
| Java `public class Main` reading two ints | AC |

## 7. Automatic end-to-end test
```bash
cd <PROJECT>
node tools/integration-test.mjs http://localhost:8080
```
Each line starts with `ok` or `FAIL`. Needs both workers online.

## 8. Other networks
See `docs/NETWORKING.md` (Cloudflare Tunnel is the easiest). Everyone just types the server's public address instead of `localhost`.

## 9. Windows installer for the student PCs
On a Windows machine: `cd student-app`, `npm install`, `npm run dist`. The installer appears in `student-app/dist`. Put the lab's server address in `student-app/defaults.json` before building.
