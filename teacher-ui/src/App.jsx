import { useState, useEffect, useCallback } from "react";
import * as api from "./api.js";

export default function App() {
  const [user, setUser] = useState(() => {
    const u = sessionStorage.getItem("user");
    return u && api.getToken() ? JSON.parse(u) : null;
  });

  const onLogin = (res) => {
    api.setToken(res.accessToken);
    sessionStorage.setItem("user", JSON.stringify(res.user));
    setUser(res.user);
  };
  const logout = useCallback(() => {
    api.setToken(null);
    sessionStorage.removeItem("user");
    setUser(null);
  }, []);

  return (
    <div className="shell">
      <header>
        <div>
          <h1>Teacher Console</h1>
        </div>
        {user && (
          <div className="who">
            {user.username} <button className="ghost" onClick={logout}>Log out</button>
          </div>
        )}
      </header>
      {user ? <Dashboard onExpired={logout} /> : <Auth onLogin={onLogin} />}
    </div>
  );
}

function Auth({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === "register") {
        await api.register(username, password);
        setMode("login");
        setMsg({ ok: true, text: "Teacher registered. You can log in now." });
      } else {
        onLogin(await api.login(username, password));
      }
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally { setBusy(false); }
  }

  return (
    <form className="card narrow" onSubmit={submit}>
      <h2>{mode === "login" ? "Log in" : "Register teacher"}</h2>
      <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
      <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      {msg && <p className={msg.ok ? "ok" : "err"}>{msg.text}</p>}
      <button disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Log in" : "Register"}</button>
      <button type="button" className="ghost" onClick={() => { setMode(mode === "login" ? "register" : "login"); setMsg(null); }}>
        {mode === "login" ? "Need an account? Register" : "Back to log in"}
      </button>
    </form>
  );
}

function Dashboard({ onExpired }) {
  return (
    <main>
      <Problems onExpired={onExpired} />
      <CreateContest onExpired={onExpired} />
    </main>
  );
}

const handle = (err, onExpired) => {
  if (err.status === 401 || err.status === 403) onExpired();
  return err.message;
};

function Problems({ onExpired }) {
  const [problems, setProblems] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    setErr(null);
    api.listProblems().then(setProblems).catch((e) => setErr(handle(e, onExpired)));
  }, [onExpired]);
  useEffect(load, [load]);

  return (
    <section className="card">
      <div className="row"><h2>Problems</h2><button className="ghost" onClick={load}>Refresh</button></div>
      {err && <p className="err">{err}</p>}
      {!problems && !err && <p>Loading…</p>}
      {problems && problems.length === 0 && <p>No problems yet.</p>}
      {problems && problems.length > 0 && (
        <table>
          <thead><tr><th>Title</th><th>Time (ms)</th><th>Memory (KB)</th><th>ID</th></tr></thead>
          <tbody>
            {problems.map((p) => (
              <tr key={p.id}>
                <td>{p.title}</td><td>{p.timeLimitMs}</td><td>{p.memoryLimitKb}</td>
                <td className="mono">{p.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function CreateContest({ onExpired }) {
  const [title, setTitle] = useState("Demo Exam");
  const [durationSec, setDurationSec] = useState(3600);
  const [scoringMode, setScoringMode] = useState("ICPC");
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setErr(null); setResult(null);
    try {
      setResult(await api.createContest({ title, durationSec: Number(durationSec), scoringMode }));
    } catch (e2) { setErr(handle(e2, onExpired)); }
  }

  return (
    <section className="card">
      <h2>Create contest</h2>
      <form onSubmit={submit}>
        <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
        <label>Duration (seconds)<input type="number" min="1" value={durationSec} onChange={(e) => setDurationSec(e.target.value)} required /></label>
        <label>Scoring mode
          <select value={scoringMode} onChange={(e) => setScoringMode(e.target.value)}>
            <option>ICPC</option><option>IOI</option>
          </select>
        </label>
        <button>Create contest</button>
      </form>
      {err && <p className="err">{err}</p>}
      {result && (
        <p className="ok">Created “{result.title}” — ID <span className="mono">{result.id}</span></p>
      )}
    </section>
  );
}
