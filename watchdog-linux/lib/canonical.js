// Deterministic JSON: sorted keys, no whitespace. Both signer and verifier use this exact form.
export function canonical(v) {
  if (v === null || typeof v !== "object") {
    if (typeof v === "number" && !Number.isFinite(v)) throw new Error("non-finite number in event payload");
    return JSON.stringify(v === undefined ? null : v);
  }
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
}
