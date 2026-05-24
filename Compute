// BrightMind V2 — Compute Engine (DEF-041)
// Replaces the old verify() regex stage. Pure deterministic code — no Claude call.
// A question tagged verify:"arithmetic" carries compute:{op,inputs}. This module
// recomputes the answer from inputs ALONE — it never reads the model's c or e —
// then either confirms/corrects c, or rejects the question. Fail-closed.

// ── Pure operation table ──
// Each op takes a numeric array and returns a single number, or null if undefined.
const OPS = {
  sum:        (a) => a.reduce((x, y) => x + y, 0),
  product:    (a) => a.reduce((x, y) => x * y, 1),
  count:      (a) => a.length,
  min:        (a) => Math.min(...a),
  max:        (a) => Math.max(...a),
  range:      (a) => Math.max(...a) - Math.min(...a),
  difference: (a) => (a.length === 2 ? Math.abs(a[0] - a[1]) : null),
  mean:       (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null),
  median:     (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  },
  mode:       (a) => {
    if (!a.length) return null;
    const f = {};
    a.forEach((v) => { f[v] = (f[v] || 0) + 1; });
    let best = null, bestCount = 0, tie = false;
    for (const [v, c] of Object.entries(f)) {
      if (c > bestCount) { best = Number(v); bestCount = c; tie = false; }
      else if (c === bestCount) { tie = true; }
    }
    return tie ? null : best; // ambiguous mode → unverifiable
  },
  // Two-element ops: [part, whole] for percent, [whole, fraction] not used — see below.
  percent_of: (a) => (a.length === 2 && a[1] !== 0 ? (a[0] / a[1]) * 100 : null),
  fraction_of:(a) => (a.length === 2 ? a[0] * a[1] : null), // inputs:[whole, fraction]
};

const KNOWN_OPS = new Set(Object.keys(OPS));

// Compare with tolerance — floats from mean/percent won't be exact.
function near(x, y) {
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 0.01;
}

// Parse a numeric value out of an option string ("33", "33 cm", "£40", "40%").
function optionValue(opt) {
  if (typeof opt === "number") return opt;
  if (typeof opt !== "string") return null;
  const m = opt.replace(/,/g, "").match(/-?\d+\.?\d*/);
  return m ? parseFloat(m[0]) : null;
}

// ── computeVerify ──
// qs: array of question objects from generate(). subj unused but kept for symmetry.
// Returns the same array; calculable questions are either corrected (c fixed to the
// verified answer) or marked { _computeFailed:true, _computeReason } for rejection.
function computeVerify(qs) {
  return qs.map((q) => {
    // Only arithmetic-tagged questions are checked. equation_balance + none pass
    // through untouched — their correctness is owned by the audit agent (CR pending
    // for a dedicated equation-balance verifier).
    if (q.verify !== "arithmetic") return q;

    const cb = q.compute;
    // verify:"arithmetic" with no/invalid compute block → cannot verify → reject.
    if (!cb || typeof cb !== "object" ||
        !KNOWN_OPS.has(cb.op) ||
        !Array.isArray(cb.inputs) ||
        !cb.inputs.length ||
        !cb.inputs.every((n) => typeof n === "number" && Number.isFinite(n))) {
      return { ...q, _computeFailed: true, _computeReason: "missing/invalid compute block" };
    }

    let truth;
    try {
      truth = OPS[cb.op](cb.inputs);
    } catch (e) {
      return { ...q, _computeFailed: true, _computeReason: `op threw: ${e.message}` };
    }
    // op returned null (ambiguous mode, bad arity) → unverifiable → reject.
    if (truth === null || !Number.isFinite(truth)) {
      return { ...q, _computeFailed: true, _computeReason: `op ${cb.op} undefined for inputs` };
    }

    // Find the option matching the verified truth.
    const vals = q.o.map(optionValue);
    const match = vals.findIndex((v) => v !== null && near(v, truth));

    // Truth is not among the four options → the question itself is broken → reject.
    if (match < 0) {
      return { ...q, _computeFailed: true, _computeReason: `verified answer ${truth} not in options` };
    }

    // Truth IS an option. Point c at it — this corrects a mis-indexed generator
    // answer to the VERIFIED value (not, as the old verify() did, to whatever
    // number the explanation happened to contain).
    if (match !== q.c) {
      return { ...q, c: match, _computeCorrected: true, _computeTruth: truth };
    }
    return { ...q, _computeVerified: true, _computeTruth: truth };
  });
}

module.exports = { computeVerify, OPS, KNOWN_OPS, optionValue };
