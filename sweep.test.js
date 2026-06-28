// BrightMind — Tester: curriculum sweep enumeration + planning (Admin backend, Slice 2)
// Run: node sweep.test.js
// Pure logic only (topicsFor / planTargets) + a shape guard on curriculum_taxonomy.json.
// No network, no Claude. Guards the taxonomy file from silently diverging in shape.
const fs = require("fs");
const path = require("path");
const { topicsFor, planTargets } = require("./scripts/curriculum_sweep");

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}

const taxonomy = JSON.parse(fs.readFileSync(path.join(__dirname, "frontend", "curriculum_taxonomy.json"), "utf-8"));

// ── taxonomy file shape ──
{
  check("taxonomy: has maths + science", !!taxonomy.maths && !!taxonomy.science);
  for (const subj of ["maths", "science"]) {
    for (const ks of ["KS1_2", "KS3_4"]) {
      const cats = taxonomy[subj] && taxonomy[subj][ks];
      check(`taxonomy: ${subj}.${ks} non-empty`, cats && Object.keys(cats).length > 0 &&
        Object.values(cats).every((v) => Array.isArray(v) && v.length > 0));
    }
  }
}

// ── topicsFor ──
{
  const y7 = topicsFor(taxonomy, "maths", 7);
  check("topicsFor: Y7 maths uses KS3_4 (has Expressions & Equations)", y7.includes("Expressions & Equations"));
  check("topicsFor: Y7 maths excludes a KS1_2-only topic", !y7.includes("Times Tables"));
  check("topicsFor: de-duplicates repeated chips", new Set(y7).size === y7.length);

  const y4 = topicsFor(taxonomy, "maths", 4);
  check("topicsFor: Y4 maths uses KS1_2 (has Place Value)", y4.includes("Place Value"));
  // "Word Problems" appears under two KS1_2 categories — must collapse to one.
  check("topicsFor: Y4 maths de-dupes Word Problems", y4.filter((t) => t === "Word Problems").length === 1);

  check("topicsFor: boundary year 6 → KS1_2", topicsFor(taxonomy, "maths", 6).includes("Place Value"));
  check("topicsFor: boundary year 7 → KS3_4", topicsFor(taxonomy, "maths", 7).includes("Fractions"));
  check("topicsFor: unknown subject → []", topicsFor(taxonomy, "history", 7).length === 0);
  check("topicsFor: science Y9 has Cells & Organisation", topicsFor(taxonomy, "science", 9).includes("Cells & Organisation"));
}

// ── planTargets ──
{
  const topics = ["A", "B", "C", "D"];
  const all = planTargets({ topics, requested: null, existing: [], limit: null });
  check("plan: sweeps all when nothing requested/existing", all.toSweep.length === 4 && all.skipped.length === 0);

  const narrowed = planTargets({ topics, requested: ["B", "D"], existing: [], limit: null });
  check("plan: --topics narrows to requested", narrowed.toSweep.join(",") === "B,D");

  const skipExisting = planTargets({ topics, requested: null, existing: ["A", "C"], limit: null });
  check("plan: skips existing", skipExisting.toSweep.join(",") === "B,D" && skipExisting.skipped.join(",") === "A,C");

  const capped = planTargets({ topics, requested: null, existing: [], limit: 2 });
  check("plan: --limit caps toSweep", capped.toSweep.length === 2);

  const unknown = planTargets({ topics, requested: ["B", "Z"], existing: [], limit: null });
  check("plan: reports unknown requested topics", unknown.unknown.join(",") === "Z" && unknown.toSweep.join(",") === "B");

  const existingSet = planTargets({ topics, requested: null, existing: new Set(["A"]), limit: null });
  check("plan: accepts a Set for existing", existingSet.toSweep.join(",") === "B,C,D");

  // CR-031: --force re-sweeps existing topics — nothing is skipped.
  const forced = planTargets({ topics, requested: null, existing: ["A", "C"], limit: null, force: true });
  check("plan: force ignores existing (re-sweeps all)", forced.toSweep.join(",") === "A,B,C,D" && forced.skipped.length === 0);
  const forcedNarrow = planTargets({ topics, requested: ["A"], existing: ["A"], limit: null, force: true });
  check("plan: force still narrows to requested", forcedNarrow.toSweep.join(",") === "A");
  const forcedCapped = planTargets({ topics, requested: null, existing: ["A", "B", "C", "D"], limit: 2, force: true });
  check("plan: force respects limit", forcedCapped.toSweep.length === 2);
}

// ── DEF-050: the in-app Run sweep panel must exist in frontend/admin.html ──
// The run-sweep Edge Function lives server-side (deployed via MCP); only these
// structural assertions tie its UI half to the repo. They caught nothing when the
// panel was stranded on a merged branch — now they fail loudly if it goes missing.
{
  const admin = fs.readFileSync(path.join(__dirname, "frontend", "admin.html"), "utf-8");
  check("DEF-050: admin has subject selector (sw-subject)", admin.includes('id="sw-subject"'));
  check("DEF-050: admin has year selector (sw-year)", admin.includes('id="sw-year"'));
  check("DEF-050: admin has topic selector (sw-topic)", admin.includes('id="sw-topic"'));
  check("DEF-050: admin has Run sweep button (sw-run)", admin.includes('id="sw-run"'));
  check("DEF-050: admin calls the run-sweep Edge Function", admin.includes("/functions/v1/run-sweep"));
  check("DEF-050: admin fetches the canonical taxonomy json", admin.includes("curriculum_taxonomy.json"));
  check("DEF-050: year selector covers Years 2-11", admin.includes("[2,3,4,5,6,7,8,9,10,11]"));

  // CR-031: the Re-sweep existing option must exist and be sent to the Edge Function.
  check("CR-031: admin has Re-sweep existing checkbox (sw-force)", admin.includes('id="sw-force"'));
  check("CR-031: admin sends force in the run-sweep body", /JSON\.stringify\(\{ subject, topic, year, force \}\)/.test(admin));

  // CR-031: the Edge Function source must accept force and supersede pending proposals
  // (same DEF-048 sync-debt class — UI half and server half must move together).
  const fn = fs.readFileSync(path.join(__dirname, "supabase", "functions", "run-sweep", "index.ts"), "utf-8");
  check("CR-031: edge function reads force from the request body", /force = false\s*\}\s*=\s*await req\.json\(\)/.test(fn));
  // (window widened in CR-033: a logRun("skipped", …) call now sits inside the guard.)
  check("CR-031: edge function skip is bypassed when forced", /!force &&[\s\S]{0,200}skipped: true/.test(fn));
  check("CR-031: edge function supersedes pending proposals on force", /superseded/.test(fn));

  // CR-031: CLI exposes --force and supersedes pending before writing.
  const cli = fs.readFileSync(path.join(__dirname, "scripts", "curriculum_sweep.js"), "utf-8");
  check("CR-031: CLI parses a --force flag", /--force/.test(cli) && /args\.force = true/.test(cli));
  check("CR-031: CLI supersedes pending proposals when forced", /supersedePending/.test(cli));
}

// ── DEF-053: the sweep model lives only in runtime_config (admin config page) ──
// Retired claude-sonnet-4-20250514 404'd the sweep. The fix removes every hardcoded model
// id from the sweep paths and reads CLAUDE_MODEL from runtime_config instead. These guards
// fail loudly if a literal model id creeps back in, or the config read is removed.
{
  const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf-8");
  const fn = read("supabase", "functions", "run-sweep", "index.ts");
  const cli = read("scripts", "curriculum_sweep.js");
  const depth = read("scripts", "depth_tag_check.js");
  const idx = read("index.js");
  const mig = read("migrations", "0001_admin_runtime_config.sql");

  // Repo guard: the retired model id is gone everywhere.
  const RETIRED = "claude-sonnet-4-20250514";
  for (const [name, src] of [["edge fn", fn], ["curriculum_sweep", cli], ["depth_tag_check", depth], ["index.js", idx], ["migration", mig]]) {
    check(`DEF-053: ${name} has no retired model id`, !src.includes(RETIRED));
  }

  // Config-driven sweep paths carry NO hardcoded model family literal at all.
  const MODEL_LITERAL = /claude-(opus|sonnet|haiku|fable)/;
  check("DEF-053: edge fn has no hardcoded model literal", !MODEL_LITERAL.test(fn));
  check("DEF-053: curriculum_sweep has no hardcoded model literal", !MODEL_LITERAL.test(cli));
  check("DEF-053: depth_tag_check has no hardcoded model literal", !MODEL_LITERAL.test(depth));

  // The sweep reads CLAUDE_MODEL from runtime_config (the admin config page).
  check("DEF-053: edge fn reads runtime_config CLAUDE_MODEL", /runtime_config\?key=eq\.CLAUDE_MODEL/.test(fn) && /resolveModel/.test(fn));
  check("DEF-053: curriculum_sweep reads runtime_config CLAUDE_MODEL", /runtime_config\?key=eq\.CLAUDE_MODEL/.test(cli) && /resolveModel/.test(cli));
  check("DEF-053: depth_tag_check reads runtime_config CLAUDE_MODEL", /runtime_config\?key=eq\.CLAUDE_MODEL/.test(depth) && /resolveModel/.test(depth));

  // Unhappy path: edge function fails closed (errors) when the key is unset — no silent default.
  check("DEF-053: edge fn fails closed when CLAUDE_MODEL absent", /CLAUDE_MODEL not set in runtime_config/.test(fn));

  // The migration seed (the config-layer default for a fresh DB) is on a live id.
  check("DEF-053: migration seeds a live CLAUDE_MODEL default", /'"claude-sonnet-4-6"'::jsonb/.test(mig));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
