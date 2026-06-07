#!/usr/bin/env node
// BrightMind — offline curriculum sweep (Admin backend, Slice 2).
// Operator-run, NEVER the worker / hot path. Distils a MAXIMUM-RECALL union taxonomy
// (sub-strands + prerequisites + misconceptions, with provenance + year flags) for one
// topic/year via Claude, optionally grounded by operator-supplied sources, and writes a
// `curation_proposals` row (status=pending_review) for a human to prune and approve.
//
// Usage:
//   node scripts/curriculum_sweep.js --subject maths --topic "Expressions & Equations" --year 7 [--scheme NC]
//        [--source https://www.gov.uk/...pos.pdf] [--source ./local/spec.txt] [--dry-run]
//
// Env: ANTHROPIC_API_KEY (required), and for a real write SUPABASE_URL +
//      SUPABASE_SERVICE_ROLE_KEY. CLAUDE_MODEL optional (defaults to the worker default).

const fs = require("fs");
const path = require("path");
const { parseSweepResult } = require("../curriculum");

const CLAUDE_API = process.env.CLAUDE_API || "https://api.anthropic.com/v1/messages";
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";
const MAX_TOKENS = Number(process.env.MAX_TOKENS) || 8000;
const SOURCE_CHAR_CAP = 20000; // per source, keep the prompt bounded

function parseArgs(argv) {
  const args = { sources: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
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

async function main() {
  const args = parseArgs(process.argv);
  const { subject, topic, year, scheme = "NC", sources, dryRun } = args;
  if (!subject || !topic || !year) {
    console.error('Required: --subject <maths|science> --topic "<exact topic chip>" --year <n>');
    process.exit(2);
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error("ANTHROPIC_API_KEY not set"); process.exit(2); }

  // Assemble source material (best-effort).
  const loaded = [];
  for (const ref of sources) {
    process.stderr.write(`[sweep] loading source ${ref} … `);
    const s = await loadSource(ref);
    process.stderr.write(s.reachable ? `ok (${s.chars} chars)\n` : `UNREACHABLE (${s.error})\n`);
    loaded.push(s);
  }
  const sourceText = loaded.filter((s) => s.reachable).map((s) => `--- SOURCE: ${s.ref} ---\n${s.text}`).join("\n\n")
    || "(no operator sources supplied or reachable — rely on your own curriculum knowledge)";

  // Distil.
  const template = fs.readFileSync(path.join(__dirname, "..", "prompts", "curriculum_sweep.txt"), "utf-8");
  const prompt = fillTemplate(template, {
    subject, topic, year: String(year), scheme, sources: sourceText,
  });
  console.error(`[sweep] distilling ${subject} "${topic}" Y${year} (${scheme}) via ${MODEL} …`);
  const raw = await callClaude(apiKey, prompt);
  const payload = parseSweepResult(raw); // validates shape; throws on garbage

  const source_run = {
    at: new Date().toISOString(),
    model: MODEL,
    sources: loaded.map((s) => ({ ref: s.ref, type: s.type, reachable: s.reachable, ...(s.error ? { error: s.error } : {}) })),
  };
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

main().catch((e) => { console.error(`[sweep] failed: ${e.message}`); process.exit(1); });
