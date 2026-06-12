// BrightMind V2 — GCP Cloud Function Worker
// Pipeline: Bank → Generate (text only) → Compute Engine → Draw Diagrams (Claude SVG) → Review (Audit + Child Agent, one call) → Bank Write
// CR-016: Audit and Child Agent merged into a single combined-prompt Claude call (Stage 4) — halves the model round-trips in the old stages 4–5.
// Prompts loaded from /prompts/ directory — edit prompts without code changes.
// DEF-033 fix: questions requiring diagrams are dropped if diagram generation fails (not served diagramless)
// DEF-040 fix: diagram stage routed to a dedicated (stronger) model — diagram quality was a model gap,
//              not a prompt gap. Question generation stays on the default model; diagrams use DIAGRAM_MODEL.
// DEF-041 fix: Stage 2 is now a deterministic Compute Engine. The old verify() trusted the
//              explanation's arithmetic and overwrote c to match it — cementing generator errors.
//              The engine recomputes the answer from compute.inputs ALONE (never reads c or e),
//              then confirms/corrects c, or REJECTS the question. Fail-closed: a question tagged
//              verify:"arithmetic" with a missing/invalid/unknown compute block is rejected, not
//              waved through. Rejected questions flow into the existing top-up.

const fs = require("fs");
const path = require("path");
// Curriculum curation (Slice 2): pure steering logic shared with the offline sweep.
// CR-022 (cont.): + sub-strand alignment and the depth-band normaliser for 2D tagging.
const { buildCurriculumGuidance, approvedSubStrandIndex, normaliseDepth } = require("./curriculum");
// CR-022 (cont.): per-child coverage matrix + width-adaptive driver (pure, see coverage.js).
const { buildCoverageMatrix, buildCoverageTargetGuidance, untestedCells } = require("./coverage");

const CLAUDE_API = process.env.CLAUDE_API || "https://api.anthropic.com/v1/messages";
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";
// DEF-040: diagrams need a stronger model than text generation. Default to Opus 4.7.
const DIAGRAM_MODEL = process.env.DIAGRAM_MODEL || "claude-opus-4-7";
// Token caps are env-driven (DEF-037) so they can be tuned in the deploy env without a
// code change. Fallbacks equal the previous hardcoded values, so an unset var changes
// nothing on deploy — set a var only to OVERRIDE its fallback.
const MAX_TOKENS = Number(process.env.MAX_TOKENS) || 8000;
const DIAGRAM_MAX_TOKENS = Number(process.env.DIAGRAM_MAX_TOKENS) || 16000;

// Admin backend (first slice): the four dials above can be overridden live from the
// Supabase `runtime_config` table (see getConfig) without a redeploy. CONFIG_DEFAULTS
// is the env/hardcoded fallback used when a key is absent or the table is unreachable,
// so an empty/missing config reproduces today's behaviour exactly. It is also the
// default `cfg` for the pipeline functions, keeping their behaviour unchanged when
// called without a resolved config (e.g. from tests).
const CONFIG_DEFAULTS = {
  model: MODEL,
  diagramModel: DIAGRAM_MODEL,
  maxTokens: MAX_TOKENS,
  diagMaxTokens: DIAGRAM_MAX_TOKENS,
};

// ── Prompt Loader ──

const promptCache = {};

function loadPrompt(name) {
  if (promptCache[name]) return promptCache[name];
  const filePath = path.join(__dirname, "prompts", `${name}.txt`);
  const text = fs.readFileSync(filePath, "utf-8").trim();
  promptCache[name] = text;
  return text;
}

function fillTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

// ── Helpers ──

function qh(q) {
  return Buffer.from(encodeURIComponent(q.trim().toLowerCase().slice(0, 80))).toString("base64").slice(0, 40);
}

function dedup(qs) {
  const s = new Set();
  return qs.filter((q) => {
    const k = q.q?.trim().toLowerCase().slice(0, 80);
    if (!k || s.has(k)) return false;
    s.add(k);
    return true;
  });
}

// callClaude — `model` param lets a stage override the default model (DEF-040).
// `messages` may be a plain string (single user turn) or an array of
// {role, content} message objects for a multi-turn prompt.
async function callClaude(apiKey, messages, maxTokens = MAX_TOKENS, system = null, model = MODEL) {
  const msgs = typeof messages === "string"
    ? [{ role: "user", content: messages }]
    : messages;

  const body = { model, max_tokens: maxTokens, messages: msgs };
  if (system) body.system = system;

  const res = await fetch(CLAUDE_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

async function supaFetch(url, key, path, opts = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok && opts.method !== "PATCH" && opts.method !== "POST") {
    throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  }
  if (opts.headers?.Prefer?.includes("return=minimal")) return null;
  return res.json();
}

// ── Runtime Config (admin backend — first slice) ──
// Adjustable dials live in the Supabase `runtime_config` table so they can be retuned
// without a redeploy. Reads are cached per worker instance with a short TTL; on any
// miss or error we fall back to the env/hardcoded default, so an empty or unreachable
// table reproduces today's behaviour exactly. The worker uses the service-role key,
// which bypasses RLS. `fetcher` is injectable so the cache/fallback logic is unit-
// testable without a network (see config.test.js).
const CONFIG_TTL_MS = Number(process.env.CONFIG_TTL_MS) || 60000;
const configCache = {};

// Pure: coerce a `runtime_config` row to a typed value, or return the fallback when
// the row or its value is absent. Exported for tests.
function _parseConfigValue(row, fallback) {
  if (!row || row.value === undefined || row.value === null) return fallback;
  const { value, value_type } = row;
  switch (value_type) {
    case "number": { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
    case "bool": return value === true || value === "true";
    case "string": return String(value);
    default: return value; // json / unspecified — pass through as stored
  }
}

async function getConfig(url, key, configKey, fallback, fetcher = supaFetch) {
  const now = Date.now();
  const hit = configCache[configKey];
  if (hit && hit.expires > now) return hit.value;
  try {
    const rows = await fetcher(url, key,
      `runtime_config?key=eq.${encodeURIComponent(configKey)}&select=value,value_type`);
    const row = rows && rows[0];
    const fromConfig = !!(row && row.value !== undefined && row.value !== null);
    const value = _parseConfigValue(row, fallback);
    configCache[configKey] = { value, expires: now + CONFIG_TTL_MS, fromConfig };
    return value;
  } catch (e) {
    console.error(`[Config] read failed for ${configKey}, using fallback: ${e.message}`);
    return fallback;
  }
}

// ── Curriculum read (admin backend — Slice 2) ──
// Fetch the APPROVED curriculum_objects for the requested topics so generation can be
// steered by human-signed-off sub-strands. Returns the matching rows (the pure
// latest-version-per-topic + guidance shaping lives in curriculum.js). Any error or no
// match → [] → the generator falls back to its own sub-skill enumeration (no behaviour
// change). The worker uses the service-role key (bypasses RLS).
async function getApprovedCurriculum(url, key, subject, yr, topics) {
  if (!Array.isArray(topics) || topics.length === 0) return [];
  try {
    const inList = topics.map((t) => `"${String(t).replace(/"/g, '\\"')}"`).join(",");
    const rows = await supaFetch(url, key,
      `curriculum_objects?status=eq.approved&subject=eq.${encodeURIComponent(subject)}` +
      `&year_group=eq.${yr}&topic=in.(${encodeURIComponent(inList)})` +
      `&select=topic,year_group,version,status,payload&order=version.desc`);
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.error(`[Curriculum] read failed, falling back to self-enumeration: ${e.message}`);
    return [];
  }
}

// ── CR-022 (cont.): child coverage read ──
// Recent completed results (with their per-question answer records) for the coverage
// matrix. The matrix is a projection over these rows — no separate matrix table. Errors
// or no data → [] → no steering (fallback preserved). Service-role read.
async function getChildResults(url, key, childId, limit = 20) {
  if (!childId) return [];
  try {
    const rows = await supaFetch(url, key,
      `results?child_id=eq.${childId}&order=completed_at.desc&limit=${limit}&select=answers`);
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.error(`[Coverage] child results read failed (no steering): ${e.message}`);
    return [];
  }
}

// ── Stage 0: Bank Read ──

async function getSeen(url, key, childId, topics) {
  const h = new Set();
  const t = [];
  if (!childId) return { h, t };
  try {
    const rows = await supaFetch(url, key,
      `child_question_history?child_id=eq.${childId}&topic=in.(${topics.map(t => encodeURIComponent(t)).join(",")})&select=question_hash&order=served_at.desc&limit=200`
    );
    (rows || []).forEach((x) => h.add(x.question_hash));
  } catch (e) {}
  try {
    const rows = await supaFetch(url, key,
      `results?child_id=eq.${childId}&order=completed_at.desc&limit=10&select=answers`
    );
    (rows || []).forEach((r) => {
      (r.answers || []).forEach((a) => {
        const q = a.question || a.q;
        if (q && typeof q === "string") t.push(q.trim().slice(0, 80));
      });
    });
    const u = [...new Set(t)].slice(0, 30);
    t.length = 0;
    t.push(...u);
  } catch (e) {}
  return { h, t };
}

async function adaptBank(url, key, subj, yr, topics, diff, cnt, prev, seen, gapSubStrands = []) {
  const ids = new Set();
  const c = [];
  async function tier(df, rem) {
    if (rem <= 0) return;
    const ef = prev.length ? `&id=not.in.(${prev.join(",")})` : "";
    const cf = ids.size ? `&id=not.in.(${[...ids].join(",")})` : "";
    const results = await Promise.all(
      topics.map((t) =>
        supaFetch(url, key,
          `question_bank?subject=eq.${encodeURIComponent(subj)}&topic=eq.${encodeURIComponent(t)}&year_group=eq.${yr}${df}&order=audit_score.desc,last_served_at.asc.nullsfirst&limit=${rem}${ef}${cf}`
        ).catch(() => [])
      )
    );
    let rows = results.flat();
    if (seen.size) rows = rows.filter((r) => !seen.has(qh(r.q)));
    rows = rows.filter((r) => !ids.has(r.id));
    rows.sort(() => Math.random() - 0.5).slice(0, rem).forEach((r) => {
      ids.add(r.id);
      // CR-022 (cont.): carry the 2D coverage tags so bank-sourced questions stay on the
      // matrix (and the chip strip) just like generated ones. subtopic kept as alias.
      const sub = r.sub_strand || r.subtopic || null;
      c.push({
        q: r.q, o: r.o, c: r.c, e: r.e,
        ...(r.svg ? { svg: r.svg } : {}),
        ...(sub ? { subStrand: sub, subtopic: sub } : {}),
        ...(r.depth ? { depth: r.depth } : {}),
        _fromBank: true, _bankId: r.id,
      });
    });
  }
  try {
    // CR-022 (cont.) Slice E: a child with coverage gaps gets gap-cell bank rows FIRST —
    // top-up fills a width/depth gap, not just a count shortfall. PostgREST `in.()` filter
    // on sub_strand; falls through to the difficulty/any tiers below for a sparse bank.
    if (gapSubStrands.length) {
      const inList = gapSubStrands.map((s) => `"${String(s).replace(/"/g, '\\"')}"`).join(",");
      await tier(`&sub_strand=in.(${encodeURIComponent(inList)})`, cnt);
    }
    if (c.length < cnt) await tier(`&difficulty=eq.${encodeURIComponent(diff)}`, cnt - c.length);
    if (c.length < cnt) await tier("", cnt - c.length);
    if (ids.size) {
      await fetch(`${url}/rest/v1/question_bank?id=in.(${[...ids].join(",")})`, {
        method: "PATCH",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ last_served_at: new Date().toISOString() }),
      });
    }
  } catch (e) {}
  return c;
}

// ── Read recent rejections for feedback loop ──

async function getRecentRejections(url, key, subj, yr) {
  try {
    const rows = await supaFetch(url, key,
      `question_rejections?subject=eq.${encodeURIComponent(subj)}&year_group=eq.${yr}&order=created_at.desc&limit=50&select=reason,note,question_text`
    );
    return rows || [];
  } catch (e) {
    return [];
  }
}

// ── Stage 1: Generate questions (TEXT ONLY) ──

function buildPrompt(subj, yr, topics, diff, n, excl, rejections = [], curriculum = "", coverageTarget = "") {
  const exStr = excl.length ? `\nDo NOT repeat these questions:\n${excl.map((q, i) => `${i + 1}. ${q}`).join("\n")}` : "";

  let rejStr = "";
  if (rejections.length > 0) {
    // Grouped count of preset/category reasons.
    const grouped = {};
    rejections.forEach((r) => {
      const reason = r.reason || "unspecified";
      grouped[reason] = (grouped[reason] || 0) + 1;
    });
    const summary = Object.entries(grouped)
      .map(([reason, count]) => `- ${reason} (${count}x)`).join("\n");
    // Free-text notes — parent-written explanations (CR-020) and pipeline
    // verifier reasons (CR-019). De-duplicated, capped, quoted verbatim because
    // the specific wording is the strongest self-correction signal.
    const notes = [...new Set(
      rejections.map((r) => (r.note || "").trim()).filter((n) => n.length > 0)
    )].slice(0, 12);
    const noteStr = notes.length
      ? `\nSpecific notes on what was wrong:\n${notes.map((n) => `- ${n}`).join("\n")}\n`
      : "";
    rejStr = `\nFEEDBACK — these issues were flagged on previous questions for this subject and year group (by parents reviewing them, and by automatic verification). Do NOT repeat these problems:\n${summary}\n${noteStr}`;
  }

  const template = loadPrompt("question_gen");
  return fillTemplate(template, {
    count: String(n),
    year: String(yr),
    subject: subj,
    topics: topics.join(", "),
    difficulty: diff,
    age_low: String(yr + 4),
    age_high: String(yr + 5),
    // Slice 2: approved-curriculum steering block (empty string → self-enumeration fallback).
    curriculum: curriculum,
    // CR-022 (cont.) Slice D: width-adaptive coverage-target block (empty string → no
    // steering, prompt identical to today). Soft steer, composes with difficulty.
    coverage_target: coverageTarget,
    rejections: rejStr,
    exclusions: exStr,
  });
}

async function generate(apiKey, subj, yr, topics, diff, n, excl = [], rejections = [], cfg = CONFIG_DEFAULTS, curriculum = [], coverageTarget = "") {
  const guidance = buildCurriculumGuidance(curriculum);
  const prompt = buildPrompt(subj, yr, topics, diff, n, excl, rejections, guidance, coverageTarget);
  const raw = await callClaude(apiKey, prompt, cfg.maxTokens, null, cfg.model);
  const qs = JSON.parse(raw.replace(/```json|```/g, "").trim());
  if (!Array.isArray(qs) || !qs.length) throw new Error("Empty generation");

  // CR-022 (cont.) Slice A: a flat matcher over every requested topic's approved
  // sub-strands. Aligns a generator label to the canonical human-approved name so the
  // coverage matrix keys on the signed-off names; an off-list label is kept + warned,
  // never dropped (steer-with-fallback). Empty when nothing approved (today's behaviour).
  const idx = approvedSubStrandIndex(curriculum);
  const hasApproved = idx.byTopic.size > 0;
  const matchSubStrand = (label) => {
    for (const t of idx.byTopic.values()) { const m = t.match(label); if (m) return m; }
    return null;
  };

  return qs
    .filter((q) => q.q && Array.isArray(q.o) && q.o.length === 4 && typeof q.c === "number")
    .map((q) => {
      // CR-022 (cont.) Slice A: 2D tag. subStrand (width) falls back to the legacy
      // `subtopic` if the model only emitted that; depth (orthogonal axis) is normalised
      // to one of the 4 bands or null (kept, never dropped — null = depth unknown).
      const rawSub = (typeof q.subStrand === "string" && q.subStrand.trim()) ? q.subStrand.trim()
        : (typeof q.subtopic === "string" && q.subtopic.trim()) ? q.subtopic.trim() : null;
      let subStrand = rawSub;
      if (rawSub && hasApproved) {
        const canonical = matchSubStrand(rawSub);
        if (canonical) subStrand = canonical;
        else console.warn(`[Coverage] subStrand "${rawSub}" matches no approved sub-strand — keeping label, depth axis unaffected`);
      }
      const depth = normaliseDepth(q.depth);
      return {
      q: q.q,
      o: q.o,
      c: q.c,
      e: q.e || `Option ${q.c + 1}.`,
      // CR-022 (cont.): 2D coverage tag. subStrand = width (sub-skill), depth = cognitive
      // band. subtopic kept as a deprecated alias (= subStrand) for one release so older
      // screens/bank rows keep working. All carried through the pipeline and banked.
      subStrand,
      depth,
      subtopic: subStrand,
      needsDiagram: !!q.needsDiagram,
      diagramPrompt: q.diagramPrompt || null,
      // DEF-041: routing tag + structured working. Defaults keep legacy/non-numeric
      // questions on the "none" track (untouched by the compute engine).
      verify: (q.verify === "arithmetic" || q.verify === "equation_balance") ? q.verify : "none",
      compute: (q.compute && typeof q.compute === "object") ? q.compute : null,
      };
    });
}

// ── Stage 2: Compute Engine (DEF-041) ──
// Deterministic answer verifier. Lives in its own module (compute.js) so it is
// independently unit-testable (see compute.test.js). It recomputes the answer
// from the compute block ALONE — never reads the model's c or e — then confirms c,
// corrects c to the VERIFIED value, or rejects the question (fail-closed).
// verify:"arithmetic" covers the legacy single-ops plus the formula (multi-step
// expression) and solve_for (algebra-by-substitution) ops; verify:"equation_balance"
// is now verified by atom conservation when a compute block is present. Only
// verify:"none" (and equation_balance with no compute block) passes through to the
// audit agent.
const { computeVerify: verify } = require("./compute");

// ── Stage 3: Claude SVG Diagram Generation ──
// DEF-040: this stage runs on DIAGRAM_MODEL (Opus), not the default text model.

async function drawDiagram(apiKey, question, yr, subj, cfg = CONFIG_DEFAULTS) {
  const diagramDesc = question.diagramPrompt || `Draw a diagram for this Year ${yr} ${subj} question: "${question.q}"`;

  const diagramUserTemplate = loadPrompt("diagram_user");
  const prompt = fillTemplate(diagramUserTemplate, {
    diagram_prompt: diagramDesc,
  });

  const systemPrompt = loadPrompt("diagram_system");

  console.log(`[Diagram] Model: ${cfg.diagramModel} | Prompt: ${diagramDesc.slice(0, 500)}`);

  const raw = await callClaude(apiKey, prompt, cfg.diagMaxTokens, systemPrompt, cfg.diagramModel);
  const svgMatch = raw.match(/<svg[\s\S]*<\/svg>/i);
  if (!svgMatch) {
    console.error(`[Diagram] No SVG found in response. Raw (first 500 chars): ${raw.slice(0, 500)}`);
    return null;
  }
  return svgMatch[0].trim();
}

async function processDiagrams(apiKey, qs, yr, subj, cfg = CONFIG_DEFAULTS) {
  const results = [];

  for (const q of qs) {
    if (!q.needsDiagram) {
      results.push(q);
      continue;
    }

    let svg = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      console.log(`[Diagram] Attempt ${attempt} for: "${q.q.slice(0, 80)}"`);
      try {
        svg = await drawDiagram(apiKey, q, yr, subj, cfg);
        if (svg) {
          console.log(`[Diagram] Success (${svg.length} chars)`);
          break;
        } else {
          console.error(`[Diagram] Attempt ${attempt} returned no valid SVG`);
        }
      } catch (e) {
        console.error(`[Diagram] Attempt ${attempt} error: ${e.message}`);
        if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
      }
    }

    if (svg) {
      results.push({ ...q, svg });
    } else {
      console.error(`[Diagram] DROPPED question — diagram required but generation failed after 2 attempts. Question: "${q.q}" | diagramPrompt: "${(q.diagramPrompt || '').slice(0, 500)}"`);
    }
  }

  return results;
}

// ── Stage 4: Review (Audit + Child Agent merged — CR-016) ──
// One Claude call drives both the curriculum auditor and the Year-N student check
// (was two sequential calls). The combined prompt returns {audit, child} verdicts
// per question; the pure merge logic lives in review.js so it stays unit-testable.
const { buildReviewQuestions, applyReview } = require("./review");

async function review(apiKey, qs, yr, subj, cfg = CONFIG_DEFAULTS) {
  if (!qs.length) return qs;
  try {
    const template = loadPrompt("review");
    const prompt = fillTemplate(template, {
      year: String(yr),
      subject: subj,
      age_low: String(yr + 4),
      age_high: String(yr + 5),
      questions_json: JSON.stringify(buildReviewQuestions(qs)),
    });

    // 4000 tokens covers the auditor's rewrite headroom (was 3000) plus the small
    // child payload (was 1500), in a single round-trip. The review model follows the
    // text dial (cfg.model); the 4000-token cap is fixed (independent of MAX_TOKENS).
    const raw = await callClaude(apiKey, prompt, 4000, null, cfg.model);
    const results = JSON.parse(raw.replace(/```json|```/g, "").trim());

    return applyReview(qs, results);
  } catch (e) {
    // Fail-open, as the old audit()/childAgent() did: a model/parse error lets
    // questions pass through rather than dropping the whole batch.
    console.error("Review error:", e);
    return qs;
  }
}

// ── Stage 6: Bank Write ──

async function bankWrite(url, key, qs, subj, yr, topics, diff) {
  // _computeFailed questions are filtered out before this stage, but the guard is
  // kept here as defence-in-depth — a compute-rejected question must never be banked.
  const store = qs.filter((q) => !q._fromBank && !q._auditFailed && !q._childFailed && !q._computeFailed && q.q);
  if (!store.length) return;
  const rows = store.map((q) => ({
    subject: subj, year_group: yr, topic: q._topic || topics[0],
    // CR-022 (cont.): persist the 2D tags. subtopic kept (= subStrand) as the deprecated
    // alias column; sub_strand + depth are the new 2D coverage columns (migration 0003).
    subtopic: q.subStrand || q.subtopic || null, sub_strand: q.subStrand || q.subtopic || null, depth: q.depth || null,
    difficulty: diff,
    q: q.q, o: q.o, c: q.c, e: q.e, ...(q.svg ? { svg: q.svg } : {}),
    audit_score: q._auditRewritten ? 0.7 : 0.9, source: "claude", content_hash: qh(q.q),
  }));
  try {
    await fetch(`${url}/rest/v1/question_bank`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
  } catch (e) { console.error("Bank write error:", e); }
}

async function record(url, key, childId, qs, subj, topics) {
  if (!childId || !qs.length) return;
  try {
    const rows = qs.filter((q) => q.q).map((q) => ({
      child_id: childId, question_hash: qh(q.q), topic: q._topic || topics[0] || null, subject: subj,
    }));
    await fetch(`${url}/rest/v1/child_question_history`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
  } catch (e) {}
}

async function updateJob(url, key, jobId, update) {
  await fetch(`${url}/rest/v1/generation_jobs?id=eq.${jobId}`, {
    method: "PATCH",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(update),
  });
}

// ── Main Handler ──

const functions = require("@google-cloud/functions-framework");

functions.http("worker", async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey || !url || !key) { res.status(500).json({ error: "Missing env vars" }); return; }

  const { jobId } = req.body;
  if (!jobId) { res.status(400).json({ error: "Missing jobId" }); return; }

  try {
    const jobs = await supaFetch(url, key, `generation_jobs?id=eq.${jobId}`);
    if (!jobs?.length) { res.status(404).json({ error: "Job not found" }); return; }
    const job = jobs[0];
    if (job.status !== "pending") { res.status(200).json({ status: "already_processed" }); return; }

    await updateJob(url, key, jobId, { status: "processing", started_at: new Date().toISOString() });

    const { subject, year_group: yr, topics, difficulty, question_count: count, child_id: childId, previous_ids: previousIds } = job;

    // Resolve the live dials from runtime_config (admin backend), each falling back to
    // its env/hardcoded default. Concurrency-safe: cfg is per-job, never module state.
    const cfg = {
      model: await getConfig(url, key, "CLAUDE_MODEL", MODEL),
      diagramModel: await getConfig(url, key, "DIAGRAM_MODEL", DIAGRAM_MODEL),
      maxTokens: await getConfig(url, key, "MAX_TOKENS", MAX_TOKENS),
      diagMaxTokens: await getConfig(url, key, "DIAGRAM_MAX_TOKENS", DIAGRAM_MAX_TOKENS),
    };
    // DEF-040 discipline: log every resolved variable, and whether it came from the
    // config table or the fallback default — a live override must be visible in logs.
    const src = (k) => (configCache[k]?.fromConfig ? "config" : "default");
    console.log(`[Job ${jobId}] Starting: ${subject} Y${yr} ${topics.join(",")} ${difficulty} x${count} | text=${cfg.model}(${src("CLAUDE_MODEL")}) diagram=${cfg.diagramModel}(${src("DIAGRAM_MODEL")}) | maxTok=${cfg.maxTokens}(${src("MAX_TOKENS")}) diagMaxTok=${cfg.diagMaxTokens}(${src("DIAGRAM_MAX_TOKENS")})`);

    // Slice 2: resolve approved curriculum objects for the requested topics. Steers
    // generation toward human-signed-off sub-strands; topics with no approved object
    // fall back to the generator's own enumeration (no behaviour change).
    const curriculum = await getApprovedCurriculum(url, key, subject, yr, topics);
    const covered = new Set(curriculum.filter((c) => c.status === "approved").map((c) => c.topic));
    console.log(`[Job ${jobId}] Curriculum: ${covered.size}/${topics.length} topic(s) steered by approved objects${covered.size ? ` (${[...covered].join(", ")})` : ""}, ${topics.length - covered.size} self-enumerated`);

    // CR-022 (cont.) Slices D+E: build the child's coverage matrix (projection over recent
    // results) so generation can be steered toward untested/weak cells (coverageTarget,
    // soft) and the bank read can prefer gap-cell rows (gapSubStrands). No child / no
    // tagged history / no gaps → both empty → behaviour identical to today (fallback).
    // Depth and difficulty are orthogonal: this steers WHICH cell, not how hard.
    let coverageTarget = "", gapSubStrands = [];
    if (childId) {
      try {
        const childResults = await getChildResults(url, key, childId);
        const matrix = buildCoverageMatrix(childResults);
        // Union of every requested topic's approved sub-strands = the grid denominator, so
        // never-seen sub-strands surface as untested width gaps (not just depth gaps within
        // seen ones). Null when nothing approved → falls back to observed sub-strands.
        const mergedSubs = curriculum.flatMap((o) => (o.payload && o.payload.sub_strands) || []);
        const covObj = mergedSubs.length ? { payload: { sub_strands: mergedSubs } } : null;
        const weakPct = await getConfig(url, key, "COVERAGE_WEAK_PCT", 0.6);
        coverageTarget = buildCoverageTargetGuidance(matrix, covObj, { weakPct });
        gapSubStrands = [...new Set(untestedCells(matrix, covObj, { weakPct }).map((c) => c.subStrand))];
        if (coverageTarget) console.log(`[Job ${jobId}] Coverage driver: steering toward ${gapSubStrands.length} gap sub-strand(s) [${gapSubStrands.slice(0, 6).join(", ")}]`);
      } catch (e) { console.error(`[Job ${jobId}] Coverage matrix build failed (no steering): ${e.message}`); }
    }

    // Stage 0: Bank
    let seen = new Set(), recent = [];
    if (childId) { const d = await getSeen(url, key, childId, topics); seen = d.h; recent = d.t; }
    let bq = await adaptBank(url, key, subject, yr, topics, difficulty, count, previousIds || [], seen, gapSubStrands);
    const need = count - bq.length;
    console.log(`[Job ${jobId}] Stage 0: Bank ${bq.length}/${count}, need ${need}`);

    if (need <= 0) {
      if (childId) await record(url, key, childId, bq, subject, topics);
      await updateJob(url, key, jobId, { status: "complete", questions: bq, source: "bank", bank_supplied: bq.length, completed_at: new Date().toISOString() });
      res.status(200).json({ status: "complete", count: bq.length });
      return;
    }

    // Stage 1: Generate (text only, with diagramPrompt + verify/compute where needed)
    const excl = [...recent, ...bq.map((q) => q.q?.trim().slice(0, 80)).filter(Boolean)];
    const rejections = await getRecentRejections(url, key, subject, yr);
    if (rejections.length) console.log(`[Job ${jobId}] Loaded ${rejections.length} parent rejections for feedback`);
    let generated = await generate(apiKey, subject, yr, topics, difficulty, need, excl, rejections, cfg, curriculum, coverageTarget);
    if (seen.size) generated = generated.filter((q) => !seen.has(qh(q.q)));
    console.log(`[Job ${jobId}] Stage 1: Generated ${generated.length} (${generated.filter(q => q.needsDiagram).length} need diagrams)`);

    // Stage 2: Compute Engine — reject questions whose answer fails verification (DEF-041)
    const verifiedAll = verify(generated, subject);
    const verified = verifiedAll.filter((q) => !q._computeFailed);
    const computeRejected = verifiedAll.length - verified.length;
    if (computeRejected) {
      verifiedAll.filter((q) => q._computeFailed).forEach((q) =>
        console.error(`[Job ${jobId}] Compute REJECT: "${q.q?.slice(0, 80)}" — ${q._computeReason}`));
    }
    console.log(`[Job ${jobId}] Stage 2: Compute ${verified.length}/${verifiedAll.length} verified (${computeRejected} rejected, ${verified.filter(q => q._computeCorrected).length} c-corrected)`);

    // CR-019: collect this job's own pipeline rejections (compute/audit/child) as
    // free-text feedback, shaped like parent rejections {reason, question_text}, so
    // the top-up generate() call can avoid repeating the same faults.
    const pipelineRejections = verifiedAll
      .filter((q) => q._computeFailed)
      .map((q) => ({ reason: "automatic verification", note: q._computeReason || "compute check failed", question_text: q.q || "" }));

    // Stage 3: Claude SVG Diagrams
    const withDiagrams = await processDiagrams(apiKey, verified, yr, subject, cfg);
    console.log(`[Job ${jobId}] Stage 3: ${withDiagrams.filter(q => q.svg).length} diagrams drawn, ${verified.length - withDiagrams.length} dropped (Claude SVG)`);

    // Stage 4: Review (Audit + Child Agent merged in one model call — CR-016)
    const reviewed = await review(apiKey, withDiagrams, yr, subject, cfg);
    const passed = reviewed.filter((q) => !q._auditFailed && !q._childFailed);
    // CR-019 feedback fidelity: keep both rejection categories distinct.
    reviewed.filter((q) => q._auditFailed).forEach((q) =>
      pipelineRejections.push({ reason: "audit agent", note: q._auditReason || "audit failed", question_text: q.q || "" }));
    reviewed.filter((q) => q._childFailed).forEach((q) =>
      pipelineRejections.push({ reason: "child agent", note: q._childReason || "child agent flagged", question_text: q.q || "" }));
    console.log(`[Job ${jobId}] Stage 4: Review ${passed.length}/${reviewed.length} passed (${reviewed.filter(q => q._auditFailed).length} audit-failed, ${reviewed.filter(q => q._childFailed).length} child-flagged)`);

    // Stage 6: Bank Write
    await bankWrite(url, key, passed, subject, yr, topics, difficulty);

    let final = dedup([...bq, ...passed]);

    // Top-up
    if (final.length < count) {
      console.log(`[Job ${jobId}] Top-up: need ${count - final.length} more`);
      try {
        const topupExcl = [...excl, ...final.map((q) => q.q?.slice(0, 80)).filter(Boolean)];
        // CR-019: feed this job's pipeline rejections (+ the parent rejections
        // already loaded) into top-up so it does not repeat rejected faults.
        const topupRejections = [...rejections, ...pipelineRejections];
        if (pipelineRejections.length)
          console.log(`[Job ${jobId}] Top-up: feeding back ${pipelineRejections.length} pipeline rejection reason(s)`);
        const topup = await generate(apiKey, subject, yr, topics, difficulty, count - final.length, topupExcl, topupRejections, cfg, curriculum, coverageTarget);
        // DEF-041: top-up questions go through the compute engine too — reject failures.
        const topupVerified = verify(topup, subject).filter((q) => !q._computeFailed);
        const topupWithDiagrams = await processDiagrams(apiKey, topupVerified, yr, subject, cfg);
        // DEF-034: route top-up through Stage 4 (Audit + Child Agent) — same as the main path.
        const topupReviewed = await review(apiKey, topupWithDiagrams, yr, subject, cfg);
        const topupPassed = topupReviewed.filter((q) => !q._auditFailed && !q._childFailed);
        console.log(`[Job ${jobId}] Top-up Stage 4: ${topupPassed.length}/${topupReviewed.length} passed`);
        const es = new Set(final.map((q) => q.q?.trim().toLowerCase().slice(0, 80)));
        const fresh = dedup(topupPassed).filter((q) => !es.has(q.q?.trim().toLowerCase().slice(0, 80)));
        final = [...final, ...fresh.slice(0, count - final.length)];
        await bankWrite(url, key, fresh, subject, yr, topics, difficulty);
      } catch (e) { console.error(`[Job ${jobId}] Top-up error:`, e.message); }
    }

    if (final.length === 0) {
      console.error(`[Job ${jobId}] Pipeline produced 0 questions — all candidates rejected`);
      await updateJob(url, key, jobId, { status: "failed", error: "Pipeline produced 0 questions — all candidates were rejected. Try requesting replacement questions again.", completed_at: new Date().toISOString() });
      res.status(200).json({ status: "failed", count: 0 });
      return;
    }

    if (childId) await record(url, key, childId, final, subject, topics);

    const cleanQuestions = final.map((q) => {
      const clean = { q: q.q, o: q.o, c: q.c, e: q.e };
      if (q.svg) clean.svg = q.svg;
      // CR-022 (cont.): surface the 2D coverage tags so the review screen shows the
      // width/depth spread AND so they ride into the saved answer records (results.answers)
      // — the data the per-child coverage matrix is later derived from. subtopic kept as
      // the deprecated alias for the existing chip strip.
      if (q.subStrand) clean.subStrand = q.subStrand;
      if (q.depth) clean.depth = q.depth;
      if (q.subtopic || q.subStrand) clean.subtopic = q.subtopic || q.subStrand;
      if (q._bankId) clean._bankId = q._bankId;
      if (q._fromBank) clean._fromBank = q._fromBank;
      return clean;
    });

    await updateJob(url, key, jobId, {
      status: "complete", questions: cleanQuestions, source: bq.length ? "mixed" : "claude",
      bank_supplied: bq.length, completed_at: new Date().toISOString(),
    });

    // CR-022 (cont.): log the 2D (sub-strand × depth) spread of the final set — width AND
    // depth visibility (DEF-040 log-every-variable discipline). "(unknown)" depth surfaces
    // any question the generator left untagged on the depth axis.
    const coverage = cleanQuestions.reduce((m, q) => {
      const k = q.subStrand || q.subtopic || "(untagged)";
      m[k] = (m[k] || 0) + 1;
      return m;
    }, {});
    const depthSpread = cleanQuestions.reduce((m, q) => {
      const k = q.depth || "(unknown)";
      m[k] = (m[k] || 0) + 1;
      return m;
    }, {});
    const coverageStr = Object.entries(coverage).map(([s, n]) => `${s}×${n}`).join(", ");
    const depthStr = Object.entries(depthSpread).map(([d, n]) => `${d}×${n}`).join(", ");
    console.log(`[Job ${jobId}] Coverage: ${Object.keys(coverage).length} sub-strand(s) — ${coverageStr} | depth: ${depthStr}`);
    console.log(`[Job ${jobId}] Complete: ${final.length} questions (${bq.length} bank, ${final.length - bq.length} claude, ${cleanQuestions.filter(q => q.svg).length} diagrams)`);
    res.status(200).json({ status: "complete", count: final.length });
  } catch (e) {
    console.error(`[Job ${jobId}] Failed:`, e.message);
    await updateJob(url, key, jobId, { status: "failed", error: e.message, completed_at: new Date().toISOString() });
    res.status(500).json({ status: "failed", error: e.message });
  }
});

// Exposed for the Tester (config.test.js). Requiring this module still registers the
// functions.http worker above, so the Cloud Run entry point is unaffected.
module.exports = { getConfig, _parseConfigValue, CONFIG_DEFAULTS };
