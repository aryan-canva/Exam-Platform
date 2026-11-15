export const LANGS = [
  { id: "CPP", label: "C++", monaco: "cpp" },
  { id: "C", label: "C", monaco: "c" },
  { id: "JAVA", label: "Java", monaco: "java" },
  { id: "PYTHON", label: "Python 3", monaco: "python" },
];
export const TEMPLATES = {
  C: "#include <stdio.h>\n\nint main(void) {\n    \n    return 0;\n}\n",
  CPP: "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    \n    return 0;\n}\n",
  JAVA: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        \n    }\n}\n",
  PYTHON: "import sys\n\ndef main():\n    data = sys.stdin.read().split()\n    \n\nmain()\n",
};
export const VERDICT = {
  AC: "Accepted", WA: "Wrong answer", TLE: "Time limit exceeded", MLE: "Memory limit exceeded",
  RE: "Runtime error", CE: "Compilation error", IE: "Judge error. Please submit again.", OK: "Ran successfully",
};
