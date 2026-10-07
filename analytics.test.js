// BrightMind V2 — Tester: DEF-057 — parent analytics backend (analytics-agent).
// Run: node analytics.test.js
// Exercises the shared core (supabase/functions/analytics-agent/core.mjs) the Edge
// Function runs: metrics, chart building, answer validation, HTML safety, scope checks;
// plus prompt/validation pairing and the class guard — every Edge Function the frontend
// calls must have its source in the repo.
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}

(async () => {
  const core = await import("./supabase/functions/analytics-agent/core.mjs");
  const { computeMetrics, buildChart, shapeAnswer, narrativeToHtml, emptyAnswer, scopeError, ANALYTICS_PROMPT, ANSWER_SCHEMA, CHART_KEYS } = core;

  const scope = { childId: "11111111-1111-1111-1111-111111111111", childName: "Spruha", yearGroup: 8, subject: "both", dateFrom: "2026-09-01", dateTo: "2026-10-06" };
  const ans = (sel, cor, sub, depth) => ({ selected: sel, correct: cor, subStrand: sub, depth });
  const results = [
    { subject: "maths", topics: ["Fractions"], correct: 1, total: 2, pct: 0.5, time_taken: 80, completed_at: "2026-09-10T10:00:00Z",
      answers: [ans(1, 1, "Adding fractions", "recall"), ans(0, 1, "Adding fractions", "reasoning")], tutorials: { difficulty: "medium" } },
    { subject: "maths", topics: ["Algebra"], correct: 2, total: 2, pct: 1, time_taken: 40, completed_at: "2026-09-03T10:00:00Z",
      answers: [ans(2, 2, "Simplifying", "recall"), ans(3, 3, "Simplifying", "procedure")], tutorials: { difficulty: "hard" } },
  ];

  // ── 1. Pass 1: deterministic metrics ──
  const m = computeMetrics(results, scope);
  check("summary: 2 tests, 4 questions", m.summary.tests === 2 && m.summary.questions === 4);
  check("summary: avg 75%", m.summary.avgPct === 75);
  check("summary: avg 30s/question", m.summary.avgSecsPerQuestion === 30);
  check("byTopic: Fractions 50%, Algebra 100%",
    m.byTopic.find((t) => t.label === "Fractions").avgPct === 50 && m.byTopic.find((t) => t.label === "Algebra").avgPct === 100);
  check("trend is chronological (Algebra 03 Sep first)", m.trend[0].label === "03 Sep" && m.trend[0].pct === 100 && m.trend[1].pct === 50);
  check("byDifficulty from tutorial", m.byDifficulty.length === 2 && m.byDifficulty.find((d) => d.label === "hard").avgPct === 100);
  check("bySubStrand: Adding fractions 50%", m.bySubStrand.find((s) => s.label === "Adding fractions").pct === 50);
  check("byDepth: recall 100%, reasoning 0%",
    m.byDepth.find((d) => d.label === "recall").pct === 100 && m.byDepth.find((d) => d.label === "reasoning").pct === 0);
  check("timeByTopic: Fractions 40s/q", m.timeByTopic.find((t) => t.label === "Fractions").avgSecsPerQuestion === 40);
  check("metrics carry the school year", m.yearGroup === 8);
  // Unhappy: legacy rows (no subStrand/depth/difficulty) and junk rows don't break it.
  const m2 = computeMetrics([{ topics: ["X"], total: 0, pct: 0 }, null, { topics: ["Y"], total: 1, pct: 1, completed_at: "2026-09-01", answers: [{ selected: 0, correct: 0 }] }], scope);
  check("junk rows skipped, legacy answers tolerated", m2.summary.tests === 1 && m2.bySubStrand.length === 0 && m2.byDepth.length === 0);

  // ── 2. Charts are built only from metrics ──
  const c = buildChart(m, "topic_scores");
  check("chart: topic_scores bar from metrics", c.chartType === "bar" && c.chartData.labels.join() === "Algebra,Fractions" && c.chartData.values.join() === "100,50");
  check("chart: score_trend is a line", buildChart(m, "score_trend").chartType === "line");
  check("chart: unknown key → none", buildChart(m, "pie_of_lies").chartType === "none");
  check("chart: empty series → none", buildChart(m2, "substrand_scores").chartType === "none");

  // ── 3. Pass 2 validation: model reply → UI contract ──
  const good = JSON.stringify({ narrative: "Weakest is **Fractions** at 50%.", chart: "topic_scores", follow_ups: ["a?", "b?", "c?", "d?"] });
  const a = shapeAnswer(good, m);
  check("answer: UI contract keys", ["narrative", "chartType", "chartData", "followUpSuggestions"].every((k) => k in a));
  check("answer: bold rendered", a.narrative.includes("<strong>Fractions</strong>"));
  check("answer: follow-ups capped at 3", a.followUpSuggestions.length === 3);
  check("answer: chart values come from metrics", a.chartData.values.join() === "100,50");
  check("answer: fenced JSON tolerated", shapeAnswer("```json\n" + good + "\n```", m).chartType === "bar");
  check("answer: bad chart key → none (no throw)", shapeAnswer(JSON.stringify({ narrative: "x", chart: "radar", follow_ups: [] }), m).chartType === "none");
  let threw = false; try { shapeAnswer("not json", m); } catch (e) { threw = true; }
  check("unhappy: malformed reply throws", threw);
  threw = false; try { shapeAnswer(JSON.stringify({ narrative: "", chart: "none", follow_ups: [] }), m); } catch (e) { threw = true; }
  check("unhappy: empty narrative throws", threw);
  check("XSS: model HTML is escaped", !narrativeToHtml('<img src=x onerror=alert(1)>').includes("<img"));

  // ── 4. No data → answer without a model call ──
  const e = emptyAnswer(scope);
  check("empty: says no tests for Year 8", /no completed tests/i.test(e.narrative) && /Year 8/.test(e.narrative) && e.chartType === "none");
  check("empty: escapes child name", !emptyAnswer({ ...scope, childName: "<b>x</b>" }).narrative.includes("<b>x"));

  // ── 5. Scope validation (unhappy paths) ──
  check("scope: valid passes", scopeError(scope) === null);
  check("scope: missing year rejected", scopeError({ ...scope, yearGroup: undefined }) !== null);
  check("scope: bad childId rejected (no injection into REST path)", scopeError({ ...scope, childId: "x&role=eq.parent" }) !== null);
  check("scope: reversed dates rejected", scopeError({ ...scope, dateFrom: "2026-10-07" }) !== null);
  check("scope: bad date format rejected", scopeError({ ...scope, dateTo: "06/10/2026" }) !== null);
  check("scope: bad subject rejected", scopeError({ ...scope, subject: "art" }) !== null);

  // ── 6. Prompt ↔ validation pairing (CLAUDE.md prompt rule) ──
  const promptFile = fs.readFileSync(path.join(__dirname, "prompts", "analytics.txt"), "utf-8");
  check("prompt in Edge Function == prompts/analytics.txt", ANALYTICS_PROMPT === promptFile);
  const ex = promptFile.match(/ANSWER:\n(\{.*\})/);
  check("prompt has a complete worked example answer", !!ex);
  if (ex) {
    const exObj = JSON.parse(ex[1]);
    check("worked example matches ANSWER_SCHEMA keys", Object.keys(exObj).sort().join() === ANSWER_SCHEMA.required.slice().sort().join());
    check("worked example passes shapeAnswer", !!shapeAnswer(ex[1], m).narrative);
  }
  check("every chart key is documented in the prompt", CHART_KEYS.every((k) => promptFile.includes(k)));
  check("schema enum == CHART_KEYS", ANSWER_SCHEMA.properties.chart.enum.join() === CHART_KEYS.join());

  // ── 7. Edge Function wiring ──
  const fn = fs.readFileSync(path.join(__dirname, "supabase", "functions", "analytics-agent", "index.ts"), "utf-8");
  check("fn: parent-ownership check on the child", /parent_id=eq\.\$\{user\.id\}/.test(fn));
  check("fn: results scoped to the school year (DEF-056)", /year_group=eq\.\$\{childScope\.yearGroup\}/.test(fn));
  check("fn: model from runtime_config, no literal", /runtime_config\?key=eq\.CLAUDE_MODEL/.test(fn) && !/claude-(opus|sonnet|haiku|fable)-\d/.test(fn));
  check("fn: structured output with ANSWER_SCHEMA", /format:\s*\{\s*type:\s*"json_schema",\s*schema:\s*ANSWER_SCHEMA/.test(fn));
  check("fn: refusal handled", /stop_reason === "refusal"/.test(fn));

  // ── 8. Frontend: school-year scope is sent ──
  const html = fs.readFileSync(path.join(__dirname, "frontend", "index.html"), "utf-8");
  check("UI: school-year selector present", /id="an-year-sel"/.test(html));
  check("UI: request scope carries yearGroup", /yearGroup:\s*AN\.yearGroup/.test(html));

  // ── 9. Class guard: every Edge Function the frontend calls has source in git ──
  const admin = fs.readFileSync(path.join(__dirname, "frontend", "admin.html"), "utf-8");
  const called = new Set([...(html + admin).matchAll(/functions\/v1\/([a-z0-9-]+)/g)].map((x) => x[1]));
  check("guard sees the known functions", ["analytics-agent", "job-status", "generate-questions"].every((n) => called.has(n)));
  for (const name of called) {
    check(`source in repo for Edge Function "${name}"`, fs.existsSync(path.join(__dirname, "supabase", "functions", name, "index.ts")));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
