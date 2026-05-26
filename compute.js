// BrightMind V2 — Compute Engine (DEF-041, DEF-042)
// Replaces the old verify() regex stage. Pure deterministic code — no Claude call.
//
// Two responsibilities, fail-closed throughout:
//  1. UNIVERSAL OPTION GUARD — runs on EVERY question regardless of verify type:
//     rejects any question with duplicate options (two of the four answers equal,
//     numerically or textually). Duplicate options = ambiguous question.
//  2. ARITHMETIC VERIFICATION — for verify:"arithmetic" questions carrying a
//     compute:{op,inputs[,target]} block, recomputes the answer from inputs ALONE
//     (never reads the model's c or e), then confirms/corrects c or rejects.
//
// "Select-among-the-options" comparison ops (closest_to, largest, smallest,
// equal_to) return null on a tie — a tie means two options are equally correct,
// which is a broken question. null → reject.

// Tight epsilon for tie / exact-match detection inside comparison ops. Distinct
// curriculum decimals can be as close as 0.001 (e.g. 0.6 vs 0.605), so tie
// detection must be exact-ish — NOT the looser 0.01 used for answer matching.
const EPS = 1e-9;

// ── Pure operation table ──
// Each op takes a numeric array (and optionally a target) and returns a single
// number, or null if the result is undefined / ambiguous.
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
  // Two-element ops.
  percent_of: (a) => (a.length === 2 && a[1] !== 0 ? (a[0] / a[1]) * 100 : null),
  fraction_of:(a) => (a.length === 2 ? a[0] * a[1] : null), // inputs:[whole, fraction]

  // ── Select-among-the-options comparison ops (DEF-042 class) ──
  // The answer is one of the candidate numbers, chosen by comparison. Each
  // returns null on a tie: a tie means the question has two correct answers.

  // closest_to: inputs = candidates, target = reference. Answer is the candidate
  // with the smallest |value - target|.
  closest_to: (a, target) => {
    if (!a.length || typeof target !== "number" || !Number.isFinite(target)) return null;
    let best = null, bestDist = Infinity, tie = false;
    for (const v of a) {
      const d = Math.abs(v - target);
      if (d < bestDist - EPS) { best = v; bestDist = d; tie = false; }
      else if (Math.abs(d - bestDist) <= EPS) { tie = true; }
    }
    return tie ? null : best;
  },
  // largest: inputs = candidates. Answer is the greatest. Tie → reject.
  largest: (a) => {
    if (!a.length) return null;
    const hi = Math.max(...a);
    return a.filter((v) => Math.abs(v - hi) <= EPS).length > 1 ? null : hi;
  },
  // smallest: inputs = candidates. Answer is the least. Tie → reject.
  smallest: (a) => {
    if (!a.length) return null;
    const lo = Math.min(...a);
    return a.filter((v) => Math.abs(v - lo) <= EPS).length > 1 ? null : lo;
  },
  // equal_to: inputs = candidates, target = the value to match. Answer is the
  // single candidate equal to target. Zero matches OR more than one → reject.
  equal_to: (a, target) => {
    if (!a.length || typeof target !== "number" || !Number.isFinite(target)) return null;
    const hits = a.filter((v) => Math.abs(v - target) <= EPS);
    return hits.length === 1 ? hits[0] : null;
  },
};

const KNOWN_OPS = new Set(Object.keys(OPS));
// Ops needing a second arg (compute.target) rather than inputs alone.
const TARGET_OPS = new Set(["closest_to", "equal_to"]);

// Tolerance for accepting an option as the verified answer — absorbs float drift
// from mean/percent_of. Larger than EPS (which is for tie detection); the closest
// option is chosen first, so this only gates whether that closest option is "the"
// answer or the question is rejected as having no matching option.
const MATCH_TOL = 0.01;

// Parse a numeric value out of an option string ("33", "33 cm", "£40", "40%").
function optionValue(opt) {
  if (typeof opt === "number") return opt;
  if (typeof opt !== "string") return null;
  const m = opt.replace(/,/g, "").match(/-?\d+\.?\d*/);
  return m ? parseFloat(m[0]) : null;
}

// ── Universal duplicate-option guard ──
// An MCQ with two identical options has two correct answers (or two wrong ones
// the child can't distinguish) — broken regardless of subject or verify type.
// Returns a free-text reason string if a duplicate is found, else null.
// Numeric options are compared by value (so "0.5" and "0.50" collide);
// non-numeric options are compared by normalised text.
function duplicateOptionReason(o) {
  if (!Array.isArray(o) || o.length < 2) return null;
  const seenNum = [];
  const seenText = new Set();
  for (let i = 0; i < o.length; i++) {
    const raw = o[i];
    const v = optionValue(raw);
    const isPlainNumber =
      v !== null && typeof raw !== "object" &&
      String(raw).replace(/,/g, "").trim().match(/^-?£?\$?\d+\.?\d*%?$/);
    if (isPlainNumber) {
      if (seenNum.some((s) => Math.abs(s - v) < 1e-9)) {
        return `duplicate options: two answers equal ${v}`;
      }
      seenNum.push(v);
    } else {
      const t = String(raw).trim().toLowerCase().replace(/\s+/g, " ");
      if (t && seenText.has(t)) {
        return `duplicate options: two answers read "${t}"`;
      }
      seenText.add(t);
    }
  }
  return null;
}

// ── computeVerify ──
// qs: array of question objects from generate(). subj kept for signature symmetry.
// Returns the same array; questions are corrected (c fixed to the verified answer)
// or marked { _computeFailed:true, _computeReason } for rejection. _computeReason
// is free text — surfaced in logs and intended to feed top-up regeneration (CR-019).
function computeVerify(qs) {
  return qs.map((q) => {
    // STEP 1 — universal option guard, runs on EVERY question (arithmetic,
    // equation_balance, none, and legacy rows with no verify field).
    const dupReason = duplicateOptionReason(q.o);
    if (dupReason) {
      return { ...q, _computeFailed: true, _computeReason: dupReason };
    }

    // STEP 2 — arithmetic verification only. equation_balance + none pass through;
    // their answer correctness is owned by the audit agent (CR-015 pending for a
    // dedicated equation_balance verifier).
    if (q.verify !== "arithmetic") return q;

    const cb = q.compute;
    // verify:"arithmetic" with no/invalid compute block → cannot verify → reject.
    if (!cb || typeof cb !== "object" ||
        !KNOWN_OPS.has(cb.op) ||
        !Array.isArray(cb.inputs) ||
        !cb.inputs.length ||
        !cb.inputs.every((n) => typeof n === "number" && Number.isFinite(n))) {
      return { ...q, _computeFailed: true,
        _computeReason: `missing or invalid compute block (op "${cb && cb.op}")` };
    }

    let truth;
    try {
      if (TARGET_OPS.has(cb.op)) {
        // closest_to / equal_to need a numeric compute.target.
        if (typeof cb.target !== "number" || !Number.isFinite(cb.target)) {
          return { ...q, _computeFailed: true,
            _computeReason: `op "${cb.op}" requires a numeric "target"` };
        }
        truth = OPS[cb.op](cb.inputs, cb.target);
      } else {
        truth = OPS[cb.op](cb.inputs);
      }
    } catch (e) {
      return { ...q, _computeFailed: true, _computeReason: `op threw: ${e.message}` };
    }
    // op returned null → unverifiable. For comparison ops this means a tie:
    // two options are equally correct → the question is ambiguous → reject.
    if (truth === null || !Number.isFinite(truth)) {
      const reason = TARGET_OPS.has(cb.op) || cb.op === "largest" || cb.op === "smallest" || cb.op === "mode"
        ? `op "${cb.op}" has no single answer (tie / no match) — question is ambiguous`
        : `op "${cb.op}" is undefined for the given inputs`;
      return { ...q, _computeFailed: true, _computeReason: reason };
    }

    // Find the option matching the verified truth. Match to the CLOSEST option,
    // not the first within tolerance — curriculum options can be 0.005 apart, so
    // "first within 0.01" would mis-match. The closest option is accepted only if
    // it is within MATCH_TOL of truth (covers float drift from mean/percent).
    const vals = q.o.map(optionValue);
    let match = -1, matchDist = Infinity;
    vals.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) return;
      const d = Math.abs(v - truth);
      if (d < matchDist) { matchDist = d; match = i; }
    });

    // Truth is not among the four options → the question itself is broken → reject.
    if (match < 0 || matchDist > MATCH_TOL) {
      return { ...q, _computeFailed: true,
        _computeReason: `verified answer ${truth} is not one of the four options` };
    }

    // Truth IS an option. Point c at it — corrects a mis-indexed generator answer
    // to the VERIFIED value.
    if (match !== q.c) {
      return { ...q, c: match, _computeCorrected: true, _computeTruth: truth };
    }
    return { ...q, _computeVerified: true, _computeTruth: truth };
  });
}

module.exports = { computeVerify, OPS, KNOWN_OPS, optionValue, duplicateOptionReason };
