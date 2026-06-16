// BrightMind — CR-022 (cont.): coverage matrix + mastery model (pure logic).
// Dependency-free and unit-testable like compute.js / curriculum.js / review.js.
// Shared by the worker (Slice D width-adaptive driver) and the frontend (Slice B/C
// 2D coverage grid + parent recommendation).
//
// Mastery = coverage × performance × depth. The matrix is a projection over the rows
// already stored in `results.answers[]` — there is NO separate matrix table. Once each
// served question carries `subStrand` + `depth` (Slice A), every completed answer record
// is a tagged (cell, outcome) datum, so the grid is derived on read.
//
// AXIS: depth (recall→procedure→application→reasoning) is orthogonal to Easy/Medium/Hard
// difficulty. The grid is sub_strand × depth; difficulty is within-cell granularity.
//
// INVARIANTS (DEF-049): a NULL/unknown depth counts toward the sub-strand's activity but
// toward NO specific depth cell — so those depth cells stay `untested`. A 100%-recall
// tutorial therefore shows application/reasoning as untested, never "mastered"; a legacy
// row with no depth tag is counted width-only and can never falsely read as mastered.

const { DEPTH_BANDS, normaliseDepth } = require("./curriculum");

// Default weak/strong threshold. Overridable (the worker passes a runtime_config dial).
const DEFAULT_WEAK_PCT = 0.6;

// buildCoverageMatrix — aggregate answer records into per-(subStrand, depth) tallies.
// `results` is an array of result rows, each with an `answers` array of
// { subStrand?, depth?, selected, correct } records. Tolerant of missing fields and of
// pre-CR-022 rows (no subStrand/depth). Returns:
//   { cells: { [subStrand]: { [depth|"(unknown)"]: {attempts, correct} } },
//     observedSubStrands: [...] }
//
// DEF-053: optional `topics` filter. When a non-empty array is passed, only result rows
// whose `topics` intersect it are aggregated — so the matrix (and `observedSubStrands`)
// stay scoped to the requested topic instead of mixing a child's whole history. A result
// row carries the tutorial's `topics`; rows without it are skipped when filtering. No
// `topics` arg → every row counts (legacy behaviour, unchanged).
function buildCoverageMatrix(results, topics) {
  const topicFilter = Array.isArray(topics) && topics.length ? new Set(topics) : null;
  const cells = {};
  for (const r of results || []) {
    if (topicFilter) {
      const rt = Array.isArray(r && r.topics) ? r.topics : [];
      if (!rt.some((t) => topicFilter.has(t))) continue;
    }
    const answers = Array.isArray(r && r.answers) ? r.answers : [];
    for (const a of answers) {
      if (!a) continue;
      const subStrand = typeof a.subStrand === "string" && a.subStrand.trim() ? a.subStrand.trim() : null;
      if (!subStrand) continue; // untagged width → cannot place on the grid
      const depth = normaliseDepth(a.depth) || "(unknown)";
      const correct = a.selected !== undefined && a.correct !== undefined && a.selected === a.correct;
      const row = (cells[subStrand] = cells[subStrand] || {});
      const cell = (row[depth] = row[depth] || { attempts: 0, correct: 0 });
      cell.attempts += 1;
      if (correct) cell.correct += 1;
    }
  }
  return { cells, observedSubStrands: Object.keys(cells) };
}

// Resolve the sub-strand list that forms the grid's denominator: the human-approved
// sub-strands when a curriculum object exists (the full expected width), else the
// sub-strands actually observed (fallback — still a usable grid, just not authoritative).
function gridSubStrands(matrix, curriculumObject) {
  const approved = Array.isArray(curriculumObject?.payload?.sub_strands)
    ? curriculumObject.payload.sub_strands.map((s) => s && s.name).filter(Boolean)
    : [];
  return approved.length ? approved : (matrix.observedSubStrands || []);
}

// gridStatus — project the matrix onto the full (subStrand × DEPTH_BANDS) grid, marking
// each cell untested | weak | strong. Unknown-depth activity does NOT light any depth
// cell (DEF-049 invariant). `weakPct` overridable via runtime_config.
function gridStatus(matrix, curriculumObject, opts = {}) {
  const weakPct = typeof opts.weakPct === "number" ? opts.weakPct : DEFAULT_WEAK_PCT;
  const subStrands = gridSubStrands(matrix, curriculumObject);
  const cellsOut = [];
  let untested = 0, weak = 0, strong = 0;
  for (const subStrand of subStrands) {
    const row = (matrix.cells && matrix.cells[subStrand]) || {};
    for (const depth of DEPTH_BANDS) {
      const c = row[depth] || { attempts: 0, correct: 0 };
      let status;
      if (c.attempts === 0) { status = "untested"; untested++; }
      else if (c.correct / c.attempts < weakPct) { status = "weak"; weak++; }
      else { status = "strong"; strong++; }
      cellsOut.push({ subStrand, depth, status, attempts: c.attempts, correct: c.correct });
    }
  }
  return {
    subStrands,
    depths: DEPTH_BANDS.slice(),
    cells: cellsOut,
    summary: { untested, weak, strong, total: cellsOut.length },
    mastered: cellsOut.length > 0 && untested === 0 && weak === 0,
  };
}

// untestedCells — the gap list (status === "untested"). Bridge to the recommendation
// and the width-adaptive driver.
function untestedCells(matrix, curriculumObject, opts = {}) {
  return gridStatus(matrix, curriculumObject, opts).cells.filter((c) => c.status === "untested");
}

// recommendation — a short parent-facing line driven by the gaps. `confident` (default
// true) controls whether it is phrased as a mastery judgement; the caller sets it false
// when the depth-tag agreement number is below threshold (then we report OBSERVED
// coverage, not mastery — amendment 2). `cellsPerTutorial` is the rough fill rate used to
// estimate tutorials remaining.
function recommendation(matrix, curriculumObject, opts = {}) {
  const confident = opts.confident !== false;
  const cellsPerTutorial = typeof opts.cellsPerTutorial === "number" ? opts.cellsPerTutorial : 6;
  const g = gridStatus(matrix, curriculumObject, opts);
  if (g.summary.total === 0) return "No coverage data yet — complete a tutorial to start the mastery map.";

  const gaps = g.cells.filter((c) => c.status === "untested" || c.status === "weak");
  if (gaps.length === 0) {
    return confident
      ? "Full coverage at every depth — this topic looks mastered."
      : "Every cell has been practised across all depth bands.";
  }

  // Name the worst-affected sub-strands (those with the most untested/weak cells).
  const bySub = {};
  gaps.forEach((c) => { bySub[c.subStrand] = (bySub[c.subStrand] || 0) + 1; });
  const worst = Object.entries(bySub).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([s]) => s);
  const tutorials = Math.max(1, Math.ceil(gaps.length / cellsPerTutorial));
  const worstStr = worst.join(" and ");

  return confident
    ? `${worstStr} ${worst.length > 1 ? "are" : "is"} not yet covered at every depth; about ${tutorials} more tutorial${tutorials > 1 ? "s" : ""} before mastery — difficulty alone won't close these.`
    : `${worstStr} ${worst.length > 1 ? "have" : "has"} cells not yet practised — keep going to build coverage.`;
}

// buildCoverageTargetGuidance — the Slice D steering block injected into question_gen.txt
// as {{coverage_target}}. Soft steer ("prioritise"), never a hard gate. Returns "" when
// there is no matrix/curriculum or no gaps → the prompt is byte-for-byte today's (fallback
// preserved, same contract as curriculum.js buildCurriculumGuidance).
function buildCoverageTargetGuidance(matrix, curriculumObject, opts = {}) {
  if (!matrix || !Array.isArray(matrix.observedSubStrands)) return "";
  // DEF-053: steering must be AUTHORITATIVE-ONLY. Without an approved curriculum object the
  // grid denominator would fall back to the child's observed sub-strands (gridSubStrands) —
  // which span every topic the child has practised, so a different topic's sub-strands leak
  // into this topic's generation prompt and override it. Refuse to steer in that case (the
  // prompt's own self-enumeration takes over). gridStatus/recommendation keep the observed
  // fallback for the parent-facing coverage MAP — only generation steering is gated here.
  const authoritative = Array.isArray(curriculumObject?.payload?.sub_strands) &&
    curriculumObject.payload.sub_strands.some((s) => s && s.name);
  if (!authoritative) return "";
  const g = gridStatus(matrix, curriculumObject, opts);
  const untested = g.cells.filter((c) => c.status === "untested");
  const weak = g.cells.filter((c) => c.status === "weak");
  if (untested.length === 0 && weak.length === 0) return "";

  const fmt = (c) => `${c.subStrand} / ${c.depth}`;
  // Cap the lists so the block stays compact in the prompt.
  const untestedLines = untested.slice(0, 12).map(fmt).join("; ");
  const weakLines = weak.slice(0, 8).map(fmt).join("; ");

  let block = "COVERAGE TARGETING — this child's mastery map for this topic has gaps. " +
    "PRIORITISE questions for the cells below (a cell is sub-strand / depth-band). This steers " +
    "WHICH cell to target; keep each question at the requested difficulty (depth and difficulty " +
    "are independent). Do not ONLY cover these — still spread sensibly — but lead with them:\n";
  if (untestedLines) block += `  Untested (never practised) — cover these first: ${untestedLines}\n`;
  if (weakLines) block += `  Weak (practised but low score) — worth a retest: ${weakLines}\n`;
  return block.trimEnd();
}

// agreementStats — pure core of the depth-tag reliability check (amendment 2). Given
// pairs of { tagged, judged } depth bands (the generator's tag vs an independent
// judgement), return the agreement rate and a confusion count. The operator harness
// (scripts/depth_tag_check.js) supplies the judged values from a second-pass classify
// call; this function — the part worth trusting — is unit-tested. The parent mastery
// recommendation stays OBSERVED (not a mastery verdict) until `pct` clears a threshold.
function agreementStats(pairs) {
  let n = 0, agree = 0;
  const confusion = {}; // "tagged→judged" → count, for mismatches
  for (const p of pairs || []) {
    if (!p || !p.tagged || !p.judged) continue;
    n += 1;
    if (p.tagged === p.judged) agree += 1;
    else {
      const k = `${p.tagged}→${p.judged}`;
      confusion[k] = (confusion[k] || 0) + 1;
    }
  }
  return { n, agree, pct: n ? agree / n : 0, confusion };
}

module.exports = {
  DEFAULT_WEAK_PCT,
  buildCoverageMatrix,
  gridStatus,
  untestedCells,
  recommendation,
  buildCoverageTargetGuidance,
  agreementStats,
};
