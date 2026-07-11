// BrightMind — Tester: coverage matrix + mastery model (CR-022 cont.)
// Run: node coverage.test.js
// Pure, synchronous, no network. Includes the two SPEC-MANDATED tests:
//   (1) a child with one 100% tutorial shows untested cells, NOT "mastered";
//   (2) given a matrix with known gaps, the width-adaptive guidance targets the gap cells.
const {
  buildCoverageMatrix, gridStatus, untestedCells, recommendation, buildCoverageTargetGuidance, agreementStats,
} = require("./coverage");

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}

const curObj = {
  payload: { sub_strands: [
    { name: "Substitution" },
    { name: "Simplifying (collecting like terms)" },
  ] },
};

// ── buildCoverageMatrix ──
{
  const results = [{
    answers: [
      { subStrand: "Substitution", depth: "recall", selected: 1, correct: 1 },
      { subStrand: "Substitution", depth: "recall", selected: 0, correct: 1 },
      { subStrand: "Substitution", depth: "procedure", selected: 2, correct: 2 },
      { subStrand: "Simplifying (collecting like terms)", depth: "Application", selected: 1, correct: 1 }, // mixed case
    ],
  }];
  const m = buildCoverageMatrix(results);
  check("matrix: aggregates attempts per cell", m.cells["Substitution"].recall.attempts === 2);
  check("matrix: counts correct per cell", m.cells["Substitution"].recall.correct === 1);
  check("matrix: normalises depth case", !!m.cells["Simplifying (collecting like terms)"].application);
  check("matrix: observedSubStrands lists both", m.observedSubStrands.length === 2);
}

// ── DEF-053: topic-scoped matrix (no cross-topic sub-strand leak) ──
{
  const results = [
    { topics: ["Angles Introduction"], answers: [{ subStrand: "Acute vs obtuse", depth: "recall", selected: 1, correct: 1 }] },
    { topics: ["Tally Charts"],        answers: [{ subStrand: "Reading tally marks", depth: "recall", selected: 1, correct: 1 }] },
    { topics: ["Place Value", "Counting"], answers: [{ subStrand: "Comparing data in tally charts", depth: "application", selected: 0, correct: 1 }] },
  ];
  const scoped = buildCoverageMatrix(results, ["Angles Introduction"]);
  check("def053: topic filter keeps only matching-topic rows", scoped.observedSubStrands.length === 1 && scoped.observedSubStrands[0] === "Acute vs obtuse");
  check("def053: topic filter excludes other-topic sub-strands", !scoped.cells["Reading tally marks"] && !scoped.cells["Comparing data in tally charts"]);

  const none = buildCoverageMatrix(results, ["3D Shapes"]);
  check("def053: no matching topic → empty matrix", none.observedSubStrands.length === 0);

  const legacy = buildCoverageMatrix(results); // no topics arg → aggregate all (unchanged)
  check("def053: no topics arg aggregates every row (legacy)", legacy.observedSubStrands.length === 3);

  // a row without a topics field is skipped when filtering, never crashes
  const noTopicField = buildCoverageMatrix([{ answers: [{ subStrand: "X", depth: "recall", selected: 1, correct: 1 }] }], ["Angles Introduction"]);
  check("def053: row missing topics is skipped under filter", noTopicField.observedSubStrands.length === 0);
}

// ── DEF-053: steering is authoritative-only (self-enumerated topic → no steer) ──
{
  // A matrix with real observed gaps but NO approved curriculum object must NOT steer —
  // this is the exact leak: observed sub-strands from other topics would otherwise be
  // injected as targets and override the requested topic.
  const m = buildCoverageMatrix([{ topics: ["Tally Charts"], answers: [
    { subStrand: "Reading tally marks", depth: "recall", selected: 1, correct: 1 },
  ] }]);
  check("def053: no curriculum object → no steering block", buildCoverageTargetGuidance(m, null) === "");
  check("def053: empty-sub_strands object → no steering block", buildCoverageTargetGuidance(m, { payload: { sub_strands: [] } }) === "");
  // With an authoritative object the block is still produced (steering preserved).
  check("def053: authoritative object still steers", buildCoverageTargetGuidance(m, curObj).length > 0);
}

// ── untagged + unknown-depth handling (DEF-049 invariant) ──
{
  const results = [{
    answers: [
      { subtopic: "Substitution", selected: 1, correct: 1 },          // legacy: no subStrand → skipped
      { subStrand: "Substitution", depth: "made_up", selected: 1, correct: 1 }, // unknown depth
      { subStrand: "Substitution", selected: 1, correct: 1 },          // no depth
    ],
  }];
  const m = buildCoverageMatrix(results);
  check("matrix: legacy untagged answer is skipped", !m.cells["Substitution"] || !m.cells["Substitution"].recall);
  check("matrix: unknown/absent depth bucketed under (unknown)", m.cells["Substitution"]["(unknown)"].attempts === 2);
}

// ── SPEC TEST 1: one 100%-recall tutorial → untested cells, NOT mastered ──
{
  const results = [{
    answers: [
      { subStrand: "Substitution", depth: "recall", selected: 1, correct: 1 },
      { subStrand: "Substitution", depth: "recall", selected: 2, correct: 2 },
      { subStrand: "Simplifying (collecting like terms)", depth: "recall", selected: 0, correct: 0 },
    ],
  }];
  const m = buildCoverageMatrix(results);
  const g = gridStatus(m, curObj);
  check("spec1: grid is sub_strands × 4 depth bands", g.cells.length === 8);
  check("spec1: recall cells that were answered are strong",
    g.cells.find(c => c.subStrand === "Substitution" && c.depth === "recall").status === "strong");
  check("spec1: application is untested",
    g.cells.find(c => c.subStrand === "Substitution" && c.depth === "application").status === "untested");
  check("spec1: reasoning is untested",
    g.cells.find(c => c.subStrand === "Substitution" && c.depth === "reasoning").status === "untested");
  check("spec1: NOT reported as mastered", g.mastered === false);
}

// ── weak vs strong threshold ──
{
  const results = [{
    answers: [
      { subStrand: "Substitution", depth: "procedure", selected: 0, correct: 1 },
      { subStrand: "Substitution", depth: "procedure", selected: 0, correct: 1 },
      { subStrand: "Substitution", depth: "procedure", selected: 1, correct: 1 }, // 1/3 correct → weak
    ],
  }];
  const g = gridStatus(buildCoverageMatrix(results), curObj);
  check("weak: low-score cell marked weak",
    g.cells.find(c => c.subStrand === "Substitution" && c.depth === "procedure").status === "weak");
  const g2 = gridStatus(buildCoverageMatrix(results), curObj, { weakPct: 0.2 });
  check("weak: threshold dial respected (0.2 → strong)",
    g2.cells.find(c => c.subStrand === "Substitution" && c.depth === "procedure").status === "strong");
}

// ── untestedCells ──
{
  const m = buildCoverageMatrix([{ answers: [{ subStrand: "Substitution", depth: "recall", selected: 1, correct: 1 }] }]);
  const gaps = untestedCells(m, curObj);
  check("untested: lists every never-practised cell", gaps.length === 7); // 8 total − 1 answered
  check("untested: each gap has subStrand + depth", gaps.every(c => c.subStrand && c.depth));
}

// ── recommendation (gated phrasing) ──
{
  // No curriculum AND no observed data → genuinely no grid → "no data" line.
  check("rec: no data message when nothing to show",
    /no coverage data/i.test(recommendation(buildCoverageMatrix([]), null)));
  // With an approved curriculum but no results, every cell is untested (NOT "no data").
  check("rec: empty results + curriculum → names gaps, not 'no data'",
    !/no coverage data/i.test(recommendation(buildCoverageMatrix([]), curObj, { confident: true })));

  const m = buildCoverageMatrix([{ answers: [{ subStrand: "Substitution", depth: "recall", selected: 1, correct: 1 }] }]);
  const confident = recommendation(m, curObj, { confident: true });
  check("rec: confident names a gap sub-strand", /Simplifying|Substitution/.test(confident));
  check("rec: confident estimates tutorials before mastery", /mastery/i.test(confident));

  const observed = recommendation(m, curObj, { confident: false });
  check("rec: observed phrasing avoids a mastery verdict", !/before mastery/i.test(observed) && /practis/i.test(observed));

  // Full coverage → mastered phrasing only when confident.
  const full = buildCoverageMatrix([{ answers: curObj.payload.sub_strands.flatMap(s =>
    ["recall", "procedure", "application", "reasoning"].map(d => ({ subStrand: s.name, depth: d, selected: 1, correct: 1 }))) }]);
  check("rec: full coverage reads mastered when confident", /mastered/i.test(recommendation(full, curObj, { confident: true })));
}

// ── SPEC TEST 2 + buildCoverageTargetGuidance ──
{
  check("driver: empty string when no matrix", buildCoverageTargetGuidance(null, curObj) === "");
  check("driver: empty string when no gaps",
    buildCoverageTargetGuidance(
      buildCoverageMatrix([{ answers: curObj.payload.sub_strands.flatMap(s =>
        ["recall", "procedure", "application", "reasoning"].map(d => ({ subStrand: s.name, depth: d, selected: 1, correct: 1 }))) }]),
      curObj) === "");

  // Known gaps: only Substitution/recall practised → guidance must name the untested cells.
  const m = buildCoverageMatrix([{ answers: [{ subStrand: "Substitution", depth: "recall", selected: 1, correct: 1 }] }]);
  const block = buildCoverageTargetGuidance(m, curObj);
  check("spec2: guidance is non-empty for a gap matrix", block.length > 0);
  check("spec2: guidance targets the gap cell (Substitution / reasoning)", /Substitution \/ reasoning/.test(block));
  check("spec2: guidance targets an untested width gap (Simplifying)", /Simplifying \(collecting like terms\) \/ recall/.test(block));
  check("spec2: guidance is a soft steer (prioritise), not a hard gate", /prioritise/i.test(block) && !/only these/i.test(block));
  check("spec2: guidance states depth and difficulty are independent", /independent/i.test(block));

  // Weak cells surface as a retest line.
  const mWeak = buildCoverageMatrix([{ answers: [
    { subStrand: "Substitution", depth: "procedure", selected: 0, correct: 1 },
    { subStrand: "Substitution", depth: "procedure", selected: 0, correct: 1 },
  ] }]);
  check("driver: weak cell appears as a retest target", /Weak/.test(buildCoverageTargetGuidance(mWeak, curObj)));
}

// ── Fallback: no curriculum object → grid from observed sub-strands (no crash) ──
{
  const m = buildCoverageMatrix([{ answers: [{ subStrand: "Some Skill", depth: "recall", selected: 1, correct: 1 }] }]);
  const g = gridStatus(m, null);
  check("fallback: grid built from observed sub-strands", g.subStrands.includes("Some Skill"));
  check("fallback: still 4 depth bands per observed sub-strand", g.cells.length === 4);
  check("fallback: empty results never crash", gridStatus(buildCoverageMatrix([]), null).summary.total === 0);
}

// ── agreementStats (depth-tag reliability core, amendment 2) ──
{
  const s = agreementStats([
    { tagged: "recall", judged: "recall" },
    { tagged: "procedure", judged: "procedure" },
    { tagged: "application", judged: "reasoning" }, // mismatch
    { tagged: "reasoning", judged: "reasoning" },
    { bad: true }, { tagged: "recall" }, // skipped (incomplete)
  ]);
  check("agreement: counts only complete pairs", s.n === 4);
  check("agreement: pct = agree / n", Math.abs(s.pct - 0.75) < 1e-9);
  check("agreement: records the confusion direction", s.confusion["application→reasoning"] === 1);
  check("agreement: empty → pct 0, no crash", agreementStats([]).pct === 0 && agreementStats(null).n === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
