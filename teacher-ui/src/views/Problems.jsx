import { useState } from "react";
import * as api from "../api.js";
import { useLoad, useAction, Msg, Empty } from "../ui.jsx";

export default function Problems({ onAuthError }) {
  const { data: problems, err, reload } = useLoad(api.listProblems);
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  if (err?.status === 401) onAuthError();

  return (
    <>
      <div className="head">
        <h2>Problems</h2>
        <button onClick={() => setCreating((v) => !v)}>{creating ? "Close" : "New problem"}</button>
      </div>
      {creating && <NewProblem onAuthError={onAuthError} onDone={(p) => { setCreating(false); setOpen(p.id); reload(); }} />}
      {err && <p className="note err">{err.message}</p>}
      {problems && problems.length === 0 && <Empty>No problems yet. Create one, then add testcases to it.</Empty>}
      <div className="stack">
        {problems?.map((p) => (
          <section key={p.id} className="panel">
            <button className="rowbtn" onClick={() => setOpen(open === p.id ? null : p.id)}>
              <strong>{p.title}</strong>
              <span className="dim">{p.timeLimitMs} ms · {Math.round(p.memoryLimitKb / 1024)} MB · {p.checkerType} · {p.testcaseCount} testcases</span>
            </button>
            {open === p.id && <ProblemBody p={p} onChanged={reload} onAuthError={onAuthError} />}
          </section>
        ))}
      </div>
    </>
  );
}

function NewProblem({ onDone, onAuthError }) {
  const [f, setF] = useState({ title: "", statementMd: "", timeLimitMs: 2000, memoryLimitKb: 262144, checkerType: "TOKEN" });
  const { busy, msg, run } = useAction(onAuthError);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    const p = await run(() => api.createProblem({ ...f, timeLimitMs: +f.timeLimitMs, memoryLimitKb: +f.memoryLimitKb }));
    if (p) onDone(p);
  }
  return (
    <form className="panel form" onSubmit={submit}>
      <label>Title<input value={f.title} onChange={set("title")} required /></label>
      <label>Statement (Markdown)
        <textarea rows={9} value={f.statementMd} onChange={set("statementMd")} required
          placeholder={"Given two integers, print their sum.\n\n**Input:** two integers a and b\n**Output:** a + b"} />
      </label>
      <div className="cols3">
        <label>Time limit (ms)<input type="number" min="100" value={f.timeLimitMs} onChange={set("timeLimitMs")} /></label>
        <label>Memory limit (KB)<input type="number" min="16384" value={f.memoryLimitKb} onChange={set("memoryLimitKb")} /></label>
        <label>Output checking
          <select value={f.checkerType} onChange={set("checkerType")}>
            <option value="TOKEN">Ignore whitespace differences</option>
            <option value="EXACT">Line by line (trailing spaces ignored)</option>
          </select>
        </label>
      </div>
      <Msg m={msg} />
      <div><button disabled={busy}>Create problem</button></div>
    </form>
  );
}

function ProblemBody({ p, onChanged, onAuthError }) {
  const { data: tcs, reload } = useLoad(() => api.listTestcases(p.id), [p.id]);
  const [f, setF] = useState({ inputRef: "", expectedRef: "", points: 10, isSample: false });
  const { busy, msg, run } = useAction(onAuthError);

  async function add(e) {
    e.preventDefault();
    const r = await run(() => api.addTestcase(p.id, { ...f, points: +f.points }), "Testcase added");
    if (r) { setF({ ...f, inputRef: "", expectedRef: "" }); reload(); onChanged(); }
  }
  async function del(id) {
    if (!confirm("Delete this testcase?")) return;
    await run(() => api.deleteTestcase(p.id, id));
    reload(); onChanged();
  }
  return (
    <div className="body">
      <pre className="stmt">{p.statementMd}</pre>
      <h3>Testcases</h3>
      {tcs && tcs.length === 0 && <Empty>No testcases yet. Submissions cannot be judged until you add one.</Empty>}
      {tcs?.length > 0 && (
        <div className="scroll"><table>
          <thead><tr><th>#</th><th>Input</th><th>Expected</th><th>Points</th><th>Shown to students</th><th /></tr></thead>
          <tbody>{tcs.map((t) => (
            <tr key={t.id}>
              <td>{t.ordinal}</td>
              <td><pre className="cell">{t.input}</pre></td>
              <td><pre className="cell">{t.expected}</pre></td>
              <td>{t.points}</td>
              <td>{t.isSample ? "Sample" : "Hidden"}</td>
              <td><button className="link danger" onClick={() => del(t.id)}>Delete</button></td>
            </tr>))}
          </tbody></table></div>
      )}
      <form className="form" onSubmit={add}>
        <h3>Add a testcase</h3>
        <div className="cols2">
          <label>Input<textarea rows={4} value={f.inputRef} onChange={(e) => setF({ ...f, inputRef: e.target.value })} /></label>
          <label>Expected output<textarea rows={4} value={f.expectedRef} onChange={(e) => setF({ ...f, expectedRef: e.target.value })} required /></label>
        </div>
        <div className="inline">
          <label className="narrow">Points<input type="number" min="0" value={f.points} onChange={(e) => setF({ ...f, points: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={f.isSample} onChange={(e) => setF({ ...f, isSample: e.target.checked })} /> Show to students as a sample</label>
        </div>
        <Msg m={msg} />
        <div><button disabled={busy}>Add testcase</button></div>
      </form>
    </div>
  );
}
