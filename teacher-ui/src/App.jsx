import { useState, useCallback } from "react";
import * as api from "./api.js";
import { Msg, useAction } from "./ui.jsx";
import Problems from "./views/Problems.jsx";
import Contests from "./views/Contests.jsx";
import Students from "./views/Students.jsx";
import Judge from "./views/Judge.jsx";

const TABS = [
  ["contests", "Exams", Contests],
  ["problems", "Problems", Problems],
  ["students", "Students", Students],
  ["judge", "Judge", Judge],
];

export default function App() {
  const [user, setUser] = useState(() => {
    const u = sessionStorage.getItem("user");
    return u && api.getToken() ? JSON.parse(u) : null;
  });
  const [tab, setTab] = useState(() => sessionStorage.getItem("tab") || "contests");

  const logout = useCallback(() => {
    api.setToken(null);
    sessionStorage.removeItem("user");
    setUser(null);
  }, []);
  const onLogin = (res) => {
    api.setToken(res.accessToken);
    sessionStorage.setItem("user", JSON.stringify(res.user));
    setUser(res.user);
  };
  const pick = (t) => { sessionStorage.setItem("tab", t); setTab(t); };

  if (!user) return <Auth onLogin={onLogin} />;
  const View = (TABS.find((t) => t[0] === tab) || TABS[0])[2];
  return (
    <div className="app">
      <nav className="side">
        <div className="brand">Exam Desk</div>
        {TABS.map(([id, label]) => (
          <button key={id} className={"navbtn" + (id === tab ? " on" : "")} onClick={() => pick(id)}>{label}</button>
        ))}
        <div className="grow" />
        <div className="who">
          <div>{user.fullName || user.username}</div>
          <div className="dim">{api.getServerUrl()}</div>
          <button className="link" onClick={logout}>Log out</button>
        </div>
      </nav>
      <main className="main"><View onAuthError={logout} /></main>
    </div>
  );
}

function Auth({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [server, setServer] = useState(api.getServerUrl());
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [reach, setReach] = useState(null);
  const { busy, msg, setMsg, run } = useAction();

  async function test() {
    api.setServerUrl(server);
    setReach(null);
    try { await api.ping(); setReach({ ok: true, text: "Server reachable" }); }
    catch (e) { setReach({ ok: false, text: e.message }); }
  }
  async function submit(e) {
    e.preventDefault();
    api.setServerUrl(server);
    if (mode === "register") {
      const r = await run(() => api.register(username, password));
      if (r !== undefined) { setMode("login"); setMsg({ ok: true, text: "Teacher account created. Log in." }); }
    } else {
      const r = await run(() => api.login(username, password));
      if (r) onLogin(r);
    }
  }
  return (
    <div className="authwrap">
      <form className="auth" onSubmit={submit}>
        <h1>Exam Desk</h1>
        <p className="dim">Teacher console</p>
        <label>Server address
          <div className="inline">
            <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="http://192.168.1.50:8080" required />
            <button type="button" className="ghost" onClick={test}>Test</button>
          </div>
        </label>
        <Msg m={reach} />
        <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required /></label>
        <label>Password<input type="password" value={password} minLength={mode === "register" ? 8 : undefined}
          onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required /></label>
        <Msg m={msg} />
        <button disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Log in" : "Create teacher account"}</button>
        <button type="button" className="link" onClick={() => { setMode(mode === "login" ? "register" : "login"); setMsg(null); }}>
          {mode === "login" ? "First time here? Create the first teacher account" : "Back to log in"}
        </button>
      </form>
    </div>
  );
}
