# End-to-end checklist (about 15 minutes)

Automated first: `node tools/integration-test.mjs http://<server>:8080 [--teacher user:pass]` (needs at least one judge worker online). It covers items 1 to 8 over HTTP. Then do the manual parts.

1. Server up, `GET /time` works from another machine.
2. Teacher UI: create first teacher, log in. Judge tab shows judge-1 and judge-2 online.
3. Teacher UI: create a problem with one sample and one hidden testcase.
4. Students tab: paste 2 students.
5. Exams: create exam, add the problem, enroll both students, Publish, Start.
6. Student app on a **different network or device**: enter the server URL, sign in, open the exam.
7. Run with custom input; submit a correct, a wrong and a non-compiling solution: AC, WA, CE.
8. Teacher: Standings and Submissions update; End exam. Student app shows "ended".
9. Manual only: kiosk (cannot Alt+F4, devtools/reload blocked, paste from outside refused, focus-loss counter), Docker sandbox (infinite loop gives TLE, `fork` bomb or huge allocation does not hurt the host, no network from code), kill a worker mid-judging and see the job re-run on the other worker.
