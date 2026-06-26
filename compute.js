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
  // divide: inputs:[a, b] → a / b. b === 0 → null (undefined). Covers the common
  // speed/density/rate case without needing the full formula evaluator (CR-015).
  divide:     (a) => (a.length === 2 && a[1] !== 0 ? a[0] / a[1] : null),

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

// Relative match tolerance for irrational / rounded answers (trig, π, roots).
// truth 78.5398… must match an option printed as "78.5"; a flat 0.01 absolute
// gate is too tight for large or irrational results. The effective tolerance is
// max(MATCH_TOL, |truth| * REL_TOL), so small integers stay gated at 0.01 while
// large/irrational answers get a proportional window. 0.1% comfortably absorbs
// 1-dp / 3-sig-fig rounding and the π≈3.14 convention, yet stays tight enough that
// realistic distractors are not mistaken for the answer. A per-block compute.tol
// can widen this (e.g. aggressive 2-sig-fig rounding), clamped to TOL_MAX_REL.
const REL_TOL = 0.001;      // 0.1%
const TOL_MAX_REL = 0.005;  // hard ceiling on any per-block override

// Effective absolute tolerance for accepting an option as the verified answer.
function matchTolFor(truth, override) {
  let rel = REL_TOL;
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    rel = Math.min(override, TOL_MAX_REL);
  }
  return Math.max(MATCH_TOL, Math.abs(truth) * rel);
}

// ── Safe expression evaluator ──
// Evaluates a small arithmetic grammar over named numeric variables WITHOUT eval
// or Function. Supports: numbers, identifiers (vars / the constant `pi` / unary
// functions), operators + - * / ^ (^ right-associative), parentheses. Whitelisted
// functions: sqrt cbrt sin cos tan abs. Trig takes DEGREES (GCSE convention).
// Any unexpected character, unknown identifier, or arity error throws → the caller
// treats the question as unverifiable and rejects it (fail-closed).
const FUNCS = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  sin:  (d) => Math.sin((d * Math.PI) / 180),
  cos:  (d) => Math.cos((d * Math.PI) / 180),
  tan:  (d) => Math.tan((d * Math.PI) / 180),
  abs:  Math.abs,
};
const PRECEDENCE = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 };

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (c >= "0" && c <= "9" || c === ".") {
      let j = i + 1;
      while (j < expr.length && (expr[j] >= "0" && expr[j] <= "9" || expr[j] === ".")) j++;
      tokens.push({ t: "num", v: parseFloat(expr.slice(i, j)) });
      i = j;
      continue;
    }
    if (c >= "a" && c <= "z" || c >= "A" && c <= "Z" || c === "_") {
      let j = i + 1;
      while (j < expr.length && (/[A-Za-z0-9_]/).test(expr[j])) j++;
      tokens.push({ t: "id", v: expr.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/^()".includes(c)) {
      tokens.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`bad character "${c}" in expression`);
  }
  return tokens;
}

// Shunting-yard → RPN. Handles unary minus, function calls, right-assoc `^`.
function toRPN(tokens) {
  const out = [];
  const stack = [];
  let prev = null; // previous token, to detect unary minus
  for (const tok of tokens) {
    if (tok.t === "num") {
      out.push(tok);
    } else if (tok.t === "id") {
      if (Object.prototype.hasOwnProperty.call(FUNCS, tok.v)) {
        stack.push({ t: "func", v: tok.v });
      } else {
        out.push(tok); // variable or constant (resolved at eval time)
      }
    } else if (tok.v === "(") {
      stack.push(tok);
    } else if (tok.v === ")") {
      while (stack.length && stack[stack.length - 1].v !== "(") out.push(stack.pop());
      if (!stack.length) throw new Error("mismatched parentheses");
      stack.pop(); // discard "("
      if (stack.length && stack[stack.length - 1].t === "func") out.push(stack.pop());
    } else { // operator
      // Unary minus: a "-" at the start, after another operator, or after "(".
      const isUnary = tok.v === "-" &&
        (prev === null || (prev.t === "op" && prev.v !== ")"));
      if (isUnary) {
        out.push({ t: "num", v: 0 }); // rewrite -x as (0 - x)
      }
      const o1 = tok.v;
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.t === "func") { out.push(stack.pop()); continue; }
        if (top.t !== "op" || top.v === "(") break;
        const o2 = top.v;
        const leftAssoc = o1 !== "^";
        if ((leftAssoc && PRECEDENCE[o1] <= PRECEDENCE[o2]) ||
            (!leftAssoc && PRECEDENCE[o1] < PRECEDENCE[o2])) {
          out.push(stack.pop());
        } else break;
      }
      stack.push(tok);
    }
    prev = tok;
  }
  while (stack.length) {
    const top = stack.pop();
    if (top.v === "(" || top.v === ")") throw new Error("mismatched parentheses");
    out.push(top);
  }
  return out;
}

function evalRPN(rpn, vars) {
  const st = [];
  for (const tok of rpn) {
    if (tok.t === "num") {
      st.push(tok.v);
    } else if (tok.t === "id") {
      if (tok.v === "pi") { st.push(Math.PI); continue; }
      if (!Object.prototype.hasOwnProperty.call(vars, tok.v)) {
        throw new Error(`unknown variable "${tok.v}"`);
      }
      const val = vars[tok.v];
      if (typeof val !== "number" || !Number.isFinite(val)) {
        throw new Error(`variable "${tok.v}" is not a finite number`);
      }
      st.push(val);
    } else if (tok.t === "func") {
      if (!st.length) throw new Error(`function "${tok.v}" missing argument`);
      st.push(FUNCS[tok.v](st.pop()));
    } else { // operator
      if (st.length < 2) throw new Error(`operator "${tok.v}" missing operand`);
      const b = st.pop(), a = st.pop();
      switch (tok.v) {
        case "+": st.push(a + b); break;
        case "-": st.push(a - b); break;
        case "*": st.push(a * b); break;
        case "/": st.push(b === 0 ? NaN : a / b); break;
        case "^": st.push(Math.pow(a, b)); break;
        default: throw new Error(`unknown operator "${tok.v}"`);
      }
    }
  }
  if (st.length !== 1) throw new Error("malformed expression");
  return st[0];
}

// Returns a finite number, or null if the expression is unverifiable.
function safeEval(expr, vars) {
  if (typeof expr !== "string" || !expr.trim()) return null;
  const v = (vars && typeof vars === "object") ? vars : {};
  const r = evalRPN(toRPN(tokenize(expr)), v);
  return Number.isFinite(r) ? r : null;
}

// ── Chemistry formula / equation parsing (equation_balance) ──
// parseFormula("Ca(OH)2") → { Ca:1, O:2, H:2 }. Handles multi-letter elements,
// subscripts and nested parenthesised groups. Throws on malformed input.
function parseFormula(str) {
  const counts = {};
  let i = 0;
  function parseGroup() {
    const local = {};
    while (i < str.length) {
      const c = str[i];
      if (c === "(") {
        i++;
        const inner = parseGroup();
        if (str[i] !== ")") throw new Error("mismatched () in formula");
        i++;
        let n = readNumber();
        if (n === null) n = 1;
        for (const [el, k] of Object.entries(inner)) local[el] = (local[el] || 0) + k * n;
      } else if (c === ")") {
        break;
      } else if (c >= "A" && c <= "Z") {
        let el = c;
        i++;
        while (i < str.length && str[i] >= "a" && str[i] <= "z") { el += str[i]; i++; }
        let n = readNumber();
        if (n === null) n = 1;
        local[el] = (local[el] || 0) + n;
      } else {
        throw new Error(`bad character "${c}" in formula`);
      }
    }
    return local;
  }
  function readNumber() {
    let j = i;
    while (j < str.length && str[j] >= "0" && str[j] <= "9") j++;
    if (j === i) return null;
    const n = parseInt(str.slice(i, j), 10);
    i = j;
    return n;
  }
  const top = parseGroup();
  if (i !== str.length) throw new Error("trailing characters in formula");
  for (const [el, k] of Object.entries(top)) counts[el] = (counts[el] || 0) + k;
  return counts;
}

// Parse one side ("2 H2 + O2") into [{coef, counts}]. A leading integer is the
// stoichiometric coefficient; the rest is a formula.
function parseSide(side) {
  return side.split("+").map((termRaw) => {
    const term = termRaw.trim();
    if (!term) throw new Error("empty term in equation");
    const m = term.match(/^(\d+)\s*(.+)$/);
    let coef = 1, formula = term;
    if (m) { coef = parseInt(m[1], 10); formula = m[2].trim(); }
    return { coef, counts: parseFormula(formula.replace(/\s+/g, "")) };
  });
}

// parseEquation("2 H2 + O2 -> 2 H2O") → { left:[...], right:[...] }.
function parseEquation(eq) {
  const parts = eq.split(/->|=|→/);
  if (parts.length !== 2) throw new Error("equation needs exactly one arrow");
  return { left: parseSide(parts[0]), right: parseSide(parts[1]) };
}

// True iff every element's Σ(coef×count) matches on both sides (and ≥1 atom).
function balances(eq) {
  const tally = (terms, sign) => {
    const t = {};
    for (const { coef, counts } of terms) {
      for (const [el, k] of Object.entries(counts)) t[el] = (t[el] || 0) + sign * coef * k;
    }
    return t;
  };
  const net = tally(eq.left, 1);
  const right = tally(eq.right, -1);
  for (const [el, k] of Object.entries(right)) net[el] = (net[el] || 0) + k;
  let totalAtoms = 0;
  for (const { coef, counts } of eq.left) {
    for (const k of Object.values(counts)) totalAtoms += coef * k;
  }
  if (totalAtoms <= 0) return false;
  return Object.values(net).every((v) => Math.abs(v) < EPS);
}

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

// Match a COMPUTED numeric truth (formula / solve_for) to one of the options.
// Uses the relative tolerance (matchTolFor) for irrational/rounded answers and a
// second-match guard: if a second option also falls within tolerance the question
// has two acceptable answers → reject. Only for computed truths — selection ops
// (largest/closest_to/…) keep their own exact matching, where close-but-distinct
// options like 0.6 and 0.605 are legitimate and the op already guarantees a winner.
function resolveTruthToOption(q, truth, tolOverride) {
  const tol = matchTolFor(truth, tolOverride);
  const vals = q.o.map(optionValue);
  let match = -1, matchDist = Infinity, secondDist = Infinity;
  vals.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) return;
    const d = Math.abs(v - truth);
    if (d < matchDist) { secondDist = matchDist; matchDist = d; match = i; }
    else if (d < secondDist) { secondDist = d; }
  });
  if (match < 0 || matchDist > tol) {
    return { ...q, _computeFailed: true,
      _computeReason: `verified answer ${truth} is not one of the four options` };
  }
  if (secondDist <= tol) {
    return { ...q, _computeFailed: true,
      _computeReason: `two options match the verified answer ${truth} within tolerance — question is ambiguous` };
  }
  if (match !== q.c) {
    return { ...q, c: match, _computeCorrected: true, _computeTruth: truth };
  }
  return { ...q, _computeVerified: true, _computeTruth: truth };
}

// formula op — evaluate a safe expression over named numeric vars (multi-step
// GCSE calculations: Pythagoras, compound interest, area, speed, trig …).
function verifyFormula(q, cb) {
  if (typeof cb.expr !== "string" || !cb.expr.trim()) {
    return { ...q, _computeFailed: true, _computeReason: `formula op requires a string "expr"` };
  }
  if (!cb.vars || typeof cb.vars !== "object" || Array.isArray(cb.vars) ||
      !Object.values(cb.vars).every((n) => typeof n === "number" && Number.isFinite(n))) {
    return { ...q, _computeFailed: true, _computeReason: `formula op requires "vars" of finite numbers` };
  }
  let truth;
  try {
    truth = safeEval(cb.expr, cb.vars);
  } catch (e) {
    return { ...q, _computeFailed: true, _computeReason: `formula error: ${e.message}` };
  }
  if (truth === null) {
    return { ...q, _computeFailed: true,
      _computeReason: `formula "${cb.expr}" is undefined for the given vars` };
  }
  return resolveTruthToOption(q, truth, cb.tol);
}

// solve_for — algebra by substitution. Substitute each candidate (defaults to the
// option values) into lhs/rhs; survivors satisfy lhs ≈ rhs. Exactly one survivor →
// truth; zero or ≥2 → reject (the quadratic-with-both-roots-as-options trap).
function verifySolveFor(q, cb) {
  if (typeof cb.var !== "string" || !cb.var ||
      typeof cb.lhs !== "string" || typeof cb.rhs !== "string") {
    return { ...q, _computeFailed: true,
      _computeReason: `solve_for requires string "var", "lhs" and "rhs"` };
  }
  let candidates = cb.candidates;
  if (!Array.isArray(candidates) || !candidates.length) candidates = q.o.map(optionValue);
  const survivors = [];
  for (const cand of candidates) {
    if (typeof cand !== "number" || !Number.isFinite(cand)) continue;
    let l, r;
    try {
      l = safeEval(cb.lhs, { [cb.var]: cand });
      r = safeEval(cb.rhs, { [cb.var]: cand });
    } catch (e) {
      return { ...q, _computeFailed: true, _computeReason: `solve_for error: ${e.message}` };
    }
    if (l === null || r === null) continue;
    const scale = Math.max(1, Math.abs(l), Math.abs(r));
    if (Math.abs(l - r) <= scale * REL_TOL) survivors.push(cand);
  }
  if (survivors.length === 0) {
    return { ...q, _computeFailed: true,
      _computeReason: `no option satisfies ${cb.lhs} = ${cb.rhs}` };
  }
  if (survivors.length > 1) {
    return { ...q, _computeFailed: true,
      _computeReason: `multiple options satisfy ${cb.lhs} = ${cb.rhs} — question is ambiguous` };
  }
  return resolveTruthToOption(q, survivors[0], cb.tol);
}

// ── Money parsing (coin_match, DEF-054) ──
// Sum every money token in an option string, normalised to PENCE.
//   "5p + 5p"   → 5 + 5   = 10
//   "£2 + £1"   → 200+100 = 300
//   "£1 + 50p"  → 100+50  = 150
// Returns null if the string contains NO money token (prose / unparseable option
// → the caller fails closed and rejects the whole question). This verifies the
// option text the child actually sees — there is no separate structured breakdown
// the generator could diverge from.
function optionPenceTotal(opt) {
  if (typeof opt !== "string") return null;
  const s = opt.replace(/,/g, "");
  let total = 0, found = false;
  // Pound amounts first (optional decimal) → ×100 pence.
  let m;
  const pounds = /£\s*(\d+(?:\.\d+)?)/g;
  while ((m = pounds.exec(s)) !== null) { total += Math.round(parseFloat(m[1]) * 100); found = true; }
  // Strip the pound amounts so their digits can't be re-read as pence, then sum
  // pence tokens: a number immediately followed by "p" at a word boundary
  // ("5p", "50p coin" → yes; "5 pence" → no, by design — options must use "Np").
  const sNoPounds = s.replace(/£\s*\d+(?:\.\d+)?/g, " ");
  const pence = /(\d+(?:\.\d+)?)\s*p\b/g;
  while ((m = pence.exec(sNoPounds)) !== null) { total += parseFloat(m[1]); found = true; }
  return found ? total : null;
}

// coin_match — "which coins/notes make / total / also make <amount>?" questions.
// Each option is itself a sum of coins/notes; the answer is the single option whose
// total equals cb.target (in pence). Verifies the displayed option text directly
// (optionPenceTotal), never the model's c/e. Fail-closed: an unparseable option,
// zero matches, or ≥2 matches → reject (same contract as the other ops).
function verifyCoinMatch(q, cb) {
  if (typeof cb.target !== "number" || !Number.isFinite(cb.target)) {
    return { ...q, _computeFailed: true,
      _computeReason: `coin_match requires a numeric "target" (amount in pence)` };
  }
  if (!Array.isArray(q.o) || q.o.length < 2) {
    return { ...q, _computeFailed: true, _computeReason: `coin_match needs at least two options` };
  }
  const totals = q.o.map(optionPenceTotal);
  if (totals.some((t) => t === null)) {
    return { ...q, _computeFailed: true,
      _computeReason: `coin_match: an option has no parseable coin/note value (options must be plain coin sums, e.g. "5p + 5p")` };
  }
  const matches = [];
  totals.forEach((t, i) => { if (Math.abs(t - cb.target) <= EPS) matches.push(i); });
  if (matches.length === 0) {
    return { ...q, _computeFailed: true,
      _computeReason: `coin_match: no option totals ${cb.target}p` };
  }
  if (matches.length > 1) {
    return { ...q, _computeFailed: true,
      _computeReason: `coin_match: ${matches.length} options total ${cb.target}p — question is ambiguous` };
  }
  const match = matches[0];
  if (match !== q.c) {
    return { ...q, c: match, _computeCorrected: true, _computeTruth: cb.target };
  }
  return { ...q, _computeVerified: true, _computeTruth: cb.target };
}

// equation_balance — atom-conservation check for chemistry balancing questions.
// Two sub-modes:
//   A (coefficient): cb.equation carries a "?" placeholder for the asked coefficient;
//      substitute each option value, the single balancing value is the answer.
//   B (which-equation): each option is itself a full equation string; the single
//      one that balances is the answer (used when cb.equation is absent).
function verifyEquationBalance(q) {
  const cb = q.compute;
  const settle = (match, count) => {
    if (count !== 1) {
      return { ...q, _computeFailed: true, _computeReason:
        count === 0 ? `no option balances the equation`
                    : `${count} options balance — question is ambiguous` };
    }
    if (match !== q.c) return { ...q, c: match, _computeCorrected: true };
    return { ...q, _computeVerified: true };
  };

  // Mode B — options are equations.
  if (typeof cb.equation !== "string") {
    let match = -1, count = 0;
    q.o.forEach((opt, i) => {
      let ok = false;
      try { ok = balances(parseEquation(String(opt))); } catch (e) { ok = false; }
      if (ok) { count++; if (match < 0) match = i; }
    });
    return settle(match, count);
  }

  // Mode A — coefficient placeholder.
  if (!cb.equation.includes("?")) {
    return { ...q, _computeFailed: true, _computeReason:
      `equation_balance needs a "?" coefficient placeholder, or options that are full equations` };
  }
  const vals = q.o.map(optionValue);
  let match = -1, count = 0;
  vals.forEach((v, i) => {
    if (v === null || !Number.isInteger(v) || v <= 0) return;
    let ok = false;
    try { ok = balances(parseEquation(cb.equation.replace(/\?/g, String(v)))); }
    catch (e) { ok = false; }
    if (ok) { count++; if (match < 0) match = i; }
  });
  return settle(match, count);
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

    // STEP 2a — chemistry equation balancing. Verified only when a compute block is
    // present; a bare equation_balance tag still passes through to the audit agent
    // (fail-open preserved for in-flight content lacking a compute block).
    if (q.verify === "equation_balance") {
      return (q.compute && typeof q.compute === "object") ? verifyEquationBalance(q) : q;
    }

    // STEP 2b — arithmetic verification only. verify:"none" passes through; its
    // answer correctness is owned by the audit agent.
    if (q.verify !== "arithmetic") return q;

    const cb = q.compute;
    if (!cb || typeof cb !== "object") {
      return { ...q, _computeFailed: true, _computeReason: `missing or invalid compute block` };
    }

    // Expression-based ops branch BEFORE the legacy inputs-array validation.
    if (cb.op === "formula") return verifyFormula(q, cb);
    if (cb.op === "solve_for") return verifySolveFor(q, cb);
    // coin_match parses the option TEXT (not a numeric inputs array), so it also
    // branches before the legacy inputs-array validation (DEF-054).
    if (cb.op === "coin_match") return verifyCoinMatch(q, cb);

    // ── Legacy single-op path (sum…equal_to) — matching logic unchanged ──
    if (!KNOWN_OPS.has(cb.op) ||
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

module.exports = {
  computeVerify, OPS, KNOWN_OPS, optionValue, duplicateOptionReason,
  optionPenceTotal, safeEval, parseFormula, parseEquation, balances,
};
