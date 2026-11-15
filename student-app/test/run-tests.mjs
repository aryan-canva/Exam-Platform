// Drives the real renderer in headless Chromium against the mock server (Electron itself is replaced by a small window.native shim).
// Needs playwright + chromium; set NODE_PATH or PLAYWRIGHT_MODULE to find them.
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { startMock } from "./mock-server.mjs";
const pw = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const here = path.dirname(fileURLToPath(import.meta.url)), rdir = path.join(here, "..", "renderer");
const API = await startMock(18090);
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" };
const web = http.createServer((q, r) => {
  const f = path.join(rdir, q.url === "/" ? "index.html" : q.url.split("?")[0]);
  if (!f.startsWith(rdir) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  let body = fs.readFileSync(f); if (f.endsWith(".html")) body = body.toString().replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "");
  r.writeHead(200, { "Content-Type": types[path.extname(f)] || "text/plain" }); r.end(body);
}).listen(18091);

const shim = `window.__log=[];window.native={getConfig:async()=>({serverUrl:"",windowed:true,version:"0.1.0"}),setConfig:async p=>p,deviceId:async()=>"dev123",
 setExamMode:async on=>{window.__log.push("kiosk:"+on)},quit:async()=>{},onFocus:cb=>{window.__focus=cb},
 http:async({method,url,headers,body})=>{try{const r=await fetch(url,{method,headers,body});return{status:r.status,text:await r.text()}}catch(e){return{status:0,error:"ECONNREFUSED"}}}};`;

const b = await pw.chromium.launch(); const p = await b.newPage({ viewport: { width: 1300, height: 820 } });
await p.addInitScript(shim);
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
let failed = 0;
const step = async (n, fn) => { try { await fn(); console.log("ok  ", n); } catch (e) { failed++; console.log("FAIL", n, "-", e.message.split("\n")[0]); await p.screenshot({ path: "/tmp/student-fail.png" }); } };
const ex = (sel) => p.waitForSelector(sel, { timeout: 8000 });

await p.goto("http://localhost:18091/");
await step("connect rejects a dead address", async () => { await p.fill("#url", "localhost:1"); await p.click("#go"); await ex("text=Cannot reach the server"); });
await step("connect + login failure + login", async () => { await p.fill("#url", "http://localhost:18090"); await p.click("#go"); await ex("h1:has-text('Sign in')");
  await p.fill("#u", "student1"); await p.fill("#p", "nope"); await p.click("#go"); await ex("text=Wrong username or password");
  await p.fill("#p", "studentpass"); await p.click("#go"); await ex("text=Your exams"); });
await step("contest list states", async () => { await ex(".contest:has-text('Midterm Exam') button:has-text('Start')"); await ex(".contest:has-text('Not started')"); });
await step("enter exam: kiosk on, statement, samples, timer", async () => { await p.click(".contest:has-text('Midterm Exam') button");
  await ex("h2:has-text('A. Sum of two numbers')"); await ex(".sample pre:has-text('1 2')"); await ex("strong:has-text('two integers')");
  if (!(await p.evaluate(() => window.__log.includes("kiosk:true")))) throw new Error("kiosk not enabled");
  const t = await p.textContent("#timer"); if (!/^00:5\d:\d\d$|^01:00:00$/.test(t)) throw new Error("timer " + t); });
await step("code draft kept per problem and language", async () => { await p.fill(".plain-editor", "// draft A cpp"); await p.click("#ptabs button:nth-child(2)"); await ex("h2:has-text('B. Reverse')");
  if ((await p.inputValue(".plain-editor")).includes("draft A")) throw new Error("draft leaked");
  await p.click("#ptabs button:nth-child(1)"); if ((await p.inputValue(".plain-editor")) !== "// draft A cpp") throw new Error("draft lost");
  await p.selectOption("#lang", "PYTHON"); if (!(await p.inputValue(".plain-editor")).includes("sys.stdin")) throw new Error("python template missing");
  await p.selectOption("#lang", "CPP"); if ((await p.inputValue(".plain-editor")) !== "// draft A cpp") throw new Error("cpp draft lost"); });
await step("run with empty input uses the problem's sample input", async () => { await p.fill("#stdin", ""); await p.click("#run"); await ex("#out:has-text('echo:1 2')"); await ex("#out:has-text('Expected output: 3')"); await ex("#out:has-text('ran the sample input')"); });
await step("run with custom input", async () => { await p.click("[data-c=in]"); await p.fill("#stdin", "hello"); await p.click("#run"); await ex("#out:has-text('echo:hello')"); await ex("#out:has-text('Ran successfully')"); });
await p.screenshot({ path: "/tmp/student-exam.png" });
await step("run compile error", async () => { await p.fill(".plain-editor", "SYNTAXERR"); await p.click("#run"); await ex("#out:has-text(\"expected ';'\")"); await ex("#out.bad"); });
await step("submit accepted -> tick + submissions tab", async () => { await p.fill(".plain-editor", "int main(){}"); await p.click("#submit");
  await ex(".verdict.v-AC"); await ex(".tests li:has-text('Test 2')"); await ex("#ptabs .tick"); await p.click(".left .tabs button:has-text('My submissions')"); await ex("td:has-text('Accepted')"); await p.click(".left .tabs button:has-text('Problem')"); });
await step("submit wrong answer + compile error", async () => { await p.fill(".plain-editor", "WRONG"); await p.click("#submit"); await ex(".verdict.v-WA"); await ex(".tests li.fail");
  await p.fill(".plain-editor", "SYNTAXERR"); await p.click("#submit"); await ex(".verdict.v-CE"); await ex("pre.bad:has-text('before')"); });
await step("paste from outside blocked, internal copy allowed", async () => {
  const r = await p.evaluate(() => { const ta = document.querySelector(".plain-editor"); const mk = (t) => { const dt = new DataTransfer(); dt.setData("text/plain", t); return new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }); };
    const outside = ta.dispatchEvent(mk("stolen solution"));
    ta.value = "my own code"; ta.setSelectionRange(0, 11); ta.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true }));
    const inside = ta.dispatchEvent(mk("my own code")); return { outside, inside }; });
  if (r.outside !== false) throw new Error("outside paste was allowed"); if (r.inside !== true) throw new Error("internal paste was blocked"); await ex("#toast.show"); });
await step("focus loss is counted", async () => { await p.evaluate(() => window.__focus(false)); await ex("#focus:has-text('×1')"); });
await step("finish exam shows scores, kiosk off", async () => { await p.click("#finish"); await p.click(".dialog button:has-text('Finish exam')"); await ex("h1:has-text('You have finished')");
  await ex("td:has-text('100 / 100')"); if (!(await p.evaluate(() => window.__log.includes("kiosk:false")))) throw new Error("kiosk not released"); });
await step("exam ends by itself when time runs out", async () => { await p.click("#back"); await ex(".contest:has-text('Short Quiz') button"); await p.click(".contest:has-text('Short Quiz') button");
  await ex("h2:has-text('A. Sum')");
  const opts = await p.$$eval("#lang option", (o) => o.map((x) => x.value)); if (opts.join() !== "JAVA,PYTHON" && opts.join() !== "PYTHON,JAVA") throw new Error("language options " + opts);
  if (!["JAVA", "PYTHON"].includes(await p.inputValue("#lang"))) throw new Error("default language not allowed");
  await p.waitForSelector("h1:has-text('Time is up')", { timeout: 15000 }); });
await step("exam that has not started cannot be entered", async () => { await p.click("#back"); await ex(".contest:has-text('Final')"); if (await p.locator(".contest:has-text('Final') button").count()) throw new Error("enter button shown"); });
await p.screenshot({ path: "/tmp/student-end.png" });
console.log(errs.length ? "PAGE ERRORS: " + errs.join(" | ") : "no page errors");
await b.close(); API.close(); web.close();
process.exit(failed ? 1 : 0);
