#!/usr/bin/env node
// BrightMind — depth-tag reliability check (CR-022 cont., amendment 2).
// Operator-run, NEVER the worker / hot path. Measures how often the generator's `depth`
// tag agrees with an INDEPENDENT second-pass judgement — the depth axis is otherwise
// model-judging-model, so we quantify it before trusting it. The parent MASTERY
// recommendation stays OBSERVED ("practised", not a verdict) until this number clears the
// agreed threshold (see DEF-049 / the session handover).
//
//   node scripts/depth_tag_check.js [--limit 40] [--subject maths] [--year 7]
//
// Env: ANTHROPIC_API_KEY (required), SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (required —
//      reads recent depth-tagged rows from question_bank). CLAUDE_MODEL optional. Uses a
//      DIFFERENT phrasing from question_gen.txt so the judge isn't just echoing the tag.
//
// Output: agreement % + a confusion table (tagged→judged). Record the number in the
// session handover; do NOT flip the recommendation to "confident" below threshold.

const { agreementStats } = require("../coverage");
const { DEPTH_BANDS } = require("../curriculum");

const CLAUDE_API = process.env.CLAUDE_API || "https://api.anthropic.com/v1/messages";
// DEF-053: no hardcoded model id. Read from runtime_config (admin config page), the same
// CLAUDE_MODEL key the worker reads; assigned in the entry point. This script already
// requires Supabase creds, so the config read always has a service-role connection.
let MODEL;

// Source of truth is runtime_config; CLAUDE_MODEL env is an offline fallback; throws if
// neither yields a model (never substitutes a buried, possibly-retired default).
async function resolveModel(url, key) {
  try {
    const rows = await fetch(`${url}/rest/v1/runtime_config?key=eq.CLAUDE_MODEL&select=value`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }).then((r) => (r.ok ? r.json() : []));
    const v = Array.isArray(rows) && rows[0] ? rows[0].value : null;
    if (typeof v === "string" && v.trim()) return v.trim();
  } catch (_) { /* fall through to env */ }
  if (process.env.CLAUDE_MODEL) return process.env.CLAUDE_MODEL;
  throw new Error("CLAUDE_MODEL not set in runtime_config (admin config page) and no CLAUDE_MODEL env fallback");
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function supa(url, key, path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

// Independent depth classifier — deliberately worded unlike the generation prompt, judging
// the KIND of thinking the question demands, not its difficulty.
async function judgeDepth(apiKey, q) {
  const prompt =
    `Classify the cognitive demand of this question into EXACTLY one band. Judge the KIND ` +
    `of thinking required, not how hard the numbers are.\n` +
    `- recall: states a known fact/convention directly.\n` +
    `- procedure: carries out one standard method/step.\n` +
    `- application: applies in a context, or combines two steps.\n` +
    `- reasoning: multi-step, works backwards, justifies, or finds/explains an error.\n\n` +
    `Question: ${q.q}\nOptions: ${(q.o || []).join(" | ")}\n\n` +
    `Reply with ONLY the one band word.`;
  const res = await fetch(CLAUDE_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 16, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const d = await res.json();
  const raw = d.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim().toLowerCase();
  return DEPTH_BANDS.find((b) => raw.includes(b)) || null;
}

(async () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiKey || !url || !key) {
    console.error("Need ANTHROPIC_API_KEY + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  MODEL = await resolveModel(url, key);
  const limit = Number(arg("limit", "40"));
  let filter = "depth=not.is.null&select=q,o,depth&order=created_at.desc&limit=" + limit;
  if (arg("subject")) filter += `&subject=eq.${encodeURIComponent(arg("subject"))}`;
  if (arg("year")) filter += `&year_group=eq.${arg("year")}`;

  const rows = await supa(url, key, `question_bank?${filter}`);
  if (!rows.length) {
    console.error("No depth-tagged rows in question_bank yet — generate some 2D-tagged questions first.");
    process.exit(1);
  }
  console.log(`Judging ${rows.length} depth-tagged question(s) with an independent classifier (${MODEL})…`);

  const pairs = [];
  for (const r of rows) {
    try {
      const judged = await judgeDepth(apiKey, r);
      pairs.push({ tagged: r.depth, judged });
      await new Promise((res) => setTimeout(res, 400));
    } catch (e) { console.error(`  skip: ${e.message}`); }
  }

  const s = agreementStats(pairs);
  console.log(`\nDEPTH-TAG AGREEMENT: ${(s.pct * 100).toFixed(1)}%  (${s.agree}/${s.n})`);
  const conf = Object.entries(s.confusion).sort((a, b) => b[1] - a[1]);
  if (conf.length) {
    console.log("Mismatches (tagged → judged):");
    conf.forEach(([k, n]) => console.log(`  ${k}: ${n}`));
  }
  console.log("\nRecord this number in the session handover. Keep the parent recommendation");
  console.log("OBSERVED (not a mastery verdict) until it clears the agreed threshold.");
})();
