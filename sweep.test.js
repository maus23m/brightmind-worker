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

const taxonomy = JSON.parse(fs.readFileSync(path.join(__dirname, "curriculum_taxonomy.json"), "utf-8"));

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
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
