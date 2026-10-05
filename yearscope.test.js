// BrightMind V2 — Tester: DEF-056 — year-dependent aggregates are scoped to the year.
// Run: node yearscope.test.js
// A child's year change must not carry last year's results into this year's scores,
// topic badges, adaptive difficulty, progress screen, or the worker's coverage matrix.
// No network: the worker read is exercised against a stubbed fetch; the frontend helper
// is extracted from index.html and run; the call sites are checked structurally.
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}

const html = fs.readFileSync(path.join(__dirname, "frontend", "index.html"), "utf-8");
const mig = fs.readFileSync(path.join(__dirname, "migrations", "0007_results_year_group.sql"), "utf-8");

// ── 1. Frontend helper inYear() — behaviour ──
{
  const src = (html.match(/function inYear\(rec, year\) \{[\s\S]*?\n\}/) || [])[0];
  check("inYear helper present in index.html", !!src);
  const inYear = new Function(`${src}; return inYear;`)();
  check("inYear: same year → counted", inYear({ year: 8 }, 8) === true);
  check("inYear: string/number year compare", inYear({ year: "8" }, 8) === true);
  check("inYear: last year's result → excluded", inYear({ year: 7 }, 8) === false);
  check("inYear: result with no year (unknown) → excluded", inYear({ year: null }, 8) === false);
  check("inYear: child with no year → nothing counted", inYear({ year: 8 }, undefined) === false);
  check("inYear: missing record → false", inYear(undefined, 8) === false);

  // The owner's case: Spruha moved Y7→Y8 with 50 Y7 results → tile shows no Y8 tests.
  const results = Array.from({ length: 50 }, () => ({ childId: "s", year: 7, pct: 0.74 }));
  const y8 = results.filter((r) => r.childId === "s" && inYear(r, 8));
  check("owner case: 50 Y7 results → 0 counted for Y8", y8.length === 0);
  results.push({ childId: "s", year: 8, pct: 0.5 });
  check("owner case: new Y8 result counted alone", results.filter((r) => inYear(r, 8)).length === 1);
}

// ── 2. Every year-dependent aggregate goes through inYear (the class, not one site) ──
{
  const body = (name) => {
    const i = html.indexOf(`function ${name}(`);
    return i < 0 ? "" : html.slice(i, html.indexOf("\nfunction ", i + 10));
  };
  check("tile % + test count scoped (renderChildCards)", /inYear\(r, c\.yearGroup\)/.test(body("renderChildCards")));
  check("topic badges scoped (renderTopicGrid)", /inYear\(t, S\.year\)/.test(body("renderTopicGrid")));
  check("adaptive difficulty scoped (computeAdaptiveDifficulty)", /inYear\(r, S\.year\)/.test(body("computeAdaptiveDifficulty")));
  check("progress screen scoped (renderProgressScreen)", /inYear\(r, child\.yearGroup\)/.test(body("renderProgressScreen")));
  // Both result loaders (parent + child session) carry the year.
  check("both result loaders map year:r.year_group", (html.match(/year:r\.year_group/g) || []).length === 2);
  // Tutorials already carry their year.
  check("tutorial loader maps year:t.year_group", /year:\s*t\.year_group/.test(html));
}

// ── 3. Migration: results carry the year they were earned in ──
{
  check("0007 adds results.year_group", /alter table public\.results add column if not exists year_group/i.test(mig));
  check("0007 backfills from the tutorial", /update public\.results[\s\S]*from public\.tutorials/i.test(mig));
  check("0007 trigger stamps new results from the tutorial", /before insert on public\.results/i.test(mig) && /from public\.tutorials t where t\.id = new\.tutorial_id/i.test(mig));
  check("0007 trigger fn not client-callable", /revoke execute on function public\.results_set_year_group\(\) from public, anon, authenticated/i.test(mig));
}

// ── 4. Worker: coverage matrix reads only the job's year ──
(async () => {
  const { getChildResults } = require("./index");
  const calls = [];
  global.fetch = async (u) => { calls.push(u); return { ok: true, json: async () => [{ answers: [] }] }; };

  const rows = await getChildResults("https://x", "k", "child1", 8);
  check("worker: reads results for the job year", calls.length === 1 && /year_group=eq\.8/.test(calls[0]));
  check("worker: returns the rows", Array.isArray(rows) && rows.length === 1);

  calls.length = 0;
  const none = await getChildResults("https://x", "k", "child1", undefined);
  check("worker unhappy: no year → [] and no unscoped read", none.length === 0 && calls.length === 0);

  global.fetch = async () => { throw new Error("network down"); };
  const err = await getChildResults("https://x", "k", "child1", 8);
  check("worker unhappy: network failure → [] (no steering)", Array.isArray(err) && err.length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
