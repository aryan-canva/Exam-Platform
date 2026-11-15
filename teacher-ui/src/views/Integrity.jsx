import { useState, useEffect } from "react";
import * as api from "../api.js";
import { usePoll, Badge, Empty, fmtTime } from "../ui.jsx";
import { summarize, listWarning, buildTimeline, payloadText, fmtGap, isSuspicious, HEARTBEAT_TYPE } from "../integrity.js";

/** Server-corrected "now", refreshed with the polls so a wrong teacher-PC clock does not fake gaps. */
function useServerNow() {
  const [off, setOff] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => {
    let stop = false;
    api.clockOffset().then((o) => !stop && setOff(o)).catch(() => {});
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  return () => Date.now() + off;
}

export default function Integrity({ c }) {
  const [sel, setSel] = useState(null);
  const nowFn = useServerNow();
  const live = c.status === "RUNNING";
  const { data, err } = usePoll(() => api.contestSessions(c.id), 5000, live || c.status === "ENDED", [c.id]);
  if (sel) {
    const row = (data || []).find((r) => r.userId === sel);
    return <Timeline row={row} contest={c} nowFn={nowFn} onBack={() => setSel(null)} />;
  }
  if (c.status === "DRAFT" || c.status === "SCHEDULED") return <Empty>Integrity data appears once the exam has started.</Empty>;
  if (err) return <p className="note err">{err.message}</p>;
  if (!data) return <p className="dim">Loading…</p>;
  if (!data.length) return <Empty>No enrolled students.</Empty>;
  const now = nowFn();
  const rows = data.map((r) => ({ r, warn: listWarning(r, now) }))
    .sort((a, b) => !!b.warn - !!a.warn || b.r.suspicious - a.r.suspicious || a.r.username.localeCompare(b.r.username));
  const flagged = rows.filter((x) => x.warn).length;
  return (
    <>
      {flagged > 0 && <p className="note err" role="alert">{flagged} student{flagged > 1 ? "s" : ""} with no watchdog heartbeat for over 2 minutes.</p>}
      <div className="scroll"><table className="click">
        <thead><tr><th>Student</th><th>Session</th><th className="num">Events</th><th className="num">Suspicious</th><th>Last heartbeat</th><th>Warning</th></tr></thead>
        <tbody>{rows.map(({ r, warn }) => (
          <tr key={r.userId} className={warn ? "warnrow" : ""} tabIndex={r.sessionId ? 0 : -1}
            onClick={() => r.sessionId && setSel(r.userId)} onKeyDown={(e) => e.key === "Enter" && r.sessionId && setSel(r.userId)}>
            <td>{r.fullName || r.username} <span className="dim">{r.username}</span></td>
            <td>{r.status === "NOT_STARTED" ? <span className="dim">Not started</span> : <Badge status={r.status} />}</td>
            <td className="num">{r.events}</td>
            <td className={"num" + (r.suspicious ? " sus" : " dim")}>{r.suspicious}</td>
            <td>{r.lastWdHeartbeatAt ? fmtTime(r.lastWdHeartbeatAt) : <span className="dim">—</span>}</td>
            <td>{warn ? <span className="gapflag">⚠ {warn.text}</span> : <span className="dim">—</span>}</td>
          </tr>))}
        </tbody></table></div>
      <p className="dim">Counted as suspicious: paste, focus lost, tab switch, screenshot attempt, blocked process, kiosk exit attempt, app exited. Click a student for the timeline.</p>
    </>
  );
}

function Timeline({ row, contest, nowFn, onBack }) {
  const { data: events, err } = usePoll(() => api.sessionEvents(row.sessionId), 5000, !!row?.sessionId, [row?.sessionId, row?.events]);
  const [hideBeats, setHideBeats] = useState(true);
  const [only, setOnly] = useState(false);
  if (!row) return <><button className="link" onClick={onBack}>← All students</button><p className="dim">Loading…</p></>;
  const now = nowFn();
  const sum = events ? summarize(events, row, now) : null;
  const rows = events ? buildTimeline(events, sum.gaps, { hideHeartbeats: hideBeats, onlySuspicious: only }) : [];
  return (
    <>
      <button className="link" onClick={onBack}>← All students</button>
      <div className="head"><div>
        <h3>{row.fullName || row.username} <Badge status={row.status} /></h3>
        <p className="dim">{contest.title} · session started {fmtTime(row.startedAt)}{row.endedAt && <> · ended {fmtTime(row.endedAt)}</>}</p>
      </div></div>
      {err && <p className="note err">{err.message}</p>}
      {!events && !err && <p className="dim">Loading…</p>}
      {sum && (
        <>
          {sum.openGap && <p className="note err" role="alert">⚠ No watchdog heartbeat for {fmtGap(sum.openGap.sec)}. The watchdog may have been stopped, or the machine is offline.</p>}
          <div className="stats">
            <div><strong>{sum.total}</strong><span className="dim">events</span></div>
            <div className={sum.suspicious ? "sus" : ""}><strong>{sum.suspicious}</strong><span className="dim">suspicious</span></div>
            <div className={sum.gaps.length ? "sus" : ""}><strong>{sum.gaps.length}</strong><span className="dim">heartbeat gaps</span></div>
          </div>
          <div className="inline">
            <label className="check"><input type="checkbox" checked={hideBeats} disabled={only} onChange={(e) => setHideBeats(e.target.checked)} /> Hide heartbeats</label>
            <label className="check"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Suspicious only</label>
          </div>
          {rows.length === 0 && <Empty>{only ? "No suspicious events." : "No events yet."}</Empty>}
          {rows.length > 0 && <ol className="timeline">{rows.map((x) => x.kind === "gap"
            ? <li key={"g" + x.at} className="gapitem"><span className="when">{fmtTime(new Date(x.g.from).toISOString())}</span>
                <span>⚠ No heartbeat for {fmtGap(x.g.sec)}{x.g.open ? " (still ongoing)" : ""}</span></li>
            : <li key={x.e.seq} className={isSuspicious(x.e.type) ? "susitem" : ""}>
                <span className="when">{fmtTime(x.e.ts)}</span>
                <span className="etype">{x.e.type}</span>
                {x.e.severity && x.e.severity !== "INFO" && <Badge status={x.e.severity} />}
                <span className="dim">{x.e.type === HEARTBEAT_TYPE ? "" : payloadText(x.e.payloadJson)}</span>
              </li>)}</ol>}
        </>
      )}
    </>
  );
}
