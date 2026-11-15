import * as api from "./api.js";
import { renderMd, esc } from "./md.js";
import { LANGS, TEMPLATES, VERDICT } from "./templates.js";
import { createEditor } from "./editor.js";

const root = document.getElementById("app");
const S = { cfg: {}, user: null, creds: null, exam: null, poll: null };
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toMs = (v) => (typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Date.parse(v));
const clock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":"); };
const fmtDur = (sec) => { const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? `${h} h${m ? " " + m + " min" : ""}` : `${m} min`; };

let toastTimer;
function toast(msg, kind = "") {
  const t = $("#toast"); t.textContent = msg; t.className = "show " + kind;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ""), 4000);
}
function modal(title, body, buttons) {
  return new Promise((resolve) => {
    const d = document.createElement("div"); d.className = "overlay";
    d.innerHTML = `<div class="dialog" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><p>${esc(body)}</p><div class="btns"></div></div>`;
    buttons.forEach((b) => {
      const el = document.createElement("button"); el.textContent = b.label; el.className = b.cls || "";
      el.onclick = () => { d.remove(); resolve(b.value); }; $(".btns", d).appendChild(el);
    });
    document.body.appendChild(d); $(".btns button:last-child", d).focus();
  });
}

// ───────────────────────── boot ─────────────────────────
(async function boot() {
  S.cfg = await window.native.getConfig();
  api.setOnToken((t) => window.native.wdToken?.(t));
  api.setReauth(async () => (S.creds ? (await api.login(S.creds.u, S.creds.p)).accessToken : null));
  window.native.onFocus((on) => onFocus(on));
  setupClipboardPolicy();
  if (S.cfg.serverUrl) {
    api.setBase(S.cfg.serverUrl);
    try { await api.ping(); return loginScreen(); } catch (e) { return connectScreen(e.message); }
  }
  connectScreen();
})();

// ───────────────────────── connect ─────────────────────────
function connectScreen(err) {
  root.innerHTML = `<div class="center"><form class="card" id="f">
    <h1>Exam Client</h1><p class="dim">Enter the address your teacher gave you.</p>
    <label>Server address<input id="url" value="${esc(S.cfg.serverUrl || "")}" placeholder="http://192.168.1.50:8080" autofocus required></label>
    <p class="err" id="msg">${esc(err || "")}</p>
    <button id="go">Connect</button>
    ${S.cfg.windowed ? "" : `<button type="button" class="link" id="quit">Exit</button>`}
  </form></div>`;
  $("#quit")?.addEventListener("click", () => window.native.quit());
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    let u = $("#url").value.trim(); if (u && !/^https?:\/\//i.test(u)) u = "http://" + u;
    const btn = $("#go"); btn.disabled = true; btn.textContent = "Connecting…"; $("#msg").textContent = "";
    api.setBase(u);
    try { await api.ping(); S.cfg = { ...S.cfg, ...(await window.native.setConfig({ serverUrl: api.getBase() })) }; loginScreen(); }
    catch (er) { $("#msg").textContent = er.message + " Check the address and that you are on the right network."; btn.disabled = false; btn.textContent = "Connect"; }
  };
}

// ───────────────────────── login ─────────────────────────
function loginScreen(err) {
  root.innerHTML = `<div class="center"><form class="card" id="f">
    <h1>Sign in</h1><p class="dim">Connected to ${esc(api.getBase())}</p>
    <label>Username<input id="u" autocomplete="username" autofocus required></label>
    <label>Password<input id="p" type="password" autocomplete="current-password" required></label>
    <p class="err" id="msg">${esc(err || "")}</p>
    <button id="go">Sign in</button>
    <button type="button" class="link" id="chg">Change server</button>
  </form></div>`;
  $("#chg").onclick = () => connectScreen();
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const u = $("#u").value.trim(), p = $("#p").value;
    const btn = $("#go"); btn.disabled = true; btn.textContent = "Signing in…";
    try {
      const r = await api.login(u, p);
      if (r.user.role !== "STUDENT") throw new api.ApiError(403, "This app is for students. Teachers use the web console.");
      api.setToken(r.accessToken); S.user = r.user; S.creds = { u, p };
      contestsScreen();
    } catch (er) { $("#msg").textContent = er.status === 401 ? "Wrong username or password." : er.message; btn.disabled = false; btn.textContent = "Sign in"; }
  };
}
function logout() { clearInterval(S.poll); api.setToken(null); S.user = null; S.creds = null; loginScreen(); }

// ───────────────────────── contest list ─────────────────────────
async function contestsScreen() {
  clearInterval(S.poll);
  root.innerHTML = `<div class="page"><header class="top"><h2>Your exams</h2><div class="grow"></div>
    <span class="dim">${esc(S.user.fullName || S.user.username)}</span>
    <button class="ghost" id="out">Sign out</button>${S.cfg.windowed ? "" : `<button class="ghost" id="quit">Exit</button>`}</header>
    <div id="list" class="list"><p class="dim">Loading…</p></div></div>`;
  $("#out").onclick = logout; $("#quit")?.addEventListener("click", () => window.native.quit());
  const load = async () => {
    try {
      const cs = await api.myContests();
      await api.ping().catch(() => {});
      $("#list").innerHTML = cs.length ? cs.map(contestCard).join("") : `<p class="empty">No exams are assigned to you yet.</p>`;
      document.querySelectorAll("[data-enter]").forEach((b) => (b.onclick = () => enterExam(cs.find((c) => c.id === b.dataset.enter))));
    } catch (e) { const l = $("#list"); if (l) l.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  await load(); S.poll = setInterval(load, 5000);
}
function contestCard(c) {
  const st = { RUNNING: ["Live", "live"], SCHEDULED: ["Not started", "wait"], ENDED: ["Finished", "done"] }[c.status] || [c.status, ""];
  const action = c.status === "RUNNING" ? `<button data-enter="${esc(c.id)}">Start / resume</button>`
    : c.status === "SCHEDULED" ? `<span class="dim">Waiting for your teacher to start it. This page updates by itself.</span>`
    : `<span class="dim">This exam has ended.</span>`;
  return `<div class="contest"><div><h3>${esc(c.title)} <span class="pill ${st[1]}">${st[0]}</span></h3>
    <p class="dim">${fmtDur(c.durationSec)} · ${c.problemCount} problem${c.problemCount === 1 ? "" : "s"}</p></div><div>${action}</div></div>`;
}

// ───────────────────────── exam ─────────────────────────
async function enterExam(c) {
  clearInterval(S.poll);
  root.innerHTML = `<div class="center"><p class="dim">Preparing your exam…</p></div>`;
  try {
    const session = await api.startSession(c.id, await window.native.deviceId(), S.cfg.version || "0");
    const detail = await api.contest(c.id);
    const problems = await Promise.all([...detail.problems].sort((a, b) => a.label.localeCompare(b.label)).map(async (p) => {
      const v = await api.problem(p.id, c.id);
      return { id: p.id, label: p.label, title: p.title, points: p.points, statementMd: v.statementMd, samples: v.sampleTestcases || [], timeLimitMs: v.timeLimitMs, memoryLimitKb: v.memoryLimitKb };
    }));
    const endsAt = toMs(detail.endsAt || c.endsAt);
    S.exam = { c, session, problems, cur: 0, lang: {}, subs: [], seq: 0, endsAt, focusLost: 0, runBusy: false, subBusy: false, over: false, editor: null, timers: [], offline: false };
    await api.ping().catch(() => {});
    // Integrity watchdog (Linux build): must be up before the kiosk locks the screen.
    const wd = (await window.native.wdStart?.({ sessionId: session.id, serverUrl: api.getBase(), token: api.getToken() })) || { supported: false };
    S.exam.wd = wd.ok === true;
    if (!wd.ok && S.cfg.requireWatchdog && wd.supported !== false) throw new Error("The integrity monitor could not start (" + (wd.error || "unknown") + "). Ask the invigilator for help.");
    await window.native.setExamMode(true);
    await renderExam();
  } catch (e) {
    await modal("Cannot open the exam", e.message, [{ label: "Back", value: 1 }]);
    contestsScreen();
  }
}

// Languages the teacher allowed for this exam (all four if the server does not say).
const langsOf = (x) => { const a = x.c.languages; const f = Array.isArray(a) && a.length ? LANGS.filter((l) => a.includes(l.id)) : LANGS; return f.length ? f : LANGS; };
const draftKey = (x, p, l) => `draft:${S.user.id}:${x.c.id}:${p.id}:${l}`;
const langKey = (x, p) => `lang:${S.user.id}:${x.c.id}:${p.id}`;

async function renderExam() {
  const x = S.exam;
  root.innerHTML = `<div class="exam">
    <header class="bar"><div class="title">${esc(x.c.title)}</div>
      <nav class="ptabs" id="ptabs"></nav><div class="grow"></div>
      <span class="warn" id="conn" hidden>Connection problem. Retrying…</span>
      <span class="warn" id="focus" hidden></span><span class="warn" id="wd" hidden></span>
      <div class="timer" id="timer" aria-label="Time remaining">--:--:--</div>
      <button class="ghost" id="finish">Finish exam</button></header>
    <div class="split">
      <section class="left"><div class="tabs"><button class="on" data-l="prob">Problem</button><button data-l="subs">My submissions</button></div>
        <div id="lp" class="scrollpane"></div></section>
      <section class="right">
        <div class="toolbar"><select id="lang" aria-label="Language">${langsOf(x).map((l) => `<option value="${l.id}">${l.label}</option>`).join("")}</select>
          <button class="ghost sm" id="reset">Reset code</button><div class="grow"></div>
          <button class="ghost" id="run">Run</button><button id="submit">Submit</button></div>
        <div id="ed" class="editor"></div>
        <div class="console"><div class="tabs"><button class="on" data-c="in">Custom input</button><button data-c="out">Run output</button><button data-c="res">Submission result</button></div>
          <div class="cbody"><textarea id="stdin" spellcheck="false" placeholder="Type input here, then press Run"></textarea>
            <pre id="out" hidden></pre><div id="res" hidden></div></div></div>
      </section></div></div>`;

  $("#finish").onclick = async () => {
    if (await modal("Finish the exam?", "You will not be able to come back to it. Make sure you have submitted your final solutions.", [{ label: "Keep working", value: false }, { label: "Finish exam", value: true, cls: "danger" }])) finishExam("finished");
  };
  $("#lang").onchange = (e) => switchLang(e.target.value);
  $("#reset").onclick = async () => { if (await modal("Reset code?", "Your code for this problem and language will be replaced by the starting template.", [{ label: "Cancel", value: false }, { label: "Reset", value: true, cls: "danger" }])) { const p = x.problems[x.cur], l = x.lang[p.id]; localStorage.removeItem(draftKey(x, p, l)); x.editor.setValue(TEMPLATES[l]); } };
  $("#run").onclick = doRun; $("#submit").onclick = doSubmit;
  document.querySelectorAll(".left .tabs button").forEach((b) => (b.onclick = () => { document.querySelectorAll(".left .tabs button").forEach((o) => o.classList.toggle("on", o === b)); x.leftTab = b.dataset.l; drawLeft(); }));
  document.querySelectorAll(".console .tabs button").forEach((b) => (b.onclick = () => showConsole(b.dataset.c)));
  x.leftTab = "prob";

  x.editor = await createEditor($("#ed"), { onChange: saveDraft });
  await refreshSubs();
  switchProblem(0, true);
  x.timers.push(setInterval(tick, 500), setInterval(heartbeat, 10000));
  tick(); heartbeat();
}

function drawTabs() {
  const x = S.exam;
  $("#ptabs").innerHTML = x.problems.map((p, i) => {
    const ok = x.subs.some((s) => s.problemId === p.id && s.verdict === "AC");
    return `<button class="${i === x.cur ? "on" : ""}" data-i="${i}" title="${esc(p.title)}">${esc(p.label)}${ok ? ' <span class="tick">✓</span>' : ""}</button>`;
  }).join("");
  document.querySelectorAll("#ptabs button").forEach((b) => (b.onclick = () => switchProblem(+b.dataset.i)));
}
function drawLeft() {
  const x = S.exam, p = x.problems[x.cur], lp = $("#lp");
  if (x.leftTab === "subs") {
    const rows = x.subs.map((s) => { const pr = x.problems.find((q) => q.id === s.problemId);
      return `<tr><td>${new Date(toMs(s.createdAt)).toLocaleTimeString()}</td><td>${esc(pr?.label || "?")}</td><td>${esc(s.language)}</td><td>${s.verdict ? `<span class="v v-${esc(s.verdict)}">${esc(VERDICT[s.verdict] || s.verdict)}</span>` : "Judging…"}</td><td class="num">${s.score ?? "–"}</td></tr>`; }).join("");
    lp.innerHTML = rows ? `<table class="subs"><thead><tr><th>Time</th><th>Problem</th><th>Language</th><th>Result</th><th class="num">Score</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="empty">You have not submitted anything yet.</p>`;
    return;
  }
  lp.innerHTML = `<div class="stmt"><h2>${esc(p.label)}. ${esc(p.title)}</h2>
    <p class="meta">${p.points} points · time limit ${(p.timeLimitMs / 1000).toFixed(p.timeLimitMs % 1000 ? 1 : 0)} s · memory ${Math.round(p.memoryLimitKb / 1024)} MB</p>
    ${renderMd(p.statementMd)}
    ${p.samples.map((s, i) => `<h4>Sample ${i + 1}</h4><div class="sample"><div><span>Input</span><pre>${esc(s.inputRef)}</pre></div><div><span>Output</span><pre>${esc(s.expectedRef)}</pre></div></div>`).join("")}</div>`;
}

function switchProblem(i, first) {
  const x = S.exam;
  if (!first) saveDraft();
  x.cur = i; const p = x.problems[i];
  const ok = langsOf(x).map((q) => q.id);
  const want = x.lang[p.id] || localStorage.getItem(langKey(x, p));
  x.lang[p.id] = ok.includes(want) ? want : ok.includes("CPP") ? "CPP" : ok[0];
  drawTabs(); drawLeft(); loadCode();
}
function loadCode() {
  const x = S.exam, p = x.problems[x.cur], l = x.lang[p.id];
  $("#lang").value = l;
  x.editor.setLanguage(LANGS.find((q) => q.id === l).monaco);
  x.loading = true;
  x.editor.setValue(localStorage.getItem(draftKey(x, p, l)) ?? TEMPLATES[l]);
  x.loading = false;
  if (!x.over) x.editor.focus();
}
function switchLang(l) {
  const x = S.exam, p = x.problems[x.cur];
  saveDraft(); x.lang[p.id] = l; localStorage.setItem(langKey(x, p), l); loadCode();
}
let saveT;
function saveDraft() {
  const x = S.exam; if (!x || !x.editor || x.loading) return;
  clearTimeout(saveT);
  const p = x.problems[x.cur], l = x.lang[p.id], v = x.editor.getValue();
  saveT = setTimeout(() => localStorage.setItem(draftKey(x, p, l), v), 300);
  localStorage.setItem(draftKey(x, p, l), v);
}
function showConsole(which) {
  document.querySelectorAll(".console .tabs button").forEach((b) => b.classList.toggle("on", b.dataset.c === which));
  $("#stdin").hidden = which !== "in"; $("#out").hidden = which !== "out"; $("#res").hidden = which !== "res";
}

// Run with custom input
async function doRun() {
  const x = S.exam; if (x.runBusy || x.over) return;
  const p = x.problems[x.cur], lang = x.lang[p.id], code = x.editor.getValue();
  x.runBusy = true; $("#run").disabled = true; $("#run").textContent = "Running…";
  showConsole("out"); const out = $("#out"); out.className = ""; out.textContent = "Queued…";
  try {
    // Empty custom input -> use the problem's first sample input (custom input always wins when typed).
    const typed = $("#stdin").value;
    const sample = !typed.trim() && p.samples && p.samples[0] ? p.samples[0] : null;
    const { id } = await api.run(lang, code, sample ? sample.inputRef : typed, p.id);
    let r = null;
    for (let i = 0; i < 90 && !x.over; i++) {
      await sleep(i < 5 ? 500 : 1000);
      const g = await api.getRun(id);
      if (g.status === "RUNNING") out.textContent = "Running…";
      if (g.status === "DONE") { r = g.result || {}; break; }
    }
    if (!r) throw new Error("No result from the judge. Try again; if it keeps happening tell your teacher.");
    renderRun(r);
    if (sample) {
      const note = `[No custom input given: ran the sample input]\n${sample.inputRef}\n[Expected output: ${String(sample.expectedRef).trim()}]\n\n`;
      out.textContent = note + out.textContent;
    }
  } catch (e) { out.className = "bad"; out.textContent = e.message; }
  finally { x.runBusy = false; $("#run").disabled = false; $("#run").textContent = "Run"; }
}
function renderRun(r) {
  const out = $("#out"); const v = r.verdict || "OK";
  const head = `${VERDICT[v] || v}${r.timeMs ? ` · ${r.timeMs} ms` : ""}${v === "RE" && r.exitCode != null ? ` · exit code ${r.exitCode}` : ""}`;
  const body = v === "CE" ? (r.compile?.output || r.stderr || "") : [r.stdout, r.stderr ? "\n--- stderr ---\n" + r.stderr : ""].join("");
  out.className = v === "OK" ? "" : "bad";
  out.textContent = `${head}\n\n${body || "(no output)"}`;
}

// Submit
async function doSubmit() {
  const x = S.exam; if (x.subBusy || x.over) return;
  const p = x.problems[x.cur], lang = x.lang[p.id], code = x.editor.getValue();
  if (!code.trim()) return toast("The editor is empty.", "bad");
  x.subBusy = true; $("#submit").disabled = true; $("#submit").textContent = "Judging…";
  showConsole("res"); const res = $("#res"); res.innerHTML = `<p class="dim">Submitted. Waiting for the judge…</p>`;
  try {
    const { id } = await api.submit({ sessionId: x.session.id, contestId: x.c.id, problemId: p.id, language: lang, sourceCode: code });
    let d = null;
    for (let i = 0; i < 150; i++) {
      await sleep(i < 5 ? 600 : 1200);
      const g = await api.getSubmission(id);
      if (g.status === "DONE" || g.status === "ERROR") { d = g; break; }
      res.innerHTML = `<p class="dim">${g.status === "RUNNING" ? "Judging…" : "In queue…"}</p>`;
    }
    if (!d) throw new Error("Judging is taking longer than expected. Check “My submissions” in a minute.");
    renderSubmission(d, p);
  } catch (e) { res.innerHTML = `<p class="bad">${esc(e.message)}</p>`; }
  finally { x.subBusy = false; $("#submit").disabled = x.over; $("#submit").textContent = "Submit"; await refreshSubs().catch(() => {}); }
}
function renderSubmission(d, p) {
  const v = d.verdict || "IE";
  const tests = (d.tests || []).map((t) => `<li class="${t.verdict === "AC" ? "pass" : "fail"}"><span>Test ${t.ordinal}${t.isSample ? " (sample)" : ""}</span><span>${t.verdict === "AC" ? "Passed" : esc(VERDICT[t.verdict] || t.verdict)}</span><span class="dim">${t.timeMs ?? 0} ms</span></li>`).join("");
  $("#res").innerHTML = `<div class="verdict v-${esc(v)}"><strong>${esc(VERDICT[v] || v)}</strong><span>Score ${d.score ?? 0} / ${p.points}</span></div>
    ${v === "CE" && d.compileOutput ? `<pre class="bad">${esc(d.compileOutput)}</pre>` : ""}${tests ? `<ul class="tests">${tests}</ul>` : ""}`;
}
async function refreshSubs() {
  const x = S.exam; x.subs = (await api.mySubmissions(x.c.id)).sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
  drawTabs(); if (x.leftTab === "subs") drawLeft();
}

// Timer, heartbeat, focus
function tick() {
  const x = S.exam; if (!x || x.over) return;
  const rem = x.endsAt - api.serverNow(), t = $("#timer");
  t.textContent = clock(rem); t.classList.toggle("low", rem < 5 * 60000);
  if (rem <= 60000 && !x.warned1) { x.warned1 = true; toast("One minute left. Submit your solutions now.", "bad"); }
  else if (rem <= 5 * 60000 && !x.warned5) { x.warned5 = true; toast("Five minutes left.", "bad"); }
  if (rem <= 0) finishExam("time");
}
async function heartbeat() {
  const x = S.exam; if (!x || x.over) return;
  try {
    const r = await api.heartbeat(x.session.id, ++x.seq);
    $("#conn").hidden = true;
    if (r && r.status && r.status !== "ACTIVE") finishExam("ended");
    if (x.wd) { const h = await window.native.wdHealth?.(); const w = $("#wd"); if (w) { w.hidden = !!(h && h.ok); w.textContent = "Integrity monitor offline: reconnecting"; } }
  } catch (e) {
    if (e.status === 409 || e.status === 403) return finishExam("ended");
    if (!x.over) $("#conn").hidden = false;
  }
}
function onFocus(on) {
  const x = S.exam; if (!x || x.over) return;
  if (!on) { x.focusLost++; const f = $("#focus"); f.hidden = false; f.textContent = `Left exam window ×${x.focusLost}`; }
  else toast("Stay in the exam window. Leaving it is recorded.", "bad");
}
document.addEventListener("visibilitychange", () => { if (document.hidden) onFocus(false); });

// Only text copied inside this app can be pasted.
let lastCopied = "";
function setupClipboardPolicy() {
  const grab = () => {
    const x = S.exam; let t = x?.editor?.getSelectedText?.() || "";
    if (!t) { const a = document.activeElement; t = a && "selectionStart" in a && a.value != null ? a.value.substring(a.selectionStart, a.selectionEnd) : ""; }
    if (!t) t = String(window.getSelection());
    if (t) lastCopied = t;
  };
  document.addEventListener("copy", grab, true); document.addEventListener("cut", grab, true);
  document.addEventListener("paste", (e) => {
    if (!S.exam || S.exam.over) return;
    const t = e.clipboardData?.getData("text/plain") ?? "";
    if (t !== lastCopied) { e.preventDefault(); e.stopImmediatePropagation(); toast("Pasting text from outside the exam is disabled.", "bad"); window.native.wdEvent?.("PASTE", { blocked: true, chars: t.length }); }
  }, true);
  document.addEventListener("drop", (e) => e.preventDefault(), true);
  document.addEventListener("dragover", (e) => e.preventDefault(), true);
}

// Finish
async function finishExam(reason) {
  const x = S.exam; if (!x || x.over) return;
  x.over = true; x.timers.forEach(clearInterval); x.editor?.setReadOnly(true);
  saveDraft();
  if (x.wd) await window.native.wdFlush?.(); // events must reach the server while the session is still ACTIVE
  api.endSession(x.session.id).catch(() => {});
  if (x.wd) window.native.wdEnd?.(reason);
  await window.native.setExamMode(false);
  let subs = x.subs; try { subs = await api.mySubmissions(x.c.id); } catch { /* keep cached */ }
  const best = (p) => subs.filter((s) => s.problemId === p.id).reduce((m, s) => Math.max(m, s.score || 0), 0);
  const msg = reason === "time" ? "Time is up." : reason === "ended" ? "Your teacher has ended this exam." : "You have finished the exam.";
  const total = x.problems.reduce((a, p) => a + best(p), 0);
  root.innerHTML = `<div class="center"><div class="card wide"><h1>${msg}</h1><p class="dim">${esc(x.c.title)}</p>
    <table class="subs"><thead><tr><th>Problem</th><th class="num">Best score</th></tr></thead><tbody>
    ${x.problems.map((p) => `<tr><td>${esc(p.label)}. ${esc(p.title)}</td><td class="num">${best(p)} / ${p.points}</td></tr>`).join("")}
    <tr><td><strong>Total</strong></td><td class="num"><strong>${total}</strong></td></tr></tbody></table>
    <p class="dim">Scores shown are from your submissions so far. Your teacher publishes final results.</p>
    <div class="row"><button id="back">Back to exams</button>${S.cfg.windowed ? "" : `<button class="ghost" id="quit">Exit</button>`}</div></div></div>`;
  S.exam = null;
  $("#back").onclick = contestsScreen; $("#quit")?.addEventListener("click", () => window.native.quit());
}
