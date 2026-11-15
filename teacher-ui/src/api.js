// Server address: the value saved in the browser (set on the login screen) wins over .env VITE_SERVER_URL.
const ENV_URL = (import.meta.env.VITE_SERVER_URL || "http://localhost:8080").replace(/\/+$/, "");
const clean = (u) => (u || "").trim().replace(/\/+$/, "");

let base = clean(localStorage.getItem("serverUrl")) || ENV_URL;
let token = sessionStorage.getItem("token") || null;

export const getServerUrl = () => base;
export function setServerUrl(u) {
  base = clean(u) || ENV_URL;
  localStorage.setItem("serverUrl", base);
}
export const getToken = () => token;
export function setToken(t) {
  token = t;
  t ? sessionStorage.setItem("token", t) : sessionStorage.removeItem("token");
}

async function call(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error(`Cannot reach the server at ${base}. Check the address, the network, and the server's CORS setting.`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error((data && (data.message || data.error)) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const ping = () => call("GET", "/time");
/** Server clock minus this browser's clock, in ms (so gap warnings use the server's time, not the teacher PC's). */
export async function clockOffset() { const t0 = Date.now(); const r = await call("GET", "/time"); const t1 = Date.now(); return Date.parse(r.now) - (t0 + t1) / 2; }
export const register = (username, password) => call("POST", "/auth/register", { username, password });
export const login = (username, password) => call("POST", "/auth/login", { username, password });

export const listProblems = () => call("GET", "/problems");
export const createProblem = (dto) => call("POST", "/problems", dto);
export const listTestcases = (id) => call("GET", `/problems/${id}/testcases`);
export const addTestcase = (id, dto) => call("POST", `/problems/${id}/testcases`, dto);
export const deleteTestcase = (id, tcId) => call("DELETE", `/problems/${id}/testcases/${tcId}`);

export const listContests = () => call("GET", "/contests");
export const createContest = (dto) => call("POST", "/contests", dto);
export const setContestLanguages = (id, languages) => call("PUT", `/contests/${id}/languages`, { languages });
export const contestDetail = (id) => call("GET", `/contests/${id}/detail`);
export const addContestProblem = (id, dto) => call("POST", `/contests/${id}/problems`, dto);
export const enroll = (id, userIds) => call("POST", `/contests/${id}/enroll`, { userIds });
export const unenroll = (id, userId) => call("DELETE", `/contests/${id}/enroll/${userId}`);
export const publishContest = (id) => call("POST", `/contests/${id}/publish`);
export const startContest = (id) => call("POST", `/contests/${id}/start`);
export const stopContest = (id) => call("POST", `/contests/${id}/stop`);
export const contestSubmissions = (id) => call("GET", `/contests/${id}/submissions`);
export const contestStandings = (id) => call("GET", `/contests/${id}/standings`);
export const contestSessions = (id) => call("GET", `/contests/${id}/sessions`);
export const sessionEvents = (sessionId) => call("GET", `/events?sessionId=${encodeURIComponent(sessionId)}`);

export const listStudents = () => call("GET", "/users?role=STUDENT");
export const bulkStudents = (students) => call("POST", "/users/students/bulk", { students });
export const resetPassword = (id, password) => call("POST", `/users/${id}/password`, { password });

export const judgeStatus = () => call("GET", "/admin/judge/workers");
