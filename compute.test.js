// BrightMind V2 — Tester: compute engine (DEF-041)
// Run: node compute.test.js
const { computeVerify, safeEval, parseFormula, parseEquation, balances } = require("./compute");

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

// ── DEF-042: closest_to happy path ──
{
  const q = { q: "closest to 50?", o: ["46", "49", "52", "58"], c: 0,
    verify: "arithmetic", compute: { op: "closest_to", inputs: [46, 49, 52, 58], target: 50 } };
  const [r] = computeVerify([q]); // 49 is nearest (dist 1)
  check("DEF-042: closest_to truth 49", r._computeTruth === 49);
  check("DEF-042: c corrected to index 1", r.c === 1);
}

// ── DEF-042 regression: the exact ambiguous question — 48 and 52 BOTH 2 from 50 ──
{
  const q = { q: "closest to 50?", o: ["46", "48", "52", "55"], c: 1,
    verify: "arithmetic", compute: { op: "closest_to", inputs: [46, 48, 52, 55], target: 50 } };
  const [r] = computeVerify([q]);
  check("DEF-042: tied closest rejected (two correct answers)", r._computeFailed === true);
}

// ── DEF-042: closest_to with missing target → reject ──
{
  const q = { q: "closest to 50?", o: ["46", "49", "52", "58"], c: 1,
    verify: "arithmetic", compute: { op: "closest_to", inputs: [46, 49, 52, 58] } };
  const [r] = computeVerify([q]);
  check("DEF-042: missing target rejected", r._computeFailed === true);
}

// ── DEF-042: largest happy path ──
{
  const q = { q: "largest?", o: ["0.6", "0.59", "0.605", "0.58"], c: 0,
    verify: "arithmetic", compute: { op: "largest", inputs: [0.6, 0.59, 0.605, 0.58] } };
  const [r] = computeVerify([q]); // 0.605 is largest -> index 2
  check("DEF-042: largest truth 0.605", Math.abs(r._computeTruth - 0.605) < 1e-9);
  check("DEF-042: largest c -> index 2", r.c === 2);
}

// ── DEF-042: largest with tied maximum -> reject ──
{
  const q = { q: "largest?", o: ["9", "9", "4", "1"], c: 0,
    verify: "arithmetic", compute: { op: "largest", inputs: [9, 9, 4, 1] } };
  const [r] = computeVerify([q]);
  // duplicate-option guard catches this first; either way it must reject.
  check("DEF-042: tied largest rejected", r._computeFailed === true);
}

// ── DEF-042: smallest happy path ──
{
  const q = { q: "smallest?", o: ["12", "7", "20", "15"], c: 0,
    verify: "arithmetic", compute: { op: "smallest", inputs: [12, 7, 20, 15] } };
  const [r] = computeVerify([q]); // 7 -> index 1
  check("DEF-042: smallest c -> index 1", r.c === 1 && r._computeTruth === 7);
}

// ── DEF-042: equal_to happy path ──
{
  const q = { q: "equals 1/2?", o: ["0.2", "0.5", "0.25", "0.75"], c: 0,
    verify: "arithmetic", compute: { op: "equal_to", inputs: [0.2, 0.5, 0.25, 0.75], target: 0.5 } };
  const [r] = computeVerify([q]); // 0.5 -> index 1
  check("DEF-042: equal_to c -> index 1", r.c === 1);
}

// ── DEF-042: equal_to with no matching option -> reject ──
{
  const q = { q: "equals 1/3?", o: ["0.2", "0.5", "0.25", "0.75"], c: 0,
    verify: "arithmetic", compute: { op: "equal_to", inputs: [0.2, 0.5, 0.25, 0.75], target: 0.333 } };
  const [r] = computeVerify([q]);
  check("DEF-042: equal_to no match rejected", r._computeFailed === true);
}

// ── DEF-042: universal duplicate-option guard — NUMERIC duplicate ──
{
  const q = { q: "any numeric question", o: ["10", "10", "20", "30"], c: 0,
    verify: "arithmetic", compute: { op: "sum", inputs: [4, 6] } }; // sum=10
  const [r] = computeVerify([q]);
  check("DEF-042: duplicate numeric options rejected", r._computeFailed === true);
}

// ── DEF-042: duplicate-option guard catches "0.5" vs "0.50" (same value) ──
{
  const q = { q: "decimal question", o: ["0.5", "0.50", "0.7", "0.9"], c: 0,
    verify: "none" };
  const [r] = computeVerify([q]);
  check("DEF-042: 0.5 == 0.50 duplicate rejected on verify:none", r._computeFailed === true);
}

// ── DEF-042: duplicate-option guard — TEXT duplicate on verify:none ──
{
  const q = { q: "Which shape has one line of symmetry?",
    o: ["Square", "Isosceles triangle", "Isosceles triangle", "Circle"], c: 1,
    verify: "none" };
  const [r] = computeVerify([q]);
  check("DEF-042: duplicate text options rejected on verify:none", r._computeFailed === true);
}

// ── DEF-042: distinct options on verify:none still pass through untouched ──
{
  const q = { q: "Which gas?", o: ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"], c: 0,
    verify: "none" };
  const [r] = computeVerify([q]);
  check("DEF-042: distinct verify:none untouched", r._computeFailed === undefined && r.c === 0);
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

// ════════════════════════════════════════════════════════════════════════════
// GCSE expansion — safe expression evaluator
// ════════════════════════════════════════════════════════════════════════════

// ── Evaluator: precedence, right-assoc ^, parentheses ──
check("eval: precedence 2+3*4 = 14", safeEval("2+3*4", {}) === 14);
check("eval: ^ before * → 2+3*4^2 = 50", safeEval("2+3*4^2", {}) === 50);
check("eval: ^ right-assoc 2^3^2 = 512", safeEval("2^3^2", {}) === 512);
check("eval: parentheses (2+3)*4 = 20", safeEval("(2+3)*4", {}) === 20);
check("eval: unary minus -3+5 = 2", safeEval("-3+5", {}) === 2);
check("eval: vars a*b+c", safeEval("a*b+c", { a: 2, b: 3, c: 4 }) === 10);

// ── Evaluator: functions, degrees trig, pi ──
check("eval: sqrt(9) = 3", safeEval("sqrt(9)", {}) === 3);
check("eval: cbrt(27) = 3", safeEval("cbrt(27)", {}) === 3);
check("eval: sin(30 deg) ≈ 0.5", Math.abs(safeEval("sin(30)", {}) - 0.5) < 1e-9);
check("eval: cos(60 deg) ≈ 0.5", Math.abs(safeEval("cos(60)", {}) - 0.5) < 1e-9);
check("eval: pi*r^2 (r=2) ≈ 12.566", Math.abs(safeEval("pi*r^2", { r: 2 }) - 12.566370614) < 1e-6);

// ── Evaluator: fail-closed ──
function evalThrows(expr, vars) {
  try { safeEval(expr, vars || {}); return false; } catch (e) { return true; }
}
check("eval: division by zero → null", safeEval("a/b", { a: 5, b: 0 }) === null);
check("eval: unknown variable throws", evalThrows("x+1", {}));
check("eval: bad character ; throws", evalThrows("1;2", {}));
check("eval: injection 'process.exit' → unknown var throws", evalThrows("process", {}));
check("eval: unknown function throws", evalThrows("foo(2)", {}));
check("eval: mismatched parens throws", evalThrows("(1+2", {}));

// ════════════════════════════════════════════════════════════════════════════
// formula op
// ════════════════════════════════════════════════════════════════════════════

// ── Pythagoras: hypotenuse of 6,8 = 10; generator put c wrong → corrected ──
{
  const q = { q: "hypotenuse?", o: ["7 cm", "10 cm", "14 cm", "48 cm"], c: 0,
    verify: "arithmetic", compute: { op: "formula", expr: "sqrt(a^2+b^2)", vars: { a: 6, b: 8 } } };
  const [r] = computeVerify([q]);
  check("formula: Pythagoras truth 10", r._computeTruth === 10);
  check("formula: Pythagoras c corrected to 1", r.c === 1 && r._computeCorrected === true);
}

// ── Speed = d/t via formula (replaces the old verify:none routing) ──
{
  const q = { q: "120 m in 8 s, speed?", o: ["8", "15", "128", "960"], c: 1,
    verify: "arithmetic", compute: { op: "formula", expr: "d/t", vars: { d: 120, t: 8 } } };
  const [r] = computeVerify([q]);
  check("formula: speed 15 verified", r._computeVerified === true && r.c === 1);
}

// ── Compound interest P*(1+r)^n: 2000 at 3% for 4 yrs = 2251.018… ──
{
  const q = { q: "compound interest total?", o: ["2240", "2251.02", "2120", "2000"], c: 0,
    verify: "arithmetic", compute: { op: "formula", expr: "P*(1+r)^n", vars: { P: 2000, r: 0.03, n: 4 } } };
  const [r] = computeVerify([q]);
  check("formula: compound interest matches rounded option", r.c === 1 && r._computeCorrected === true);
}

// ── Estimated mean Σ(f·x)/Σf ──
{
  const q = { q: "estimated mean?", o: ["18", "21", "25", "30"], c: 0,
    verify: "arithmetic",
    compute: { op: "formula", expr: "(f1*x1+f2*x2+f3*x3)/(f1+f2+f3)",
      vars: { f1: 5, x1: 10, f2: 8, x2: 20, f3: 7, x3: 30 } } };
  const [r] = computeVerify([q]); // (50+160+210)/20 = 21
  check("formula: estimated mean 21", r._computeTruth === 21 && r.c === 1);
}

// ── Circle area irrational — relative tolerance matches "78.5" ──
{
  const q = { q: "area of circle r=5?", o: ["31.4", "78.5", "157", "25"], c: 0,
    verify: "arithmetic", compute: { op: "formula", expr: "pi*r^2", vars: { r: 5 } } };
  const [r] = computeVerify([q]); // 78.539816… ~ 78.5
  check("formula: π area matches 78.5 via rel tol", r.c === 1 && r._computeCorrected === true);
}

// ── formula reject: result matches no option ──
{
  const q = { q: "x", o: ["1", "2", "3", "4"], c: 0,
    verify: "arithmetic", compute: { op: "formula", expr: "a*b", vars: { a: 50, b: 50 } } };
  const [r] = computeVerify([q]);
  check("formula: result 2500 not in options → reject", r._computeFailed === true);
}

// ── formula reject: malformed expr is fail-closed ──
{
  const q = { q: "x", o: ["1", "2", "3", "4"], c: 0,
    verify: "arithmetic", compute: { op: "formula", expr: "a +* b", vars: { a: 1, b: 2 } } };
  const [r] = computeVerify([q]);
  check("formula: malformed expr → reject", r._computeFailed === true);
}

// ── formula reject: missing vars ──
{
  const q = { q: "x", o: ["1", "2", "3", "4"], c: 0,
    verify: "arithmetic", compute: { op: "formula", expr: "a+z", vars: { a: 1 } } };
  const [r] = computeVerify([q]);
  check("formula: unknown var z → reject", r._computeFailed === true);
}

// ── Second-match guard: two options within relative tolerance → reject ──
{
  // truth 10000 → tol = max(0.01, 10000*0.001) = 10; options 10003 and 9995
  // are both within 10 of the truth → two acceptable answers → reject.
  const q = { q: "x", o: ["9995", "10003", "5000", "20000"], c: 0,
    verify: "arithmetic", compute: { op: "formula", expr: "a*b", vars: { a: 1000, b: 10 } } };
  const [r] = computeVerify([q]);
  check("formula: two options within tol → ambiguous reject", r._computeFailed === true);
}

// ════════════════════════════════════════════════════════════════════════════
// divide op
// ════════════════════════════════════════════════════════════════════════════
{
  const q = { q: "density m/V?", o: ["2", "5", "8", "20"], c: 0,
    verify: "arithmetic", compute: { op: "divide", inputs: [40, 8] } };
  const [r] = computeVerify([q]); // 5
  check("divide: 40/8 = 5 corrected", r._computeTruth === 5 && r.c === 1);

  const q2 = { q: "x", o: ["1", "2", "3", "4"], c: 0,
    verify: "arithmetic", compute: { op: "divide", inputs: [5, 0] } };
  const [r2] = computeVerify([q2]);
  check("divide: by zero → reject", r2._computeFailed === true);
}

// ════════════════════════════════════════════════════════════════════════════
// solve_for (algebra by substitution)
// ════════════════════════════════════════════════════════════════════════════

// ── Linear 3x+5 = 20 → x = 5 ──
{
  const q = { q: "solve 3x+5=20", o: ["3", "5", "7.5", "15"], c: 0,
    verify: "arithmetic",
    compute: { op: "solve_for", var: "x", lhs: "3*x+5", rhs: "20", candidates: [3, 5, 7.5, 15] } };
  const [r] = computeVerify([q]);
  check("solve_for: linear root 5 → c index 1", r.c === 1 && r._computeCorrected === true);
}

// ── candidates default to option values ──
{
  const q = { q: "solve 2x=14", o: ["5", "7", "9", "12"], c: 0,
    verify: "arithmetic", compute: { op: "solve_for", var: "x", lhs: "2*x", rhs: "14" } };
  const [r] = computeVerify([q]); // x=7
  check("solve_for: default candidates from options", r.c === 1);
}

// ── Quadratic with BOTH roots as options → ambiguous reject ──
{
  // x^2 = 4x-3 → x^2-4x+3=0 → roots 1 and 3, both options.
  const q = { q: "solve x^2=4x-3", o: ["1", "3", "5", "7"], c: 0,
    verify: "arithmetic",
    compute: { op: "solve_for", var: "x", lhs: "x^2", rhs: "4*x-3", candidates: [1, 3, 5, 7] } };
  const [r] = computeVerify([q]);
  check("solve_for: two roots in options → reject", r._computeFailed === true);
}

// ── No candidate satisfies → reject ──
{
  const q = { q: "solve 2x=15", o: ["1", "2", "3", "4"], c: 0,
    verify: "arithmetic",
    compute: { op: "solve_for", var: "x", lhs: "2*x", rhs: "15", candidates: [1, 2, 3, 4] } };
  const [r] = computeVerify([q]);
  check("solve_for: no satisfying option → reject", r._computeFailed === true);
}

// ════════════════════════════════════════════════════════════════════════════
// equation_balance (atom conservation)
// ════════════════════════════════════════════════════════════════════════════

// ── parseFormula / balances unit checks ──
check("parseFormula: Ca(OH)2 → Ca1 O2 H2",
  (() => { const f = parseFormula("Ca(OH)2"); return f.Ca === 1 && f.O === 2 && f.H === 2; })());
check("parseFormula: multi-letter NaCl", (() => { const f = parseFormula("NaCl"); return f.Na === 1 && f.Cl === 1; })());
check("balances: 2H2+O2->2H2O balanced", balances(parseEquation("2 H2 + O2 -> 2 H2O")) === true);
check("balances: H2+O2->H2O unbalanced", balances(parseEquation("H2 + O2 -> H2O")) === false);

// ── Mode A: coefficient placeholder — which ? balances ──
{
  const q = { q: "Coefficient of H2O? ? H2 + O2 -> ? ... actually: 2H2+O2->?H2O", o: ["1", "2", "3", "4"], c: 0,
    verify: "equation_balance",
    compute: { op: "equation_balance", equation: "2 H2 + O2 -> ? H2O" } };
  const [r] = computeVerify([q]); // ?=2 balances
  check("eq_balance modeA: coefficient 2 → c index 1", r.c === 1 && r._computeCorrected === true);
}

// ── Mode A: no balancing coefficient → reject ──
{
  const q = { q: "x", o: ["5", "6", "7", "8"], c: 0,
    verify: "equation_balance",
    compute: { op: "equation_balance", equation: "2 H2 + O2 -> ? H2O" } };
  const [r] = computeVerify([q]);
  check("eq_balance modeA: no coefficient balances → reject", r._computeFailed === true);
}

// ── Mode B: options are full equations — one balances ──
{
  const q = { q: "Which is balanced?",
    o: ["H2 + O2 -> H2O", "2H2 + O2 -> 2H2O", "H2 + O2 -> 2H2O", "2H2 + 2O2 -> H2O"], c: 0,
    verify: "equation_balance", compute: { op: "equation_balance" } };
  const [r] = computeVerify([q]);
  check("eq_balance modeB: balanced option index 1", r.c === 1 && r._computeCorrected === true);
}

// ── Mode B: with Ca(OH)2 group ──
{
  const q = { q: "Which is balanced?",
    o: ["Ca(OH)2 -> CaO + H2O", "Ca(OH)2 -> CaO + H2", "Ca(OH)2 -> Ca + H2O", "CaOH -> CaO + H2O"], c: 1,
    verify: "equation_balance", compute: { op: "equation_balance" } };
  const [r] = computeVerify([q]); // first balances: Ca1 O2 H2 -> Ca1 O1 + O1 H2
  check("eq_balance modeB: Ca(OH)2 balanced option index 0", r.c === 0 && r._computeCorrected === true);
}

// ── equation_balance with NO compute block still passes through to audit ──
{
  const q = { q: "Balance this", o: ["a", "b", "c", "d"], c: 0, verify: "equation_balance" };
  const [r] = computeVerify([q]);
  check("eq_balance: bare tag (no compute) passes through", r._computeFailed === undefined);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
