'use strict';
// End-to-end protocol test: mock server + 2 real worker processes (SANDBOX=process).
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const { createMock } = require('./mock-server');

const has = (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;
const hasJava = has('javac');

const C = {
  ac: '#include <stdio.h>\nint main(){int a,b;scanf("%d %d",&a,&b);printf("%d\\n",a+b);return 0;}',
  wa: '#include <stdio.h>\nint main(){int a,b;scanf("%d %d",&a,&b);printf("%d\\n",a-b);return 0;}',
  tle: '#include <stdio.h>\nint main(){volatile long x=0;for(;;)x++;return 0;}',
  re: '#include <stdlib.h>\nint main(){abort();return 0;}',
  ce: 'int main(){ this is not C }',
};
const tests = [
  { id: 't1', ordinal: 1, input: '1 2\n', expected: '3\n', points: 10 },
  { id: 't2', ordinal: 2, input: '10 -4\n', expected: '6', points: 10 },
];
let n = 0;
const submit = (language, sourceCode, extra = {}) => ({ id: `job${++n}`, kind: 'SUBMIT', language, sourceCode, timeLimitMs: 500, memoryLimitKb: 262144, checker: 'EXACT', attempt: 1, testcases: tests, ...extra });

const cases = [
  ['C AC', submit('C', C.ac), (r) => r.tests.every((t) => t.verdict === 'AC') && r.tests.length === 2],
  ['C WA', submit('C', C.wa), (r) => r.tests[0].verdict === 'WA'],
  ['C TLE', submit('C', C.tle), (r) => r.tests[0].verdict === 'TLE'],
  ['C RE (abort)', submit('C', C.re), (r) => r.tests[0].verdict === 'RE'],
  ['C CE', submit('C', C.ce), (r) => r.compile.ok === false && r.compile.output.length > 0],
  ['Python AC', submit('PYTHON', 'a,b=map(int,input().split())\nprint(a+b)'), (r) => r.tests.every((t) => t.verdict === 'AC')],
  ['Python RE', submit('PYTHON', 'raise Exception("x")'), (r) => r.tests[0].verdict === 'RE'],
  ['C++ AC', submit('CPP', '#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}'), (r) => r.tests.every((t) => t.verdict === 'AC')],
  ['RUN custom input', { id: `run${++n}`, kind: 'RUN', language: 'PYTHON', sourceCode: 'print(input()[::-1])', stdin: 'abc\n', timeLimitMs: 2000, memoryLimitKb: 262144, attempt: 1 }, (r) => r.verdict === 'OK' && r.stdout.trim() === 'cba'],
  ['RUN infinite loop', { id: `run${++n}`, kind: 'RUN', language: 'PYTHON', sourceCode: 'while True: pass', stdin: '', timeLimitMs: 300, memoryLimitKb: 262144, attempt: 1 }, (r) => r.verdict === 'TLE'],
];
if (hasJava) cases.push(['Java AC', submit('JAVA', 'import java.util.*;public class Main{public static void main(String[] x){Scanner s=new Scanner(System.in);System.out.println(s.nextInt()+s.nextInt());}}', { timeLimitMs: 3000 }), (r) => r.tests.every((t) => t.verdict === 'AC')]);
else console.log('(javac not installed: skipping Java case)');

(async () => {
  const mock = createMock('test-token');
  const port = await mock.listen();
  const workers = ['judge-1', 'judge-2'].map((id) => spawn(process.execPath, [path.join(__dirname, '..', 'worker.js'),
    '--server', `http://127.0.0.1:${port}`, '--id', id, '--token', 'test-token', '--sandbox', 'process', '--wait', '1'], { stdio: 'inherit' }));

  cases.forEach((c) => mock.enqueue(c[1]));
  const deadline = Date.now() + 60000;
  while (mock.results.size < cases.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));

  let failed = 0;
  for (const [name, job, pred] of cases) {
    const r = mock.results.get(job.id);
    let ok = false;
    try { ok = !!r && !r.systemError && pred(r); } catch { ok = false; }
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + JSON.stringify(r)}`);
  }
  const usedWorkers = new Set([...mock.results.values()].map((r) => r.worker));
  console.log(`workers that connected: ${[...mock.seenWorkers].join(', ')}; workers that judged: ${[...usedWorkers].join(', ')}`);
  workers.forEach((w) => w.kill('SIGTERM'));
  mock.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})();
