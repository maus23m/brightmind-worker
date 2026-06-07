// BrightMind — Curriculum curation shared logic (Admin backend, Slice 2).
// Pure, dependency-free, unit-testable (see curriculum.test.js) — like compute.js /
// review.js. Used by BOTH the worker (to steer generation from an approved object) and
// the offline sweep script (to validate/parse a proposed payload before writing it).

// ── Payload shape ──
// { sub_strands:   [{ id?, name, depth_bands?, provenance?, year_flag? }, ...],   (>=1, each needs a name)
//   prerequisites: [{ sub_strand, requires: [...] }, ...],                         (optional)
//   misconceptions:[{ sub_strand?, wrong, why?, correct? }, ...] }                 (optional)

// Validate + normalise a curriculum payload. Throws on anything unusable so a bad
// sweep result never reaches the proposals table. Returns a normalised payload.
function validateProposalPayload(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("payload must be an object");
  }
  const subs = obj.sub_strands;
  if (!Array.isArray(subs) || subs.length === 0) {
    throw new Error("payload.sub_strands must be a non-empty array");
  }
  const sub_strands = subs.map((s, i) => {
    const name = s && typeof s.name === "string" ? s.name.trim() : "";
    if (!name) throw new Error(`sub_strands[${i}] needs a non-empty name`);
    return {
      id: (s.id && String(s.id).trim()) || name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      name,
      depth_bands: Array.isArray(s.depth_bands) ? s.depth_bands : [],
      provenance: Array.isArray(s.provenance) ? s.provenance : [],
      year_flag: typeof s.year_flag === "string" ? s.year_flag : "agreed",
    };
  });
  const prerequisites = Array.isArray(obj.prerequisites) ? obj.prerequisites : [];
  const misconceptions = Array.isArray(obj.misconceptions) ? obj.misconceptions : [];
  return { sub_strands, prerequisites, misconceptions };
}

// Tolerant parse of a model's sweep output (may be fenced ```json) → validated payload.
function parseSweepResult(rawText) {
  const cleaned = String(rawText == null ? "" : rawText).replace(/```json|```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`sweep result is not valid JSON: ${e.message}`);
  }
  return validateProposalPayload(parsed);
}

// Given approved curriculum_objects rows (possibly several versions/topics), keep the
// highest-version row per topic. Non-approved rows are ignored.
function latestApprovedPerTopic(rows) {
  const best = new Map();
  for (const r of rows || []) {
    if (!r || r.status !== "approved" || !r.topic) continue;
    const cur = best.get(r.topic);
    if (!cur || (r.version || 0) > (cur.version || 0)) best.set(r.topic, r);
  }
  return [...best.values()];
}

// Build the generation-steering block injected into question_gen.txt as {{curriculum}}.
// Empty string when there is nothing approved → the prompt's self-enumeration fallback
// takes over (today's behaviour). When present it is authoritative: cover exactly these
// human-approved sub-strands, and avoid the listed misconceptions.
function buildCurriculumGuidance(objects) {
  const live = latestApprovedPerTopic(objects);
  if (live.length === 0) return "";

  const blocks = live.map((o) => {
    const p = o.payload || {};
    const subs = Array.isArray(p.sub_strands) ? p.sub_strands : [];
    const subLines = subs.map((s) => `  - ${s.name}`).join("\n");
    const misc = Array.isArray(p.misconceptions) ? p.misconceptions : [];
    const miscLines = misc.length
      ? "\n  Misconceptions to avoid (a question may instead ask the student to SPOT/CORRECT one, but its own correct answer must never embody the mistake):\n" +
        misc.map((m) => {
          const where = m.sub_strand ? `${m.sub_strand}: ` : "";
          const wrong = m.wrong ? `wrong "${m.wrong}"` : "";
          const why = m.why ? ` (${m.why})` : "";
          const correct = m.correct ? ` — correct: ${m.correct}` : "";
          return `    - ${where}${wrong}${why}${correct}`;
        }).join("\n")
      : "";
    return `Topic "${o.topic}" (Year ${o.year_group}) — cover exactly these approved sub-strands, spread the questions across them, and do NOT invent others:\n${subLines}${miscLines}`;
  });

  return (
    "APPROVED CURRICULUM (authoritative — a curriculum specialist has signed off the sub-strands below; " +
    "use these instead of guessing the topic's sub-skills):\n" +
    blocks.join("\n\n")
  );
}

module.exports = {
  validateProposalPayload,
  parseSweepResult,
  latestApprovedPerTopic,
  buildCurriculumGuidance,
};
