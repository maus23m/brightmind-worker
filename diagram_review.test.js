// BrightMind V2 — Tester: diagram review pure logic (CR-021)
// Run: node diagram_review.test.js
// Covers the payload shaper (buildDiagramReviewInput) and the model-reply parser
// (parseDiagramReviewResult) with synthetic replies — no network, no rasterizer.
const { buildDiagramReviewInput, parseDiagramReviewResult } = require("./diagram_review");

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}

// ── 1. buildDiagramReviewInput: answer resolved from o[c] ──
{
  const q = { q: "How many squares?", o: ["18", "19", "20", "21"], c: 2, e: "20.", diagramPrompt: "draw squares", svg: "<svg/>" };
  const inp = buildDiagramReviewInput(q);
  check("input: answer = o[c]", inp.answer === "20");
  check("input: question carried", inp.question === "How many squares?");
  check("input: options carried", Array.isArray(inp.options) && inp.options.length === 4);
  check("input: diagramPrompt carried", inp.diagramPrompt === "draw squares");
  check("input: svg carried", inp.svg === "<svg/>");
}

// ── 1b. buildDiagramReviewInput: missing fields default safely ──
{
  const inp = buildDiagramReviewInput({});
  check("input: empty answer when no o/c", inp.answer === "");
  check("input: options [] when missing", Array.isArray(inp.options) && inp.options.length === 0);
  check("input: diagramPrompt null when missing", inp.diagramPrompt === null);
}

// ── 2. parse: unchanged SVG → ok ──
{
  const original = '<svg viewBox="0 0 800 600"><text>6 cm</text></svg>';
  const r = parseDiagramReviewResult(original, original);
  check("parse: unchanged → ok", r.verdict === "ok" && !r.svg);
}

// ── 2b. parse: unchanged but reformatted whitespace → still ok ──
{
  const original = '<svg viewBox="0 0 800 600"><text>6 cm</text></svg>';
  const reflowed = '<svg viewBox="0 0 800 600">\n  <text>6 cm</text>\n</svg>';
  const r = parseDiagramReviewResult(reflowed, original);
  check("parse: whitespace-only diff → ok", r.verdict === "ok");
}

// ── 3. parse: different SVG → corrected, returns new svg ──
{
  const original = '<svg><text>6 cm</text><text>equally spaced</text></svg>';
  const corrected = '<svg><text>6 cm</text></svg>';
  const r = parseDiagramReviewResult(corrected, original);
  check("parse: changed → corrected", r.verdict === "corrected");
  check("parse: corrected svg returned", r.svg === corrected);
}

// ── 3b. parse: corrected SVG wrapped in markdown fences ──
{
  const original = '<svg><text>a</text><text>b</text></svg>';
  const raw = "```svg\n<svg><text>a</text></svg>\n```";
  const r = parseDiagramReviewResult(raw, original);
  check("parse: strips fences → corrected", r.verdict === "corrected" && r.svg === "<svg><text>a</text></svg>");
}

// ── 4. parse: UNFIXABLE sentinel → unfixable ──
{
  check("parse: bare UNFIXABLE", parseDiagramReviewResult("UNFIXABLE", "<svg/>").verdict === "unfixable");
  check("parse: UNFIXABLE with prose", parseDiagramReviewResult("This is UNFIXABLE — wrong scenario.", "<svg/>").verdict === "unfixable");
}

// ── 4b. parse: UNFIXABLE wins only when no SVG present ──
{
  // A reply that mentions the word but still returns an SVG is a correction, not a drop.
  const original = "<svg><text>x</text></svg>";
  const raw = "<svg><text>UNFIXABLE label removed</text></svg>";
  const r = parseDiagramReviewResult(raw, original);
  check("parse: SVG present beats UNFIXABLE word", r.verdict === "corrected");
}

// ── 5. parse: junk with no SVG and no sentinel → error (fail-open) ──
{
  check("parse: garbage → error", parseDiagramReviewResult("sorry, I cannot help", "<svg/>").verdict === "error");
  check("parse: empty → error", parseDiagramReviewResult("", "<svg/>").verdict === "error");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
