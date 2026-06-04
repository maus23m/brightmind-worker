// BrightMind V2 — Diagram Review (Stage 3.5) pure logic (CR-021)
// Standalone module (like compute.js / review.js) so the input-shaping and
// result-parsing are independently unit-testable (see diagram_review.test.js)
// without pulling in @google-cloud/functions-framework, @resvg/resvg-js, or a
// network call.
//
// WHY THIS EXISTS: the drawing agent (Stage 3) generates each SVG from a
// SELF-CONTAINED diagramPrompt and never sees the question, options or correct
// answer. It therefore cannot tell whether a label it draws is irrelevant to
// the question, or whether a label leaks the answer (e.g. numbering every item
// in a "how many?" diagram, or labelling 4 squares "equally spaced" when
// spacing is not the point). Stage 3.5 is a vision-based evaluator that DOES see
// the question + answer + the rendered diagram, and returns a corrected SVG with
// the offending labels removed while preserving every necessary label. index.js
// owns the rasterizer + the Claude vision call; this module owns the two pure
// transforms.

// buildDiagramReviewInput — shape the per-question payload for the evaluator
// prompt. answer is resolved here (o[c]) so the prompt never has to.
function buildDiagramReviewInput(q) {
  const answer = (q.o && typeof q.c === "number") ? q.o[q.c] : "";
  return {
    question: q.q || "",
    options: Array.isArray(q.o) ? q.o : [],
    answer,
    diagramPrompt: q.diagramPrompt || null,
    svg: q.svg || "",
  };
}

// parseDiagramReviewResult — fold the model's raw text reply into a verdict.
// The evaluator returns ONE of: the corrected SVG, the unchanged SVG (already
// clean), or the sentinel UNFIXABLE. Tolerant of markdown fences / surrounding
// prose. originalSvg lets us distinguish "ok" (returned unchanged) from
// "corrected" (returned a different SVG).
function parseDiagramReviewResult(raw, originalSvg = "") {
  const text = (raw || "").replace(/```svg|```xml|```/gi, "").trim();

  const m = text.match(/<svg[\s\S]*<\/svg>/i);

  // Explicit unsalvageable sentinel (and no SVG to fall back to) — drop the
  // question (DEF-033 style).
  if (!m && /\bUNFIXABLE\b/i.test(text)) {
    return { verdict: "unfixable" };
  }

  if (!m) {
    // No SVG and no UNFIXABLE sentinel — treat as an infra/parse error so the
    // caller can fail-open (keep the original diagram), matching review().
    return { verdict: "error" };
  }

  const svg = m[0].trim();
  if (norm(svg) === norm(originalSvg)) return { verdict: "ok" };
  return { verdict: "corrected", svg };
}

// norm — whitespace-insensitive compare so a reformatted-but-identical reply
// still counts as "ok" rather than a spurious "corrected".
function norm(s) {
  return (s || "").replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();
}

module.exports = { buildDiagramReviewInput, parseDiagramReviewResult };
