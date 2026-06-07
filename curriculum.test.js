// BrightMind — Tester: curriculum curation pure logic (Admin backend, Slice 2)
// Run: node curriculum.test.js
// Covers validateProposalPayload / parseSweepResult / latestApprovedPerTopic /
// buildCurriculumGuidance — synchronous, no network.
const { validateProposalPayload, parseSweepResult, latestApprovedPerTopic, buildCurriculumGuidance } = require("./curriculum");

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}

const goodPayload = {
  sub_strands: [
    { id: "notation", name: "Algebraic notation & conventions", year_flag: "agreed" },
    { name: "Substitution" },
  ],
  misconceptions: [{ sub_strand: "simplifying", wrong: "5x + 3 = 8x", why: "unlike terms", correct: "5x + 3" }],
};

// ── validateProposalPayload ──
{
  const v = validateProposalPayload(goodPayload);
  check("validate: keeps sub_strands", v.sub_strands.length === 2);
  check("validate: derives id from name when absent", v.sub_strands[1].id === "substitution");
  check("validate: defaults year_flag to agreed", v.sub_strands[1].year_flag === "agreed");
  check("validate: normalises missing prerequisites to []", Array.isArray(v.prerequisites) && v.prerequisites.length === 0);

  let threw = false; try { validateProposalPayload(null); } catch (e) { threw = true; }
  check("validate: throws on null", threw);
  threw = false; try { validateProposalPayload({ sub_strands: [] }); } catch (e) { threw = true; }
  check("validate: throws on empty sub_strands", threw);
  threw = false; try { validateProposalPayload({ sub_strands: [{ depth_bands: [] }] }); } catch (e) { threw = true; }
  check("validate: throws on sub_strand without a name", threw);
}

// ── parseSweepResult ──
{
  const fenced = "```json\n" + JSON.stringify(goodPayload) + "\n```";
  const v = parseSweepResult(fenced);
  check("parse: strips ```json fences and validates", v.sub_strands.length === 2);

  let threw = false; try { parseSweepResult("not json"); } catch (e) { threw = true; }
  check("parse: throws on non-JSON", threw);
  threw = false; try { parseSweepResult(JSON.stringify({ sub_strands: [] })); } catch (e) { threw = true; }
  check("parse: throws when validation fails", threw);
}

// ── latestApprovedPerTopic ──
{
  const rows = [
    { topic: "A", status: "approved", version: 1, payload: {} },
    { topic: "A", status: "approved", version: 3, payload: {} },
    { topic: "A", status: "archived", version: 2, payload: {} },
    { topic: "B", status: "approved", version: 1, payload: {} },
    { topic: "C", status: "draft", version: 9, payload: {} },
  ];
  const live = latestApprovedPerTopic(rows);
  check("latest: one row per topic, approved only", live.length === 2);
  check("latest: picks highest approved version", live.find((r) => r.topic === "A").version === 3);
  check("latest: ignores non-approved topics", !live.some((r) => r.topic === "C"));
}

// ── buildCurriculumGuidance ──
{
  check("guidance: empty for no objects", buildCurriculumGuidance([]) === "");
  check("guidance: empty when nothing approved", buildCurriculumGuidance([{ topic: "A", status: "draft", payload: {} }]) === "");

  const objs = [{
    topic: "Expressions & Equations", year_group: 7, status: "approved", version: 1,
    payload: {
      sub_strands: [{ name: "Substitution" }, { name: "Simplifying (collecting like terms)" }],
      misconceptions: [{ sub_strand: "simplifying", wrong: "5x + 3 = 8x", why: "unlike terms", correct: "5x + 3" }],
    },
  }];
  const g = buildCurriculumGuidance(objs);
  check("guidance: marks itself authoritative", /authoritative/i.test(g));
  check("guidance: names the topic + year", g.includes('Expressions & Equations') && g.includes("Year 7"));
  check("guidance: lists each approved sub-strand", g.includes("Substitution") && g.includes("Simplifying (collecting like terms)"));
  check("guidance: surfaces misconceptions to avoid", /misconceptions to avoid/i.test(g) && g.includes("5x + 3 = 8x"));
  check("guidance: instructs not to invent others", /do NOT invent others/i.test(g));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
