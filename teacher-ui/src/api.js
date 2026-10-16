// Server address comes from .env -> VITE_SERVER_URL (the server runs on a different device).
const BASE = (import.meta.env.VITE_SERVER_URL || "http://localhost:8080").replace(/\/+$/, "");

let token = sessionStorage.getItem("token") || null;

export const serverUrl = BASE;
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
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`Cannot reach server at ${BASE}. Check VITE_SERVER_URL, network and CORS.`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Same calls as server/demo.http
export const register = (username, password) => call("POST", "/auth/register", { username, password });
export const login = (username, password) => call("POST", "/auth/login", { username, password });
export const listProblems = () => call("GET", "/problems");
export const createContest = (dto) => call("POST", "/contests", dto);
