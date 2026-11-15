import { useState } from "react";
import * as api from "../api.js";
import { useLoad, useAction, Msg, Empty } from "../ui.jsx";

const SAMPLE = "username,password,fullName,studentRef\nasha01,Passw0rd!,Asha Verma,CS21-014\nravi02,Passw0rd!,Ravi Nair,CS21-027";

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length && /^username\b/i.test(lines[0])) lines.shift();
  return lines.map((l) => { const [username, password, fullName, studentRef] = l.split(",").map((x) => x?.trim()); return { username, password, fullName: fullName || username, studentRef: studentRef || "" }; });
}

export default function Students({ onAuthError }) {
  const { data: students, err, reload } = useLoad(api.listStudents);
  const [csv, setCsv] = useState("");
  const [report, setReport] = useState(null);
  const [q, setQ] = useState("");
  const add = useAction(onAuthError), pw = useAction(onAuthError);
  if (err?.status === 401) onAuthError();

  async function submit(e) {
    e.preventDefault();
    const rows = parseCsv(csv);
    const bad = rows.find((r) => !r.username || !r.password);
    if (!rows.length || bad) return add.setMsg({ ok: false, text: "Each line needs at least a username and a password." });
    const r = await add.run(() => api.bulkStudents(rows));
    if (r) { setReport(r); setCsv(""); add.setMsg(null); reload(); }
  }
  async function reset(s) {
    const p = prompt(`New password for ${s.username} (min 8 characters):`);
    if (p) await pw.run(() => api.resetPassword(s.id, p), `Password changed for ${s.username}`);
  }
  const shown = (students || []).filter((s) => (s.username + " " + (s.fullName || "") + " " + (s.studentRef || "")).toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <div className="head"><h2>Students</h2></div>
      <form className="panel form" onSubmit={submit}>
        <h3>Add students</h3>
        <p className="dim">One student per line: username, password, full name, student ID. Existing usernames are skipped.</p>
        <textarea rows={5} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={SAMPLE} spellCheck={false} />
        <Msg m={add.msg} />
        {report && <div className="note ok">Created {report.created.length}.
          {report.skipped.length > 0 && <> Skipped {report.skipped.length}: {report.skipped.map((s) => `${s.username} (${s.reason})`).join(", ")}.</>}</div>}
        <div><button disabled={add.busy || !csv.trim()}>Add students</button></div>
      </form>
      <div className="head"><h3>All students {students && `(${students.length})`}</h3>
        <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search students" /></div>
      <Msg m={pw.msg} />
      {students && students.length === 0 && <Empty>No students yet.</Empty>}
      {shown.length > 0 && <div className="scroll"><table>
        <thead><tr><th>Name</th><th>Username</th><th>Student ID</th><th /></tr></thead>
        <tbody>{shown.map((s) => <tr key={s.id}><td>{s.fullName}</td><td>{s.username}</td><td>{s.studentRef}</td>
          <td><button className="link" onClick={() => reset(s)}>Reset password</button></td></tr>)}</tbody></table></div>}
    </>
  );
}
