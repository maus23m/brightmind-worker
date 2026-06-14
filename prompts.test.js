// BrightMind V2 — Tester: prompt structural checks (DEF-045)
// Run: node prompts.test.js
// Guards the diagram draw-prompt class fix (task 3 of the 5 Jun 2026 handover):
// the diagramPrompt generator must describe a quarter-circle/sector as TWO radii
// meeting at a right angle (not a single diagonal), and the drawing agent's system
// prompt must carry a worked SVG example for the Circles/geometry topic.
// Pure file-content assertions — no network, no model call. Brittle by design:
// if the geometry guidance is removed, this fails loudly.
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}

const read = (p) => fs.readFileSync(path.join(__dirname, "prompts", p), "utf-8");
const gen = read("question_gen.txt");
const draw = read("diagram_system.txt");
const indexSrc = fs.readFileSync(path.join(__dirname, "index.js"), "utf-8");

// ── 1. question_gen: geometry-line rule present ──
{
  check("gen: GEOMETRY LINES rule present", /GEOMETRY LINES/.test(gen));
  check("gen: warns against single corner-to-edge radius (diagonal)",
    /reads as a single diagonal/i.test(gen));
  check("gen: quarter circle described as TWO radii at a right angle",
    /TWO radii/.test(gen) && /right angle/i.test(gen));
}

// ── 2. question_gen: quarter-circle GOOD example present and correct ──
{
  // The GOOD example must mention a radius along each straight edge and the arc.
  check("gen: quarter-circle example has a bottom radius label",
    /Bottom radius labelled '8 cm'/.test(gen));
  check("gen: quarter-circle example has a left radius label",
    /Left radius labelled '8 cm'/.test(gen));
  check("gen: quarter-circle example asks for arc joining far ends",
    /arc/i.test(gen) && /far ends of the two radii/i.test(gen));
  check("gen: quarter-circle example marks the right angle",
    /Right-angle square symbol at the centre/.test(gen));
}

// ── 3. question_gen: the failing prompt is recorded as a BAD example ──
{
  check("gen: BAD example flags the corner-to-curve diagonal",
    /reads as a DIAGONAL across the sector/.test(gen));
}

// ── 4. diagram_system: worked SVG example for geometry/Circles ──
{
  check("draw: has a WORKED EXAMPLE section", /WORKED EXAMPLE/.test(draw));
  check("draw: worked example is a quarter circle", /quarter circle/i.test(draw));
  // Structural: the example SVG must be a sector (arc path), not a diagonal line.
  // An arc command (A/a) in a path proves a curved edge is drawn.
  const svgMatch = draw.match(/<svg[\s\S]*<\/svg>/i);
  check("draw: worked example contains an SVG", !!svgMatch);
  if (svgMatch) {
    const svg = svgMatch[0];
    check("draw: SVG path uses an arc command (curved edge, not a diagonal)",
      /\bA\d|\sA\s|A\d{2,}/.test(svg) && /<path[^>]*\bd=/.test(svg));
    check("draw: SVG draws a right-angle marker (polyline)",
      /<polyline/.test(svg));
    check("draw: SVG labels both radii '8 cm'",
      (svg.match(/8 cm/g) || []).length >= 2);
    check("draw: SVG uses the standard 800x600 viewBox",
      /viewBox="0 0 800 600"/.test(svg));
  }
}

// ── 5. question_gen: grid-area / count-squares rule and example ──
{
  check("gen: GRID-AREA / COUNT QUESTIONS rule present",
    /GRID-AREA \/ COUNT QUESTIONS/.test(gen));
  check("gen: count rule states draw what you count",
    /draw what you count/i.test(gen));
  check("gen: count rule requires row\/col position notation",
    /row R col/i.test(gen));
  check("gen: BAD count example flags shape-name-only diagramPrompt",
    /L-shaped figure on it.*Mismatch/is.test(gen));
  check("gen: count worked example uses op count",
    /"op":"count"/.test(gen) || /"op": "count"/.test(gen));
  check("gen: count worked example names squares by row and column",
    /row \d+ col(umn)? \d+/i.test(gen));
  check("gen: count worked example has inputs array matching named squares",
    /\"inputs\":\[1,1,1,1\]/.test(gen) || /"inputs": \[1, 1, 1, 1\]/.test(gen));
}

// ── 6. question_gen: curriculum coverage / subtopic guidance ──
{
  check("gen: CURRICULUM COVERAGE section present",
    /CURRICULUM COVERAGE/.test(gen));
  check("gen: instructs spreading questions across sub-skills",
    /spread/i.test(gen) && /sub-skill/i.test(gen));
  check("gen: names expanding brackets as a sub-skill not to omit",
    /EXPANDING SINGLE BRACKETS/.test(gen) && /EXPANDING DOUBLE BRACKETS/.test(gen));
  check("gen: requires a subtopic field on every question",
    /"subtopic" field/.test(gen));
  check("gen: schema summary line includes a subtopic field",
    /"subtopic":/.test(gen));
}

// ── 6b. CR-022 (cont.): 2D tag — subStrand + depth, anchored, with coverage-target driver ──
{
  check("gen: requires a subStrand field (width axis)", /"subStrand"/.test(gen));
  check("gen: requires a depth field (cognitive axis)", /"depth"/.test(gen));
  check("gen: names all four depth bands",
    /recall/.test(gen) && /procedure/.test(gen) && /application/.test(gen) && /reasoning/.test(gen));
  check("gen: depth is anchored to exemplars, not free-labelled",
    /anchored exemplars/i.test(gen) && /match the pattern/i.test(gen));
  check("gen: states depth is NOT difficulty (orthogonal axis)",
    /DEPTH IS NOT DIFFICULTY/i.test(gen));
  check("gen: instructs spreading across BOTH axes (no all-recall set)",
    /SPREAD ACROSS BOTH AXES/i.test(gen));
  check("gen: keeps subtopic as a deprecated alias of subStrand",
    /deprecated alias/i.test(gen));
  check("gen: schema summary includes subStrand + depth",
    /"subStrand":/.test(gen) && /"depth":/.test(gen));
  // Slice D width-adaptive driver placeholder.
  check("gen: has the {{coverage_target}} steering placeholder",
    /\{\{coverage_target\}\}/.test(gen));
}

// ── 5. Slice 2: curriculum steering placeholder + fallback wording ──
{
  check("gen: has the {{curriculum}} steering placeholder",
    /\{\{curriculum\}\}/.test(gen));
  check("gen: approved curriculum is treated as authoritative",
    /APPROVED CURRICULUM block appears above/i.test(gen) && /authoritative/i.test(gen));
  check("gen: self-enumeration is the explicit fallback",
    /Otherwise \(no approved block/i.test(gen));

  const sweep = read("curriculum_sweep.txt");
  check("sweep: instructs MAXIMUM RECALL union", /maximum recall/i.test(sweep));
  check("sweep: asks for provenance + year-disagreement flags",
    /provenance/i.test(sweep) && /year_flag/i.test(sweep));
  check("sweep: carries a complete worked-example payload (sub_strands JSON)",
    /"sub_strands"/.test(sweep) && /"misconceptions"/.test(sweep));
}

// ── 7. DEF-043: coordinate-grid answer-leak prevention ──
// Guards that coordinate-identification questions cannot have coordinate values
// in the label whitelist, only the letter name of the point.
{
  check("gen: COORDINATE GRID QUESTIONS special rule section present",
    /COORDINATE GRID QUESTIONS.*SPECIAL RULE/s.test(gen));
  check("gen: coordinate rule requires letter name ONLY",
    /letter name ONLY/i.test(gen));
  check("gen: coordinate GOOD example uses 'letter name only — no coordinates'",
    /letter name only.*no coordinates/i.test(gen));
  check("gen: coordinate BAD example shows coordinate leak ('B (3, -2)' label)",
    /B \(3, -2\)/.test(gen));
  check("draw: coordinate grid exception — letter name only, no coordinate values",
    /coordinate.*letter name only/is.test(draw) || /letter.*name only.*coordinate/is.test(draw));
}

// ── 8. DEF-033: diagram-required questions dropped if generation fails ──
// Guards that processDiagrams does not pass a question with a missing SVG through
// to the bank (i.e. it drops rather than serves diagramless).
{
  check("index: processDiagrams logs DROPPED on diagram generation failure (DEF-033)",
    /DROPPED question.*diagram required but generation failed/i.test(indexSrc));
  check("index: processDiagrams only pushes questions when svg is truthy",
    /if \(svg\)\s*\{[\s\S]{0,100}results\.push/.test(indexSrc));
}

// ── 9. DEF-044: zero-question pipeline marks job failed, not complete ──
// Guards that a pipeline producing 0 surviving questions writes status:"failed"
// rather than status:"complete" (which left the frontend polling forever).
{
  check("index: zero-question guard checks final.length === 0 (DEF-044)",
    /final\.length === 0/.test(indexSrc));
  check("index: zero-question path sets status to 'failed'",
    /final\.length === 0[\s\S]{0,400}status.*failed/.test(indexSrc));
}

// ── 10. DEF-034: top-up questions routed through Stage 4 review ──
// Guards that top-up output passes through review() before being banked,
// not written directly from processDiagrams (the pre-fix behaviour).
{
  check("index: top-up calls review() after processDiagrams (DEF-034)",
    /topupWithDiagrams[\s\S]{0,200}review\(apiKey, topupWithDiagrams/.test(indexSrc));
  check("index: top-up filters audit/child failures before banking",
    /topupPassed.*filter.*_auditFailed.*_childFailed/.test(indexSrc));
}

// ── 12. DEF-038: plant-cell diagram example is data-rich, not decorative ──
// Guards that the plant-cell GOOD example carries specific measurable quantities
// (chloroplast count + vacuole %) so a child can derive the answer from the diagram.
{
  check("gen: plant-cell example specifies a chloroplast count (DEF-038)",
    /chloroplasts.*5 visible|5.*chloroplasts/i.test(gen));
  check("gen: plant-cell example specifies a vacuole measurement (DEF-038)",
    /Vacuole.*60%|60%.*vacuole/i.test(gen));
}

// ── 11. DEF-035: diagramPrompt threaded into the review payload ──
// Guards that buildReviewQuestions carries diagramPrompt so the auditor can
// check scenario/data consistency between the question and the diagram drawn.
{
  const reviewSrc = fs.readFileSync(path.join(__dirname, "review.js"), "utf-8");
  const reviewTxt = fs.readFileSync(path.join(__dirname, "prompts", "review.txt"), "utf-8");
  check("review.js: buildReviewQuestions includes diagramPrompt field (DEF-035)",
    /diagramPrompt\s*:\s*q\.diagramPrompt/.test(reviewSrc));
  check("review.txt: criterion 3 checks diagramPrompt for scenario/data mismatch",
    /diagramPrompt.*same.*scenario|same.*data.*diagramPrompt/is.test(reviewTxt));
}

// ── 13. DEF-052: angle diagrams — vertex-centred arcs, ray at true inclination ──
// Guards the angle-diagram class fix: both prompts must carry an ANGLES rule and the
// drawing prompt a worked angle SVG (arc centred on the vertex, ray drawn to match the
// label), and the unknown angle must be shown as 'x' — never a computed value (leak).
{
  // generator rule + GOOD example
  check("gen: rule #10 has an ANGLES clause (DEF-052)",
    /ANGLES \(angles on a straight line/.test(gen));
  check("gen: angle rule ties every arc to the vertex",
    /arc CENTRED ON THE VERTEX/i.test(gen));
  check("gen: angle rule forbids leaking the unknown's value",
    /NEVER state or hint the unknown's value/i.test(gen));
  check("gen: angles-on-a-straight-line GOOD example present",
    /arc centred exactly on the vertex/i.test(gen) && /arc labelled '130°'/.test(gen));
  check("gen: angle GOOD example labels the unknown 'x', not a number",
    /arc labelled 'x'/.test(gen));

  // drawing system prompt rule + worked SVG
  check("draw: ANGLES rule present (DEF-052)",
    /- ANGLES: an angle lives at a single VERTEX/.test(draw));
  check("draw: angle rule requires arcs centred on the vertex",
    /CENTRED EXACTLY ON THAT VERTEX/.test(draw));
  check("draw: angle rule requires rays at their true inclination",
    /TRUE inclination/.test(draw) && /cos\/sin/.test(draw));
  check("draw: has a WORKED EXAMPLE for angles on a straight line",
    /WORKED EXAMPLE — ANGLES ON A STRAIGHT LINE/.test(draw));

  // the angle worked SVG must be an arc-based, vertex-centred construction
  const angleEx = draw.split(/WORKED EXAMPLE — ANGLES ON A STRAIGHT LINE/)[1] || "";
  const svgMatch = angleEx.match(/<svg[\s\S]*<\/svg>/i);
  check("draw: angle worked example contains an SVG", !!svgMatch);
  if (svgMatch) {
    const svg = svgMatch[0];
    check("draw: angle SVG marks angles with arc commands (A)",
      (svg.match(/\bA \d/g) || []).length >= 2 && /<path[^>]*\bd=/.test(svg));
    check("draw: angle SVG draws a vertex dot (circle)", /<circle/.test(svg));
    check("draw: angle SVG uses the standard 800x600 viewBox",
      /viewBox="0 0 800 600"/.test(svg));
    check("draw: angle SVG labels the known angle 130°", /130°/.test(svg));
    // unhappy-path / answer-leak guard: the unknown must stay 'x', the example must
    // not reveal the computed complement (50° = 180 - 130).
    check("draw: angle SVG shows the unknown as 'x' (no leak)",
      />x<\/text>/.test(svg) && !/50°/.test(svg));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
