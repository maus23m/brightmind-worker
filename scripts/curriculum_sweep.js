#!/usr/bin/env node
// BrightMind — offline curriculum sweep (Admin backend, Slice 2).
// Operator-run, NEVER the worker / hot path. Distils a MAXIMUM-RECALL union taxonomy
// (sub-strands + prerequisites + misconceptions, with provenance + year flags) via Claude
// and writes `curation_proposals` rows (status=pending_review) for a human to prune/approve.
//
// SINGLE topic:
//   node scripts/curriculum_sweep.js --subject maths --topic "Circles" --year 9 [--dry-run]
//        [--source https://…pos.pdf] [--source ./spec.txt]
//
// BATCH (one subject + one year — sweeps every topic for that year):
//   node scripts/curriculum_sweep.js --subject maths --year 7            # prints the plan only
//   node scripts/curriculum_sweep.js --subject maths --year 7 --yes      # sweeps + writes
//        [--topics "Circles,Sequences"]  [--limit 5]  [--scheme NC]
//   Already-pending / already-approved topics are skipped automatically (re-runs are cheap).
//
// Env: ANTHROPIC_API_KEY (required to sweep), SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//      (required to write / to skip-existing). CLAUDE_MODEL optional.

const fs = require("fs");
const path = require("path");
const { parseSweepResult } = require("../curriculum");

const CLAUDE_API = process.env.CLAUDE_API || "https://api.anthropic.com/v1/messages";
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";
const MAX_TOKENS = Number(process.env.MAX_TOKENS) || 8000;
const SOURCE_CHAR_CAP = 20000; // per source, keep the prompt bounded
const BATCH_DELAY_MS = 1000;   // pause between batch calls

// ── Pure helpers (no network — exported for tests) ──

// Flat, de-duplicated topic list for a subject+year. year<=6 → KS1_2, else KS3_4
// (mirrors the frontend getCurriculum). Returns [] for an unknown subject/year.
function topicsFor(taxonomy, subject, year) {
  const subj = taxonomy && taxonomy[subject];
  if (!subj) return [];
  const cats = subj[Number(year) <= 6 ? "KS1_2" : "KS3_4"];
  if (!cats) return [];
  const seen = new Set();
  const out = [];
  for (const list of Object.values(cats)) {
    for (const t of list) { if (!seen.has(t)) { seen.add(t); out.push(t); } }
  }
  return out;
}

// Decide what a batch run will sweep: narrow to `requested` (if given), drop `existing`,
// cap at `limit`. `unknown` = requested topics not in the taxonomy (ignored, warned).
function planTargets({ topics, requested, existing, limit }) {
  const all = topics.slice();
  let list = all;
  let unknown = [];
  if (requested && requested.length) {
    const allSet = new Set(all);
    unknown = requested.filter((t) => !allSet.has(t));
    const want = new Set(requested);
    list = all.filter((t) => want.has(t));
  }
  const ex = new Set(existing || []);
  const skipped = list.filter((t) => ex.has(t));
  let toSweep = list.filter((t) => !ex.has(t));
  if (Number.isFinite(limit) && limit > 0) toSweep = toSweep.slice(0, limit);
  return { toSweep, skipped, unknown };
}

// ── I/O helpers ──

function parseArgs(argv) {
  const args = { sources: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--yes") args.yes = true;
    else if (a === "--source") args.sources.push(argv[++i]);
    else if (a.startsWith("--")) args[a.slice(2)] = argv[++i];
  }
  return args;
}

function fillTemplate(template, vars) {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{{${k}}}`, v);
  return out;
}

// Best-effort fetch of a source (URL or local file). Never throws — records reachability
// so an unreachable source degrades the sweep gracefully (distil from what's available).
async function loadSource(ref) {
  try {
    let text;
    if (/^https?:\/\//i.test(ref)) {
      const res = await fetch(ref);
      if (!res.ok) return { ref, type: "url", reachable: false, error: `HTTP ${res.status}`, text: "" };
      text = await res.text();
    } else {
      text = fs.readFileSync(ref, "utf-8");
    }
    const clipped = text.slice(0, SOURCE_CHAR_CAP);
    return { ref, type: /^https?:/i.test(ref) ? "url" : "file", reachable: true, chars: clipped.length, text: clipped };
  } catch (e) {
    return { ref, type: "unknown", reachable: false, error: e.message, text: "" };
  }
}

async function callClaude(apiKey, prompt) {
  const res = await fetch(CLAUDE_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

async function writeProposal(url, key, row) {
  const res = await fetch(`${url}/rest/v1/curation_proposals`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

// Topics that already have a pending_review proposal OR an approved object → skip set.
async function existingTargets(url, key, subject, year, scheme) {
  const enc = encodeURIComponent;
  const q = (p) => fetch(`${url}/rest/v1/${p}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  const base = `subject=eq.${enc(subject)}&year_group=eq.${year}&scheme=eq.${enc(scheme)}&select=topic`;
  const [props, objs] = await Promise.all([
    q(`curation_proposals?status=eq.pending_review&${base}`),
    q(`curriculum_objects?status=eq.approved&${base}`),
  ]);
  const set = new Set();
  [...(props || []), ...(objs || [])].forEach((r) => r && r.topic && set.add(r.topic));
  return set;
}

// Distil ONE topic → { payload, source_run }. Shared by single + batch modes.
async function sweepOne({ apiKey, subject, topic, year, scheme, sources }) {
  const loaded = [];
  for (const ref of sources || []) {
    process.stderr.write(`[sweep] loading source ${ref} … `);
    const s = await loadSource(ref);
    process.stderr.write(s.reachable ? `ok (${s.chars} chars)\n` : `UNREACHABLE (${s.error})\n`);
    loaded.push(s);
  }
  const sourceText = loaded.filter((s) => s.reachable).map((s) => `--- SOURCE: ${s.ref} ---\n${s.text}`).join("\n\n")
    || "(no operator sources supplied or reachable — rely on your own curriculum knowledge)";
  const template = fs.readFileSync(path.join(__dirname, "..", "prompts", "curriculum_sweep.txt"), "utf-8");
  const prompt = fillTemplate(template, { subject, topic, year: String(year), scheme, sources: sourceText });
  const raw = await callClaude(apiKey, prompt);
  const payload = parseSweepResult(raw); // validates shape; throws on garbage
  const source_run = {
    at: new Date().toISOString(),
    model: MODEL,
    sources: loaded.map((s) => ({ ref: s.ref, type: s.type, reachable: s.reachable, ...(s.error ? { error: s.error } : {}) })),
  };
  return { payload, source_run };
}

// ── Entry points ──

async function runSingle(args) {
  const { subject, topic, year, scheme = "NC", sources, dryRun } = args;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error("ANTHROPIC_API_KEY not set"); process.exit(2); }
  console.error(`[sweep] distilling ${subject} "${topic}" Y${year} (${scheme}) via ${MODEL} …`);
  const { payload, source_run } = await sweepOne({ apiKey, subject, topic, year, scheme, sources });
  console.error(`[sweep] proposal: ${payload.sub_strands.length} sub-strands, ${payload.misconceptions.length} misconceptions`);

  if (dryRun) {
    console.log(JSON.stringify({ subject, topic, year_group: Number(year), scheme, proposed_payload: payload, source_run }, null, 2));
    console.error("[sweep] --dry-run: not written.");
    return;
  }
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (use --dry-run to preview)"); process.exit(2); }
  const [written] = await writeProposal(url, key, {
    subject, topic, year_group: Number(year), scheme, proposed_payload: payload, source_run, status: "pending_review",
  });
  console.error(`[sweep] wrote curation_proposals row ${written?.id} (status=pending_review). Approve it in the admin app.`);
}

async function runBatch(args) {
  const { subject, year, scheme = "NC", sources } = args;
  const taxonomy = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "frontend", "curriculum_taxonomy.json"), "utf-8"));
  const topics = topicsFor(taxonomy, subject, year);
  if (!topics.length) { console.error(`[sweep] no topics in taxonomy for ${subject} year ${year}`); process.exit(2); }

  const requested = args.topics ? String(args.topics).split(",").map((s) => s.trim()).filter(Boolean) : null;
  const limit = args.limit ? Number(args.limit) : null;

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let existing = new Set();
  if (url && key) existing = await existingTargets(url, key, subject, year, scheme);
  else console.error("[sweep] no Supabase creds — skip-existing disabled (plan shows all topics).");

  const { toSweep, skipped, unknown } = planTargets({ topics, requested, existing, limit });
  if (unknown.length) console.error(`[sweep] WARNING: --topics not in taxonomy, ignored: ${unknown.join(", ")}`);
  console.error(`[sweep] PLAN ${subject} Y${year} (${scheme}): ${toSweep.length} to sweep, ${skipped.length} skipped (already pending/approved)${limit ? `, limit ${limit}` : ""}`);
  console.error(`        sweep: ${toSweep.join(", ") || "(none)"}`);
  if (skipped.length) console.error(`        skip:  ${skipped.join(", ")}`);

  if (args.dryRun || !args.yes) {
    console.error("[sweep] plan only — re-run with --yes to sweep (each topic is one Claude call).");
    return;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error("ANTHROPIC_API_KEY not set"); process.exit(2); }
  if (!url || !key) { console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required to write"); process.exit(2); }

  let created = 0, failed = 0;
  for (let i = 0; i < toSweep.length; i++) {
    const topic = toSweep[i];
    try {
      console.error(`[sweep] (${i + 1}/${toSweep.length}) ${topic} …`);
      const { payload, source_run } = await sweepOne({ apiKey, subject, topic, year, scheme, sources });
      await writeProposal(url, key, { subject, topic, year_group: Number(year), scheme, proposed_payload: payload, source_run, status: "pending_review" });
      console.error(`        ✓ ${payload.sub_strands.length} sub-strands, ${payload.misconceptions.length} misconceptions`);
      created++;
    } catch (e) {
      console.error(`        ✗ ${topic}: ${e.message}`);
      failed++;
    }
    if (i < toSweep.length - 1) await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }
  console.error(`[sweep] done: ${created} created, ${skipped.length} skipped, ${failed} failed. Review them in the admin Curriculum tab.`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.subject || !args.year) {
    console.error('Required: --subject <maths|science> --year <n>   (+ --topic "<chip>" for a single topic, else batch)');
    process.exit(2);
  }
  if (args.topic) await runSingle(args);
  else await runBatch(args);
}

if (require.main === module) {
  main().catch((e) => { console.error(`[sweep] failed: ${e.message}`); process.exit(1); });
}

module.exports = { topicsFor, planTargets };
