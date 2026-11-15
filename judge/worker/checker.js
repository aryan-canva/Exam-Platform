'use strict';
// Output comparison. EXACT ignores trailing whitespace on each line and trailing blank lines.
// TOKEN (and any unknown checker type) compares whitespace-separated tokens.
function normalizeLines(s) {
  const lines = String(s).replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, ''));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function tokens(s) {
  return String(s).split(/\s+/).filter(Boolean);
}

function check(type, actual, expected) {
  if ((type || 'EXACT').toUpperCase() === 'EXACT') {
    const a = normalizeLines(actual);
    const e = normalizeLines(expected);
    return a.length === e.length && a.every((l, i) => l === e[i]);
  }
  const a = tokens(actual);
  const e = tokens(expected);
  return a.length === e.length && a.every((t, i) => t === e[i]);
}

module.exports = { check };
