import { useState, useEffect, useCallback, useRef } from "react";

/** Load data once and on demand. Returns {data, err, loading, reload}. */
export function useLoad(fn, deps = []) {
  const [state, set] = useState({ data: null, err: null, loading: true });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const reload = useCallback(() => {
    set((s) => ({ ...s, loading: true }));
    return fn()
      .then((data) => alive.current && set({ data, err: null, loading: false }))
      .catch((err) => alive.current && set((s) => ({ data: s.data, err, loading: false })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

/** Re-run `fn` every `ms` while `active` (quietly, no loading flicker). */
export function usePoll(fn, ms, active = true, deps = []) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const tick = () => fn().then((d) => !stop && (setData(d), setErr(null))).catch((e) => !stop && setErr(e));
    tick();
    const t = setInterval(tick, ms);
    return () => { stop = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ms, ...deps]);
  return { data, err };
}

export function Msg({ m }) {
  if (!m) return null;
  return <p className={m.ok ? "note ok" : "note err"} role="status">{m.text}</p>;
}

export function Badge({ status }) {
  return <span className={`badge b-${String(status).toLowerCase()}`}>{status}</span>;
}

export function Empty({ children }) {
  return <p className="empty">{children}</p>;
}

export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString() : "—");
export const fmtDur = (sec) => {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m ? m + "m" : ""}`.trim() : `${m}m`;
};

/** Run an async action with busy + message handling. */
export function useAction(onAuthError) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const run = useCallback(async (fn, okText) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fn();
      if (okText) setMsg({ ok: true, text: typeof okText === "function" ? okText(r) : okText });
      return r;
    } catch (e) {
      if (e.status === 401) onAuthError?.();
      setMsg({ ok: false, text: e.message });
      return undefined;
    } finally { setBusy(false); }
  }, [onAuthError]);
  return { busy, msg, setMsg, run };
}
