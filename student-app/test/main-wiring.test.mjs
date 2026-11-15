// Loads the real main.js with a fake `electron` and drives the wd:* IPC handlers end to end against a real watchdog.
import test from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { mockServer, tmp, until, verifyChain } from "../../watchdog-linux/test/helpers.js";

const require = createRequire(import.meta.url);
let ready; const handlers = {}, winHandlers = {}, userData = tmp("ud-");
const fakeWin = { once() {}, loadFile() {}, setMenu() {}, webContents: { on() {}, send() {}, setWindowOpenHandler() {} }, on: (e, f) => (winHandlers[e] = f), setKiosk() {}, setAlwaysOnTop() {}, setMinimizable() {}, focus() {}, setFullScreen() {}, maximize() {}, restore() {} };
const electron = {
  app: { getPath: () => userData, getVersion: () => "0.1.0", requestSingleInstanceLock: () => true, on() {}, whenReady: () => ({ then: (f) => (ready = f) }), commandLine: { appendSwitch() {} }, quit() {} },
  BrowserWindow: function () { return fakeWin; }, ipcMain: { handle: (n, f) => (handlers[n] = f) }, globalShortcut: {}, Menu: { setApplicationMenu() {} }, clipboard: {}, session: { defaultSession: { setPermissionRequestHandler() {} } },
};
const origLoad = Module._load;
Module._load = (req, ...r) => (req === "electron" ? electron : origLoad(req, ...r));
process.argv.push("--windowed"); // dev mode: LOG only
require("../main.js"); ready();
const SID = "44444444-4444-4444-4444-444444444444";
const srv = await mockServer({ token: "t1", sessionId: SID });
test.after(() => { handlers["wd:end"]?.({}, "test"); srv.close(); setTimeout(() => process.exit(0), 100).unref(); });

test("all wd:* handlers exist", () => { for (const n of ["wd:start", "wd:event", "wd:token", "wd:flush", "wd:end", "wd:health"]) assert.equal(typeof handlers[n], "function", n); });
test("wd:start without a session key from the server is refused", async () => {
  const r = await handlers["wd:start"]({}, { sessionId: SID, serverUrl: srv.url, token: "t1" });
  assert.equal(r.ok, false); assert.match(r.error, /session key/);
});
test("the renderer never receives the session key; the main process keeps it", async () => {
  const r = await handlers.http({}, { method: "POST", url: srv.url + "/sessions/start", headers: { Authorization: "Bearer t1", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(r.status, 201);
  const j = JSON.parse(r.text); assert.equal(j.id, SID); assert.ok(!("sessionKey" in j)); assert.ok(!r.text.includes(srv.st.key()));
});
test("wd:start launches the watchdog and uploads", async () => {
  const r = await handlers["wd:start"]({}, { sessionId: SID, serverUrl: srv.url, token: "t1" });
  assert.deepEqual(r, { ok: true, supported: true });
  await until(() => srv.st.events.length >= 1);
  assert.equal(JSON.parse(srv.st.events[0].payloadJson).mode, "LOG"); // windowed => never kills
});
test("renderer paste event and window events reach the server", async () => {
  await handlers["wd:event"]({}, { type: "PASTE", payload: { blocked: true, chars: 12 } });
  await handlers["exam:mode"]({}, true); // examMode on: blur/close are now reported by the main process itself
  winHandlers.blur(); winHandlers.close({ preventDefault() {} });
  await until(() => ["PASTE", "FOCUS_LOST", "KIOSK_EXIT_ATTEMPT"].every((t) => srv.st.events.some((e) => e.type === t)));
  assert.deepEqual(await handlers["wd:health"](), { ok: true });
});
test("flush then end delivers WATCHDOG_STOPPED; chain verifies", async () => {
  assert.equal(await handlers["wd:flush"](), true);
  const r = await handlers["wd:end"]({}, "exam_ended");
  assert.equal(r.flushed, true);
  const key = srv.st.key(SID);
  assert.equal(srv.st.events.at(-1).type, "WATCHDOG_STOPPED");
  assert.deepEqual(verifyChain(srv.st.events, key), { ok: true });
});
