// Monaco when available (npm package "monaco-editor"), otherwise a plain textarea so the app always works.
const MONACO_BASE = new URL("../node_modules/monaco-editor/min/vs", location.href).href;

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(new Error("load " + src));
    document.head.appendChild(s);
  });
}
let monacoP = null;
function loadMonaco() {
  if (!monacoP) monacoP = loadScript(MONACO_BASE + "/loader.js").then(() => new Promise((res, rej) => {
    window.require.config({ paths: { vs: MONACO_BASE } });
    window.require(["vs/editor/editor.main"], () => res(window.monaco), rej);
  }));
  return monacoP;
}

export async function createEditor(el, { onChange, readOnly = false }) {
  let monaco = null;
  try { monaco = await Promise.race([loadMonaco(), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 8000))]); } catch { monaco = null; }

  if (monaco) {
    const ed = monaco.editor.create(el, {
      value: "", language: "plaintext", theme: "vs-dark", automaticLayout: true, readOnly,
      fontSize: 15, fontFamily: "Consolas, 'Cascadia Mono', monospace", minimap: { enabled: false },
      scrollBeyondLastLine: false, tabSize: 4, insertSpaces: true, renderWhitespace: "none",
      quickSuggestions: false, suggestOnTriggerCharacters: false, parameterHints: { enabled: false },
      wordBasedSuggestions: "off", contextmenu: false, dragAndDrop: false, padding: { top: 10 },
    });
    ed.onDidChangeModelContent(() => onChange?.());
    return {
      kind: "monaco",
      getValue: () => ed.getValue(),
      setValue: (v) => { ed.setValue(v); ed.setScrollTop(0); },
      setLanguage: (l) => monaco.editor.setModelLanguage(ed.getModel(), l),
      setReadOnly: (b) => ed.updateOptions({ readOnly: b }),
      getSelectedText: () => ed.getModel().getValueInRange(ed.getSelection()),
      focus: () => ed.focus(),
      dispose: () => ed.dispose(),
    };
  }
  const ta = document.createElement("textarea");
  ta.className = "plain-editor"; ta.spellcheck = false; ta.readOnly = readOnly;
  ta.addEventListener("input", () => onChange?.());
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Tab") { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText("    ", s, ta.selectionEnd, "end"); onChange?.(); }
  });
  el.appendChild(ta);
  return {
    kind: "textarea",
    getValue: () => ta.value,
    setValue: (v) => { ta.value = v; ta.scrollTop = 0; },
    setLanguage: () => {},
    setReadOnly: (b) => { ta.readOnly = b; },
    getSelectedText: () => ta.value.substring(ta.selectionStart, ta.selectionEnd),
    focus: () => ta.focus(),
    dispose: () => ta.remove(),
  };
}
