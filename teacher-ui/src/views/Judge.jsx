import * as api from "../api.js";
import { usePoll, Empty, Badge, fmtTime } from "../ui.jsx";

export default function Judge({ onAuthError }) {
  const { data, err } = usePoll(api.judgeStatus, 3000);
  if (err?.status === 401) onAuthError();
  const w = data?.workers || [];
  return (
    <>
      <div className="head"><h2>Judge workers</h2><span className="dim">Updates every 3 seconds</span></div>
      {err && <p className="note err">{err.message}</p>}
      {data && (
        <div className="stats">
          <div><b>{w.filter((x) => x.online).length}</b><span>online</span></div>
          <div><b>{data.queue?.queued ?? 0}</b><span>waiting in queue</span></div>
          <div><b>{data.queue?.running ?? 0}</b><span>being judged</span></div>
        </div>
      )}
      {data && w.length === 0 && <Empty>No worker has connected yet. Start one on the judge machine with start-workers, pointing at this server.</Empty>}
      {w.length > 0 && <div className="scroll"><table>
        <thead><tr><th>Worker</th><th>State</th><th>Host</th><th>Version</th><th className="num">Jobs done</th><th>Last seen</th></tr></thead>
        <tbody>{w.map((x) => <tr key={x.workerId}><td><strong>{x.workerId}</strong></td>
          <td>{x.online ? <Badge status={x.currentJob ? "BUSY" : "ONLINE"} /> : <Badge status="OFFLINE" />}</td>
          <td>{x.host}</td><td>{x.version}</td><td className="num">{x.jobsDone}</td><td>{fmtTime(x.lastSeenAt)}</td></tr>)}</tbody></table></div>}
    </>
  );
}
