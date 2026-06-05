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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
