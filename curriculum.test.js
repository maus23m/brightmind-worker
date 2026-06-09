// BrightMind — Tester: curriculum curation pure logic (Admin backend, Slice 2)
// Run: node curriculum.test.js
// Covers validateProposalPayload / parseSweepResult / latestApprovedPerTopic /
// buildCurriculumGuidance — synchronous, no network.
const { validateProposalPayload, parseSweepResult, latestApprovedPerTopic, buildCurriculumGuidance, DEPTH_BANDS, normaliseDepth, approvedSubStrandIndex } = require("./curriculum");

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

// ── CR-022 (cont.): normaliseDepth ──
{
  check("depth: 4 bands recall→reasoning", DEPTH_BANDS.join(",") === "recall,procedure,application,reasoning");
  check("depth: accepts a valid band (case/space tolerant)", normaliseDepth("  Application ") === "application");
  check("depth: unknown band → null (NOT a band)", normaliseDepth("mastery") === null);
  check("depth: missing → null (unknown, never 'all covered')", normaliseDepth(undefined) === null && normaliseDepth("") === null);
}

// ── CR-022 (cont.): approvedSubStrandIndex ──
{
  const objs = [{
    topic: "Expressions & Equations", year_group: 7, status: "approved", version: 1,
    payload: { sub_strands: [
      { id: "expanding_single", name: "Expanding a single bracket" },
      { name: "Substitution" },
    ] },
  }];
  const { byTopic } = approvedSubStrandIndex(objs);
  const m = byTopic.get("Expressions & Equations");
  check("index: builds a matcher per approved topic", !!m && m.names.length === 2);
  check("index: matches by exact name", m.match("Substitution") === "Substitution");
  check("index: matches case/punctuation-insensitively", m.match("expanding a single bracket") === "Expanding a single bracket");
  check("index: matches by id slug", m.match("expanding_single") === "Expanding a single bracket");
  check("index: off-list label → null (kept + warned by caller, not dropped)", m.match("Factorising") === null);
  check("index: ignores non-approved objects", approvedSubStrandIndex([{ topic: "X", status: "draft", payload: { sub_strands: [{ name: "Y" }] } }]).byTopic.size === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
