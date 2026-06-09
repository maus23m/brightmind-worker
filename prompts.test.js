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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
