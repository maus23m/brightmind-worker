// BrightMind V2 — Tester: DEF-059 — every table the code touches is RLS-protected.
// Run: node security.test.js
// Static check, no network. Collects every table referenced by the worker, scripts, edge
// functions and frontends (PostgREST paths + supabase-js .from()) and asserts each one has
// RLS enabled — either by a migration, or (for tables that pre-date migrations/) on the
// explicit list below, verified live via the Supabase security advisor. A new table used by
// code with neither fails here, so it cannot silently ship with RLS off (the DEF-059 class).
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}

// Tables created before migrations/ existed. RLS confirmed enabled live on
// rtyvomkhajyinlycgjzm, 30 Sep 2026 (pg_class.relrowsecurity = true). Add to a migration,
// not this list, for anything new.
const PRE_MIGRATION_RLS_VERIFIED = new Set([
  "users", "results", "tutorials", "badges", "streaks", "question_rejections", "generation_jobs",
]);

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    if (f === "node_modules" || f.startsWith(".")) continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

const files = walk(__dirname);
const code = files.filter((f) => /\.(js|ts|html)$/.test(f) && !/\.test\.js$/.test(f));
const migrations = files.filter((f) => /migrations[\\/].+\.sql$/.test(f));

// Tables referenced by code.
const TABLE_REFS = [
  /\/rest\/v1\/([a-z_0-9]+)/g,                          // fetch(`${url}/rest/v1/<table>...`)
  /\.from\(\s*['"`]([a-z_0-9]+)['"`]\s*\)/g,            // supabase.from('<table>')
  /[`'"]([a-z][a-z_0-9]+)\?(?:[a-z_]+=|select=|order=)/g, // helper(`<table>?col=eq...`)
];
const referenced = new Map();
for (const f of code) {
  const src = fs.readFileSync(f, "utf-8");
  for (const re of TABLE_REFS) {
    for (const m of src.matchAll(re)) {
      if (m[1] === "rpc") continue; // /rest/v1/rpc/<fn> is a function call, not a table
      if (!referenced.has(m[1])) referenced.set(m[1], new Set());
      referenced.get(m[1]).add(path.relative(__dirname, f));
    }
  }
}

// Tables with RLS enabled by a migration.
const rlsByMigration = new Set();
for (const f of migrations) {
  const sql = fs.readFileSync(f, "utf-8").replace(/--.*$/gm, "");
  for (const m of sql.matchAll(/alter\s+table\s+(?:public\.)?([a-z_0-9]+)\s+enable\s+row\s+level\s+security/gi)) {
    rlsByMigration.add(m[1]);
  }
}

// ── 1. Sanity: the scan actually finds the known tables (guards a broken regex passing vacuously) ──
for (const t of ["question_bank", "child_question_history", "runtime_config", "results"]) {
  check(`scan finds ${t}`, referenced.has(t));
}

// ── 2. Happy path: every referenced table is RLS-protected ──
for (const [t, where] of [...referenced].sort()) {
  const ok = rlsByMigration.has(t) || PRE_MIGRATION_RLS_VERIFIED.has(t);
  check(`RLS on ${t} (used in ${[...where].join(", ")})`, ok);
}

// ── 3. DEF-059 specifically: the three tables are enabled by migration, with admin-only reads ──
{
  const mig = fs.readFileSync(path.join(__dirname, "migrations", "0008_rls_question_tables.sql"), "utf-8");
  for (const t of ["question_bank", "child_question_history", "question_rejections_backup_20260614"]) {
    check(`DEF-059: 0008 enables RLS on ${t}`, rlsByMigration.has(t));
    check(`DEF-059: ${t} read policy is admin-gated`,
      new RegExp(`on public\\.${t}\\s+for select using \\(public\\.is_admin\\(\\)\\)`).test(mig));
  }
  // Unhappy path: no client write policy — writes stay service-role only.
  check("DEF-059: 0008 grants no insert/update/delete/all policy", !/for\s+(insert|update|delete|all)\b/i.test(mig));
  // The backup is the only copy of pre-14-Jun parent rejections — never dropped by migration.
  check("DEF-059: backup table is not dropped", !migrations.some((f) => /drop\s+table[^;]*question_rejections_backup/i.test(fs.readFileSync(f, "utf-8"))));
}

// ── 3b. Migration numbering: every prefix is unique (two 0006_* files shipped on 5 Oct) ──
{
  const prefixes = migrations.map((f) => path.basename(f).split("_")[0]);
  const dup = prefixes.filter((p, i) => prefixes.indexOf(p) !== i);
  check(`migration prefixes are unique${dup.length ? " — duplicate " + dup.join(", ") : ""}`, dup.length === 0);
}

// ── 4. Unhappy path: the checker flags an unprotected table (proves it can fail) ──
{
  const fake = "brand_new_table";
  check("checker flags a table with no RLS", !(rlsByMigration.has(fake) || PRE_MIGRATION_RLS_VERIFIED.has(fake)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
