// BrightMind V2 — Tester: compute engine (DEF-041)
// Run: node compute.test.js
const { computeVerify } = require("./compute");

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}

// ── DEF-041 regression: the exact failing question ──
// data {45,38,52,41,64,78,56}. range = 78-38 = 40. Min (38) is NOT first in list.
// Generator wrongly produced c→33; engine must reject (40 is not even an option here)
// OR correct c→40 if 40 is an option. Both screenshots show options included 40 and 33.
{
  const q = {
    q: "Daily customers... what is the range?",
    o: ["33", "40", "45", "78"], c: 0, // generator said 33 (WRONG)
    verify: "arithmetic",
    compute: { op: "range", inputs: [45, 38, 52, 41, 64, 78, 56] },
  };
  const [r] = computeVerify([q]);
  check("DEF-041: range recomputed as 40", r._computeTruth === 40);
  check("DEF-041: c corrected away from wrong index 0", r.c === 1);
  check("DEF-041: flagged as corrected", r._computeCorrected === true);
}

// ── Min-not-first trap, isolated ──
{
  const q = { q: "range", o: ["7", "9", "12", "15"], c: 0,
    verify: "arithmetic", compute: { op: "range", inputs: [20, 5, 17, 12] } };
  const [r] = computeVerify([q]); // 20-5 = 15
  check("min-not-first: truth 15", r._computeTruth === 15);
  check("min-not-first: c -> 15", r.c === 3);
}

// ── Happy path: generator already correct ──
{
  const q = { q: "mean", o: ["10", "20", "30", "40"], c: 1,
    verify: "arithmetic", compute: { op: "mean", inputs: [10, 20, 30] } };
  const [r] = computeVerify([q]); // mean = 20, c already 1
  check("happy: verified, not corrected", r._computeVerified === true && r.c === 1);
}

// ── Reject: verified answer not among options ──
{
  const q = { q: "sum", o: ["1", "2", "3", "4"], c: 0,
    verify: "arithmetic", compute: { op: "sum", inputs: [50, 50] } };
  const [r] = computeVerify([q]); // sum = 100, not an option
  check("reject: truth not in options", r._computeFailed === true);
}

// ── Reject: unknown op ──
{
  const q = { q: "x", o: ["1", "2", "3", "4"], c: 0,
    verify: "arithmetic", compute: { op: "variance", inputs: [1, 2, 3] } };
  const [r] = computeVerify([q]);
  check("reject: unknown op fail-closed", r._computeFailed === true);
}

// ── Reject: verify:arithmetic but no compute block ──
{
  const q = { q: "x", o: ["1", "2", "3", "4"], c: 0, verify: "arithmetic" };
  const [r] = computeVerify([q]);
  check("reject: missing compute block", r._computeFailed === true);
}

// ── Reject: ambiguous mode (tie) is unverifiable ──
{
  const q = { q: "mode", o: ["2", "3", "4", "5"], c: 0,
    verify: "arithmetic", compute: { op: "mode", inputs: [2, 2, 3, 3] } };
  const [r] = computeVerify([q]);
  check("reject: tied mode unverifiable", r._computeFailed === true);
}

// ── Pass-through: non-arithmetic questions untouched ──
{
  const sci = { q: "Which gas do plants release?", o: ["O2","CO2","N2","H2"], c: 0,
    verify: "none" };
  const [r] = computeVerify([sci]);
  check("passthrough: verify:none untouched", r._computeFailed === undefined && r._computeVerified === undefined && r.c === 0);

  const bal = { q: "Balance H2 + O2 -> H2O", o: ["a","b","c","d"], c: 0,
    verify: "equation_balance" };
  const [r2] = computeVerify([bal]);
  check("passthrough: equation_balance deferred to audit", r2._computeFailed === undefined);

  const legacy = { q: "old question, no verify field", o: ["a","b","c","d"], c: 2 };
  const [r3] = computeVerify([legacy]);
  check("passthrough: missing verify field untouched", r3._computeFailed === undefined && r3.c === 2);
}

// ── Option parsing: units / currency / percent ──
{
  const q = { q: "difference", o: ["£10", "£25", "£40", "£55"], c: 0,
    verify: "arithmetic", compute: { op: "difference", inputs: [70, 30] } };
  const [r] = computeVerify([q]); // diff = 40
  check("parse: currency-prefixed option matched", r.c === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
