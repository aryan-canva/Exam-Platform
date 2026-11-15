// All HTTP goes through the main process (window.native.http): no CORS, works with any server address.
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
let base = "";
let token = null;
let offset = 0; // serverNow - clientNow, ms
let onToken = null; // called with every refreshed token (the watchdog needs it to keep uploading)
let reauth = null; // async () => new access token | null; lets a long exam survive token expiry

export const setBase = (u) => { base = (u || "").trim().replace(/\/+$/, ""); };
export const getBase = () => base;
export const setToken = (t) => { token = t; };
export const getToken = () => token;
export const setOnToken = (fn) => { onToken = fn; };
export const setReauth = (fn) => { reauth = fn; };
export const serverNow = () => Date.now() + offset;

async function call(method, path, body, timeoutMs, retried = false) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await window.native.http({ method, url: base + path, headers, body: body === undefined ? undefined : JSON.stringify(body), timeoutMs });
  if (r.status === 0) throw new ApiError(0, r.error === "timeout" ? "The server did not answer in time." : `Cannot reach the server (${r.error}).`);
  let data = null;
  try { data = r.text ? JSON.parse(r.text) : null; } catch { data = r.text; }
  if (r.status >= 200 && r.status < 300) return data;
  if (r.status === 401 && token && reauth && !retried && path !== "/auth/login") {
    const t = await reauth().catch(() => null);
    if (t) { token = t; onToken?.(t); return call(method, path, body, timeoutMs, true); }
  }
  throw new ApiError(r.status, (data && (data.message || data.error)) || `Server error ${r.status}`);
}

export async function ping() {
  const t0 = Date.now();
  const d = await call("GET", "/time", undefined, 6000);
  const t1 = Date.now();
  offset = Date.parse(d.now) - (t0 + t1) / 2;
  return d;
}
export const login = (username, password) => call("POST", "/auth/login", { username, password });
export const myContests = () => call("GET", "/contests/mine");
export const contest = (id) => call("GET", `/contests/${id}`);
export const problem = (id, contestId) => call("GET", `/problems/${id}?contestId=${contestId}`);
export const startSession = (contestId, deviceFp, clientVersion) => call("POST", "/sessions/start", { contestId, deviceFp, clientVersion });
export const heartbeat = (id, seq) => call("POST", `/sessions/${id}/heartbeat`, { seq }, 8000);
export const endSession = (id) => call("POST", `/sessions/${id}/end`, {});
export const run = (language, sourceCode, stdin, problemId) => call("POST", "/runs", { language, sourceCode, stdin, problemId });
export const getRun = (id) => call("GET", `/runs/${id}`);
export const submit = (dto) => call("POST", "/submissions", dto);
export const getSubmission = (id) => call("GET", `/submissions/${id}`);
export const mySubmissions = (contestId) => call("GET", `/submissions?contestId=${contestId}`);
