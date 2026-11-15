import { useState, useMemo } from "react";
import * as api from "../api.js";
import Integrity from "./Integrity.jsx";
import { useLoad, usePoll, useAction, Msg, Badge, Empty, fmtTime, fmtDur } from "../ui.jsx";

export default function Contests({ onAuthError }) {
  const { data: contests, err, reload } = useLoad(api.listContests);
  const [sel, setSel] = useState(null);
  const [creating, setCreating] = useState(false);
  if (err?.status === 401) onAuthError();

  if (sel) return <ContestPage id={sel} onBack={() => { setSel(null); reload(); }} onAuthError={onAuthError} />;
  return (
    <>
      <div className="head">
        <h2>Exams</h2>
        <button onClick={() => setCreating((v) => !v)}>{creating ? "Close" : "New exam"}</button>
      </div>
      {creating && <NewContest onAuthError={onAuthError} onDone={(c) => { setCreating(false); setSel(c.id); }} />}
      {err && <p className="note err">{err.message}</p>}
      {contests && contests.length === 0 && <Empty>No exams yet. Create one, add problems, enroll students, then publish and start it.</Empty>}
      {contests?.length > 0 && (
        <div className="scroll"><table className="click">
          <thead><tr><th>Title</th><th>Status</th><th>Duration</th><th>Scoring</th><th>Problems</th><th>Students</th></tr></thead>
          <tbody>{contests.map((c) => (
            <tr key={c.id} onClick={() => setSel(c.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSel(c.id)}>
              <td><strong>{c.title}</strong></td><td><Badge status={c.status} /></td><td>{fmtDur(c.durationSec)}</td>
              <td>{c.scoringMode}</td><td>{c.problemCount}</td><td>{c.enrolledCount}</td>
            </tr>))}
          </tbody></table></div>
      )}
    </>
  );
}

function NewContest({ onDone, onAuthError }) {
  const [f, setF] = useState({ title: "", minutes: 90, scoringMode: "ICPC", languages: ["C", "CPP", "JAVA", "PYTHON"] });
  const { busy, msg, run } = useAction(onAuthError);
  const LANGS = [["C", "C"], ["CPP", "C++"], ["JAVA", "Java"], ["PYTHON", "Python"]];
  async function submit(e) {
    e.preventDefault();
    if (!f.languages.length) return;
    const c = await run(async () => {
      const made = await api.createContest({ title: f.title, durationSec: Math.round(f.minutes * 60), scoringMode: f.scoringMode });
      return { ...made, ...(await api.setContestLanguages(made.id, f.languages)) };
    });
    if (c) onDone(c);
  }
  return (
    <form className="panel form" onSubmit={submit}>
      <div className="cols3">
        <label>Title<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></label>
        <label>Duration (minutes)<input type="number" min="1" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} required /></label>
        <label>Scoring
          <select value={f.scoringMode} onChange={(e) => setF({ ...f, scoringMode: e.target.value })}>
            <option value="ICPC">All or nothing per problem</option>
            <option value="IOI">Partial credit by testcase</option>
          </select>
        </label>
      </div>
      <fieldset className="langs"><legend>Languages students may use</legend>
        {LANGS.map(([id, label]) => (
          <label key={id} className="chk"><input type="checkbox" checked={f.languages.includes(id)}
            onChange={(e) => setF({ ...f, languages: e.target.checked ? [...f.languages, id] : f.languages.filter((x) => x !== id) })} /> {label}</label>))}
      </fieldset>
      <Msg m={msg} />
      <div><button disabled={busy || !f.languages.length}>Create exam</button></div>
    </form>
  );
}

function ContestPage({ id, onBack, onAuthError }) {
  const { data: c, err, reload } = useLoad(() => api.contestDetail(id), [id]);
  const [tab, setTab] = useState("setup");
  const { busy, msg, run } = useAction(onAuthError);
  if (err?.status === 401) onAuthError();
  if (!c) return <>{err ? <p className="note err">{err.message}</p> : <p className="dim">Loading…</p>}<button className="link" onClick={onBack}>Back</button></>;

  const act = (fn, ok) => async () => { if (await run(fn, ok) !== undefined) reload(); };
  const live = c.status === "RUNNING" || c.status === "ENDED";
  const canPublish = c.status === "DRAFT" && c.problems.length > 0 && c.students.length > 0;
  return (
    <>
      <button className="link" onClick={onBack}>← All exams</button>
      <div className="head">
        <div>
          <h2>{c.title} <Badge status={c.status} /></h2>
          <p className="dim">{fmtDur(c.durationSec)} · {c.scoringMode === "IOI" ? "partial credit" : "all or nothing"}
            {c.startsAt && <> · started {fmtTime(c.startsAt)}</>}{c.endsAt && <> · {c.status === "ENDED" ? "ended" : "ends"} {fmtTime(c.endsAt)}</>}</p>
        </div>
        <div className="actions">
          {c.status === "DRAFT" && <button disabled={busy || !canPublish} title={canPublish ? "" : "Add at least one problem and one student first"}
            onClick={act(() => api.publishContest(id), "Published. Students can now see this exam.")}>Publish</button>}
          {c.status === "SCHEDULED" && <button disabled={busy} onClick={() => confirm("Start now? The timer begins for everyone.") && act(() => api.startContest(id), "Exam started")()}>Start exam</button>}
          {c.status === "RUNNING" && <button className="danger" disabled={busy} onClick={() => confirm("End the exam for all students now?") && act(() => api.stopContest(id), "Exam ended")()}>End exam</button>}
        </div>
      </div>
      <Msg m={msg} />
      <div className="tabs">
        <button className={tab === "setup" ? "on" : ""} onClick={() => setTab("setup")}>Setup</button>
        <button className={tab === "standings" ? "on" : ""} onClick={() => setTab("standings")}>Standings</button>
        <button className={tab === "subs" ? "on" : ""} onClick={() => setTab("subs")}>Submissions</button>
        <button className={tab === "integrity" ? "on" : ""} onClick={() => setTab("integrity")}>Integrity</button>
      </div>
      {tab === "setup" && <Setup c={c} reload={reload} onAuthError={onAuthError} />}
      {tab === "standings" && <Standings c={c} live={live} />}
      {tab === "subs" && <Subs c={c} live={live} />}
      {tab === "integrity" && <Integrity c={c} />}
    </>
  );
}

function Setup({ c, reload, onAuthError }) {
  const draft = c.status === "DRAFT";
  const { data: problems } = useLoad(api.listProblems);
  const { data: students } = useLoad(api.listStudents);
  const [pid, setPid] = useState("");
  const [points, setPoints] = useState(100);
  const [pick, setPick] = useState(new Set());
  const [q, setQ] = useState("");
  const pa = useAction(onAuthError), ea = useAction(onAuthError);

  const usedLabels = new Set(c.problems.map((p) => p.label));
  const nextLabel = useMemo(() => { for (let i = 0; i < 26; i++) { const l = String.fromCharCode(65 + i); if (!usedLabels.has(l)) return l; } return "Z"; }, [c.problems]);
  const available = (problems || []).filter((p) => !c.problems.some((x) => x.problemId === p.id));
  const enrolled = new Set(c.students.map((s) => s.userId));
  const candidates = (students || []).filter((s) => !enrolled.has(s.id) && (s.username + " " + (s.fullName || "")).toLowerCase().includes(q.toLowerCase()));

  async function addProblem(e) {
    e.preventDefault();
    if (await pa.run(() => api.addContestProblem(c.id, { problemId: pid, label: nextLabel, points: +points }), `Added as problem ${nextLabel}`) !== undefined) { setPid(""); reload(); }
  }
  async function enrollPicked() {
    if (await ea.run(() => api.enroll(c.id, [...pick]), (r) => `Enrolled ${r.enrolled}`) !== undefined) { setPick(new Set()); reload(); }
  }
  const toggle = (id) => { const n = new Set(pick); n.has(id) ? n.delete(id) : n.add(id); setPick(n); };

  return (
    <div className="cols2 top">
      <section className="panel">
        <h3>Problems ({c.problems.length})</h3>
        {c.problems.length === 0 && <Empty>None yet.</Empty>}
        <ul className="plain">{c.problems.map((p) => <li key={p.problemId}><span className="tag">{p.label}</span> {p.title} <span className="dim">{p.points} pts</span></li>)}</ul>
        {draft && (
          <form className="form" onSubmit={addProblem}>
            <label>Add problem
              <select value={pid} onChange={(e) => setPid(e.target.value)} required>
                <option value="">Choose…</option>
                {available.map((p) => <option key={p.id} value={p.id} disabled={!p.testcaseCount}>{p.title}{p.testcaseCount ? "" : " (no testcases)"}</option>)}
              </select>
            </label>
            <label className="narrow">Points<input type="number" min="1" value={points} onChange={(e) => setPoints(e.target.value)} /></label>
            <Msg m={pa.msg} />
            <div><button disabled={pa.busy || !pid}>Add as {nextLabel}</button></div>
          </form>
        )}
        {!draft && <p className="dim">Problems are locked once the exam is published.</p>}
      </section>
      <section className="panel">
        <h3>Students ({c.students.length})</h3>
        {c.students.length === 0 && <Empty>No one enrolled.</Empty>}
        <ul className="plain scrolly">{c.students.map((s) => (
          <li key={s.userId}>{s.fullName || s.username} <span className="dim">{s.username}</span>
            {c.status !== "ENDED" && <button className="link danger" onClick={async () => { await ea.run(() => api.unenroll(c.id, s.userId)); reload(); }}>Remove</button>}
          </li>))}</ul>
        {c.status !== "ENDED" && (
          <div className="form">
            <label>Find students<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or username" /></label>
            <div className="picklist">
              {students && candidates.length === 0 && <p className="dim">{students.length === 0 ? "No students exist yet. Add them on the Students tab." : "No matching students outside this exam."}</p>}
              {candidates.map((s) => (
                <label key={s.id} className="check"><input type="checkbox" checked={pick.has(s.id)} onChange={() => toggle(s.id)} /> {s.fullName || s.username} <span className="dim">{s.username}</span></label>
              ))}
            </div>
            {candidates.length > 0 && <button type="button" className="ghost" onClick={() => setPick(new Set(candidates.map((s) => s.id)))}>Select all shown</button>}
            <Msg m={ea.msg} />
            <div><button disabled={ea.busy || pick.size === 0} onClick={enrollPicked}>Enroll {pick.size || ""} selected</button></div>
          </div>
        )}
      </section>
    </div>
  );
}

function Standings({ c, live }) {
  const { data, err } = usePoll(() => api.contestStandings(c.id), 5000, live || c.status === "SCHEDULED", [c.id]);
  const labels = c.problems.map((p) => p.label);
  if (err) return <p className="note err">{err.message}</p>;
  if (!data) return <p className="dim">Loading…</p>;
  const rows = [...data].sort((a, b) => b.total - a.total || b.solved - a.solved || (a.penaltyMin ?? 0) - (b.penaltyMin ?? 0) || a.username.localeCompare(b.username));
  if (!rows.length) return <Empty>No enrolled students.</Empty>;
  return (
    <div className="scroll"><table>
      <thead><tr><th>#</th><th>Student</th>{labels.map((l) => <th key={l} className="num">{l}</th>)}<th className="num">Solved</th><th className="num">Score</th><th className="num" title="Minutes to each first AC + 20 per wrong attempt">Penalty</th></tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={r.userId}><td>{i + 1}</td><td>{r.fullName || r.username} <span className="dim">{r.username}</span></td>
          {labels.map((l) => <td key={l} className={"num" + (r.problems?.[l] ? "" : " dim")}>{r.problems?.[l] ?? "–"}</td>)}
          <td className="num">{r.solved}</td><td className="num"><strong>{r.total}</strong></td><td className="num dim">{r.penaltyMin ?? 0}</td></tr>))}
      </tbody></table></div>
  );
}

function Subs({ c, live }) {
  const { data, err } = usePoll(() => api.contestSubmissions(c.id), 4000, true, [c.id]);
  const [only, setOnly] = useState("");
  if (err) return <p className="note err">{err.message}</p>;
  if (!data) return <p className="dim">Loading…</p>;
  const rows = data.filter((s) => !only || (only === "WRONG" ? s.verdict && s.verdict !== "AC" : s.verdict === only));
  return (
    <>
      <div className="inline">
        <label className="narrow">Show<select value={only} onChange={(e) => setOnly(e.target.value)}>
          <option value="">All</option><option value="AC">Accepted</option><option value="WRONG">Not accepted</option>
        </select></label>
        {live && c.status === "RUNNING" && <span className="dim">Updating every few seconds</span>}
      </div>
      {rows.length === 0 && <Empty>No submissions yet.</Empty>}
      {rows.length > 0 && <div className="scroll"><table>
        <thead><tr><th>Time</th><th>Student</th><th>Problem</th><th>Language</th><th>Verdict</th><th className="num">Score</th><th className="num">Runtime</th></tr></thead>
        <tbody>{rows.map((s) => (
          <tr key={s.id}><td>{fmtTime(s.createdAt)}</td><td>{s.fullName || s.username}</td><td>{s.label}. {s.problemTitle}</td><td>{s.language}</td>
            <td>{s.verdict ? <Badge status={s.verdict} /> : <span className="dim">{s.status}</span>}</td>
            <td className="num">{s.score ?? "–"}</td><td className="num">{s.runtimeMs != null ? s.runtimeMs + " ms" : "–"}</td></tr>))}
        </tbody></table></div>}
    </>
  );
}
