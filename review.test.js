// BrightMind V2 — Tester: review merge logic (CR-016)
// Run: node review.test.js
// Covers the pure audit+child merge (applyReview) and the payload shaper
// (buildReviewQuestions) with synthetic model results — no network.
const { buildReviewQuestions, applyReview } = require("./review");

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}

// ── 1. Both roles pass → question unchanged ──
{
  const q = { q: "2+2?", o: ["3", "4", "5", "6"], c: 1, e: "It is 4." };
  const [r] = applyReview([q], [{ i: 0, audit: { pass: true }, child: { pass: true } }]);
  check("both pass: unchanged object", r === q);
  check("both pass: no failure flags", !r._auditFailed && !r._childFailed && !r._auditRewritten);
}

// ── 2. Audit fail + valid rewrite → fields replaced, svg + subtopic preserved ──
{
  const q = { q: "old", o: ["a", "b", "c", "d"], c: 0, e: "old e", svg: "<svg/>", subtopic: "Expanding double brackets" };
  const rewrite = { q: "new", o: ["w", "x", "y", "z"], c: 2, e: "new e" };
  const [r] = applyReview([q], [{ i: 0, audit: { pass: false, reason: "x", rewrite }, child: { pass: true } }]);
  check("rewrite: q replaced", r.q === "new" && r.c === 2);
  check("rewrite: _auditRewritten set", r._auditRewritten === true);
  check("rewrite: svg preserved", r.svg === "<svg/>");
  check("rewrite: subtopic preserved", r.subtopic === "Expanding double brackets");
  check("rewrite: not marked failed", !r._auditFailed);
}

// ── 2b. Pass-through preserves subtopic ──
{
  const q = { q: "q", o: ["a", "b", "c", "d"], c: 0, e: "e", subtopic: "Substitution" };
  const [r] = applyReview([q], [{ i: 0, audit: { pass: true }, child: { pass: true } }]);
  check("passthrough: subtopic preserved", r.subtopic === "Substitution");
}

// ── 2c. CR-022 (cont.): audit rewrite preserves the 2D coverage tags ──
{
  const q = { q: "old", o: ["a", "b", "c", "d"], c: 0, e: "e", subStrand: "Substitution", depth: "reasoning", subtopic: "Substitution" };
  const rewrite = { q: "new", o: ["w", "x", "y", "z"], c: 1, e: "ne" };
  const [r] = applyReview([q], [{ i: 0, audit: { pass: false, rewrite }, child: { pass: true } }]);
  check("rewrite: subStrand preserved", r.subStrand === "Substitution");
  check("rewrite: depth preserved", r.depth === "reasoning");
}

// ── 2d. Pass-through preserves the 2D tags ──
{
  const q = { q: "q", o: ["a", "b", "c", "d"], c: 0, e: "e", subStrand: "Simplifying", depth: "procedure" };
  const [r] = applyReview([q], [{ i: 0, audit: { pass: true }, child: { pass: true } }]);
  check("passthrough: subStrand + depth preserved", r.subStrand === "Simplifying" && r.depth === "procedure");
}

// ── 2b. Audit rewrite missing e → defaults to original e ──
{
  const q = { q: "old", o: ["a", "b", "c", "d"], c: 0, e: "keep me" };
  const rewrite = { q: "new", o: ["w", "x", "y", "z"], c: 1 };
  const [r] = applyReview([q], [{ i: 0, audit: { pass: false, rewrite }, child: { pass: true } }]);
  check("rewrite: e defaults to original", r.e === "keep me");
}

// ── 3. Rewrite changing c on a compute-verified question → c kept ──
{
  const q = { q: "range?", o: ["33", "40", "45", "78"], c: 1, e: "40", _computeVerified: true };
  const rewrite = { q: "range?", o: ["33", "40", "45", "78"], c: 0, e: "33" }; // tries to move c
  const [r] = applyReview([q], [{ i: 0, audit: { pass: false, rewrite }, child: { pass: true } }]);
  check("compute guard: c stays 1", r.c === 1);
  check("compute guard: _auditCFixedToCompute flagged", r._auditCFixedToCompute === true);
}

// ── 3b. Same guard for _computeCorrected ──
{
  const q = { q: "x", o: ["1", "2", "3", "4"], c: 3, e: "4", _computeCorrected: true };
  const rewrite = { q: "x2", o: ["1", "2", "3", "4"], c: 0, e: "1" };
  const [r] = applyReview([q], [{ i: 0, audit: { pass: false, rewrite }, child: { pass: true } }]);
  check("compute guard (corrected): c stays 3", r.c === 3 && r._auditCFixedToCompute === true);
}

// ── 4. Audit fail, no rewrite → _auditFailed + reason ──
{
  const q = { q: "bad", o: ["a", "b", "c", "d"], c: 0, e: "" };
  const [r] = applyReview([q], [{ i: 0, audit: { pass: false, reason: "near-duplicate of question 2" }, child: { pass: true } }]);
  check("audit drop: _auditFailed set", r._auditFailed === true);
  check("audit drop: reason captured", r._auditReason === "near-duplicate of question 2");
}

// ── 5. Child flag on an audit-passed question → _childFailed + reason ──
{
  const q = { q: "hard word", o: ["a", "b", "c", "d"], c: 0, e: "" };
  const [r] = applyReview([q], [{ i: 0, audit: { pass: true }, child: { pass: false, reason: "I don't understand 'asymptote'" } }]);
  check("child flag: _childFailed set", r._childFailed === true);
  check("child flag: reason captured", r._childReason === "I don't understand 'asymptote'");
}

// ── 5b. Child flag also applies to an audit-rewritten (still passing) question ──
{
  const q = { q: "old", o: ["a", "b", "c", "d"], c: 0, e: "e" };
  const rewrite = { q: "new", o: ["w", "x", "y", "z"], c: 1, e: "ne" };
  const [r] = applyReview([q], [{ i: 0, audit: { pass: false, rewrite }, child: { pass: false, reason: "confusing" } }]);
  check("rewrite+child: rewritten and child-flagged", r._auditRewritten === true && r._childFailed === true);
}

// ── 6. Child verdict NOT applied when audit failed (no double-drop) ──
{
  const q = { q: "bad", o: ["a", "b", "c", "d"], c: 0, e: "" };
  const [r] = applyReview([q], [{ i: 0, audit: { pass: false, reason: "wrong answer" }, child: { pass: false, reason: "confusing" } }]);
  check("audit-fail wins: _auditFailed set", r._auditFailed === true);
  check("audit-fail wins: _childFailed NOT set", r._childFailed === undefined);
}

// ── 7. Missing result for an index → unchanged (fail-open) ──
{
  const a = { q: "q0", o: ["a", "b", "c", "d"], c: 0, e: "" };
  const b = { q: "q1", o: ["a", "b", "c", "d"], c: 1, e: "" };
  const out = applyReview([a, b], [{ i: 0, audit: { pass: true }, child: { pass: true } }]); // no result for i=1
  check("missing result: i=1 unchanged", out[1] === b && !out[1]._auditFailed && !out[1]._childFailed);
}

// ── 7b. Null/empty results array → all pass through unchanged ──
{
  const q = { q: "q", o: ["a", "b", "c", "d"], c: 0, e: "" };
  const [r1] = applyReview([q], null);
  const [r2] = applyReview([q], []);
  check("null results: unchanged", r1 === q);
  check("empty results: unchanged", r2 === q);
}

// ── 8. buildReviewQuestions emits the union shape ──
{
  const qs = [
    { q: "with diagram", o: ["a", "b", "c", "d"], c: 2, e: "exp", svg: "<svg/>", diagramPrompt: "draw a triangle", _computeVerified: true },
    { q: "plain", o: ["w", "x", "y", "z"], c: 0, e: "exp2" },
  ];
  const payload = buildReviewQuestions(qs);
  check("payload: index assigned", payload[0].i === 0 && payload[1].i === 1);
  check("payload: hasDiagram from svg", payload[0].hasDiagram === true && payload[1].hasDiagram === false);
  check("payload: diagramPrompt carried", payload[0].diagramPrompt === "draw a triangle");
  check("payload: diagramPrompt null when absent", payload[1].diagramPrompt === null);
  check("payload: computeVerified true via _computeVerified", payload[0].computeVerified === true);
  check("payload: computeVerified false when unset", payload[1].computeVerified === false);
  check("payload: carries c and e for auditor", payload[0].c === 2 && payload[0].e === "exp");
}

// ── 8b. computeVerified true via _computeCorrected ──
{
  const [p] = buildReviewQuestions([{ q: "x", o: ["1", "2", "3", "4"], c: 0, e: "", _computeCorrected: true }]);
  check("payload: computeVerified true via _computeCorrected", p.computeVerified === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
