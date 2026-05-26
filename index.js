// BrightMind V2 — GCP Cloud Function Worker
// Pipeline: Bank → Generate (text only) → Compute Engine → Draw Diagrams (Claude SVG) → Audit → Child Agent → Bank Write
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

const CLAUDE_API = process.env.CLAUDE_API || "https://api.anthropic.com/v1/messages";
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";
// DEF-040: diagrams need a stronger model than text generation. Default to Opus 4.7.
const DIAGRAM_MODEL = process.env.DIAGRAM_MODEL || "claude-opus-4-7";

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
async function callClaude(apiKey, messages, maxTokens = 8000, system = null, model = MODEL) {
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

async function adaptBank(url, key, subj, yr, topics, diff, cnt, prev, seen) {
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
      c.push({ q: r.q, o: r.o, c: r.c, e: r.e, ...(r.svg ? { svg: r.svg } : {}), _fromBank: true, _bankId: r.id });
    });
  }
  try {
    await tier(`&difficulty=eq.${encodeURIComponent(diff)}`, cnt);
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

function buildPrompt(subj, yr, topics, diff, n, excl, rejections = []) {
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
    rejections: rejStr,
    exclusions: exStr,
  });
}

async function generate(apiKey, subj, yr, topics, diff, n, excl = [], rejections = []) {
  const prompt = buildPrompt(subj, yr, topics, diff, n, excl, rejections);
  const raw = await callClaude(apiKey, prompt);
  const qs = JSON.parse(raw.replace(/```json|```/g, "").trim());
  if (!Array.isArray(qs) || !qs.length) throw new Error("Empty generation");
  return qs
    .filter((q) => q.q && Array.isArray(q.o) && q.o.length === 4 && typeof q.c === "number")
    .map((q) => ({
      q: q.q,
      o: q.o,
      c: q.c,
      e: q.e || `Option ${q.c + 1}.`,
      needsDiagram: !!q.needsDiagram,
      diagramPrompt: q.diagramPrompt || null,
      // DEF-041: routing tag + structured working. Defaults keep legacy/non-numeric
      // questions on the "none" track (untouched by the compute engine).
      verify: (q.verify === "arithmetic" || q.verify === "equation_balance") ? q.verify : "none",
      compute: (q.compute && typeof q.compute === "object") ? q.compute : null,
    }));
}

// ── Stage 2: Compute Engine (DEF-041) ──
// Deterministic answer verifier. Lives in its own module (compute.js) so it is
// independently unit-testable (see compute.test.js). It recomputes the answer
// from compute.inputs ALONE — never reads the model's c or e — then confirms c,
// corrects c to the VERIFIED value, or rejects the question (fail-closed).
// Only questions tagged verify:"arithmetic" are checked; verify:"equation_balance"
// and verify:"none" pass through untouched (correctness owned by the audit agent).
const { computeVerify: verify } = require("./compute");

// ── Stage 3: Claude SVG Diagram Generation ──
// DEF-040: this stage runs on DIAGRAM_MODEL (Opus), not the default text model.

async function drawDiagram(apiKey, question, yr, subj) {
  const diagramDesc = question.diagramPrompt || `Draw a diagram for this Year ${yr} ${subj} question: "${question.q}"`;

  const diagramUserTemplate = loadPrompt("diagram_user");
  const prompt = fillTemplate(diagramUserTemplate, {
    diagram_prompt: diagramDesc,
  });

  const systemPrompt = loadPrompt("diagram_system");

  console.log(`[Diagram] Model: ${DIAGRAM_MODEL} | Prompt: ${diagramDesc.slice(0, 500)}`);

  const raw = await callClaude(apiKey, prompt, 16000, systemPrompt, DIAGRAM_MODEL);
  const svgMatch = raw.match(/<svg[\s\S]*<\/svg>/i);
  if (!svgMatch) {
    console.error(`[Diagram] No SVG found in response. Raw (first 500 chars): ${raw.slice(0, 500)}`);
    return null;
  }
  return svgMatch[0].trim();
}

async function processDiagrams(apiKey, qs, yr, subj) {
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
        svg = await drawDiagram(apiKey, q, yr, subj);
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

// ── Stage 4: Audit Agent ──

async function audit(apiKey, qs, yr, subj) {
  if (!qs.length) return qs;
  try {
    const template = loadPrompt("audit");
    const prompt = fillTemplate(template, {
      year: String(yr),
      subject: subj,
      age_low: String(yr + 4),
      age_high: String(yr + 5),
      // DEF-041: tell the auditor which questions the compute engine already verified,
      // so criterion 4 does not re-judge arithmetic it is unreliable at.
      questions_json: JSON.stringify(qs.map((q, i) => ({
        i, q: q.q, o: q.o, c: q.c, e: q.e,
        hasDiagram: !!q.svg,
        computeVerified: !!(q._computeVerified || q._computeCorrected),
      }))),
    });

    const raw = await callClaude(apiKey, prompt, 2000);
    const results = JSON.parse(raw.replace(/```json|```/g, "").trim());

    return qs.map((q, i) => {
      const r = results.find((x) => x.i === i);
      if (!r) return q;
      if (r.pass) return q;
      if (r.rewrite && r.rewrite.q && Array.isArray(r.rewrite.o) && r.rewrite.o.length === 4 && typeof r.rewrite.c === "number") {
        // DEF-041 guard: never let an audit rewrite silently override a
        // compute-verified answer index. If the engine verified c, keep c.
        const rw = { ...r.rewrite, e: r.rewrite.e || q.e, ...(q.svg ? { svg: q.svg } : {}), _auditRewritten: true };
        if ((q._computeVerified || q._computeCorrected) && rw.c !== q.c) {
          rw.c = q.c;
          rw._auditCFixedToCompute = true;
        }
        return rw;
      }
      return { ...q, _auditFailed: true, _auditReason: r.reason || "failed" };
    });
  } catch (e) {
    console.error("Audit error:", e);
    return qs;
  }
}

// ── Stage 5: Child Agent ──

async function childAgent(apiKey, qs, yr, subj) {
  if (!qs.length) return qs;
  try {
    const template = loadPrompt("child_agent");
    const prompt = fillTemplate(template, {
      year: String(yr),
      subject: subj,
      age_low: String(yr + 4),
      age_high: String(yr + 5),
      questions_json: JSON.stringify(qs.map((q, i) => ({ i, q: q.q, o: q.o, hasDiagram: !!q.svg }))),
    });

    const raw = await callClaude(apiKey, prompt, 1500);
    const results = JSON.parse(raw.replace(/```json|```/g, "").trim());

    return qs.map((q, i) => {
      const r = results.find((x) => x.i === i);
      if (!r || r.pass) return q;
      return { ...q, _childFailed: true, _childReason: r.reason || "flagged" };
    });
  } catch (e) {
    console.error("Child agent error:", e);
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
    subject: subj, year_group: yr, topic: q._topic || topics[0], difficulty: diff,
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
    console.log(`[Job ${jobId}] Starting: ${subject} Y${yr} ${topics.join(",")} ${difficulty} x${count} | text=${MODEL} diagram=${DIAGRAM_MODEL}`);

    // Stage 0: Bank
    let seen = new Set(), recent = [];
    if (childId) { const d = await getSeen(url, key, childId, topics); seen = d.h; recent = d.t; }
    let bq = await adaptBank(url, key, subject, yr, topics, difficulty, count, previousIds || [], seen);
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
    let generated = await generate(apiKey, subject, yr, topics, difficulty, need, excl, rejections);
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
    const withDiagrams = await processDiagrams(apiKey, verified, yr, subject);
    console.log(`[Job ${jobId}] Stage 3: ${withDiagrams.filter(q => q.svg).length} diagrams drawn, ${verified.length - withDiagrams.length} dropped (Claude SVG)`);

    // Stage 4: Audit
    const audited = await audit(apiKey, withDiagrams, yr, subject);
    const auditPassed = audited.filter((q) => !q._auditFailed);
    audited.filter((q) => q._auditFailed).forEach((q) =>
      pipelineRejections.push({ reason: "audit agent", note: q._auditReason || "audit failed", question_text: q.q || "" }));
    console.log(`[Job ${jobId}] Stage 4: Audit ${auditPassed.length}/${audited.length} passed`);

    // Stage 5: Child Agent
    const childChecked = await childAgent(apiKey, auditPassed, yr, subject);
    const childPassed = childChecked.filter((q) => !q._childFailed);
    childChecked.filter((q) => q._childFailed).forEach((q) =>
      pipelineRejections.push({ reason: "child agent", note: q._childReason || "child agent flagged", question_text: q.q || "" }));
    console.log(`[Job ${jobId}] Stage 5: Child Agent ${childPassed.length}/${childChecked.length} passed`);

    // Stage 6: Bank Write
    await bankWrite(url, key, childPassed, subject, yr, topics, difficulty);

    let final = dedup([...bq, ...childPassed]);

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
        const topup = await generate(apiKey, subject, yr, topics, difficulty, count - final.length, topupExcl, topupRejections);
        // DEF-041: top-up questions go through the compute engine too — reject failures.
        const topupVerified = verify(topup, subject).filter((q) => !q._computeFailed);
        const topupWithDiagrams = await processDiagrams(apiKey, topupVerified, yr, subject);
        const es = new Set(final.map((q) => q.q?.trim().toLowerCase().slice(0, 80)));
        const fresh = dedup(topupWithDiagrams).filter((q) => !es.has(q.q?.trim().toLowerCase().slice(0, 80)));
        final = [...final, ...fresh.slice(0, count - final.length)];
        await bankWrite(url, key, fresh, subject, yr, topics, difficulty);
      } catch (e) { console.error(`[Job ${jobId}] Top-up error:`, e.message); }
    }

    if (childId) await record(url, key, childId, final, subject, topics);

    const cleanQuestions = final.map((q) => {
      const clean = { q: q.q, o: q.o, c: q.c, e: q.e };
      if (q.svg) clean.svg = q.svg;
      if (q._bankId) clean._bankId = q._bankId;
      if (q._fromBank) clean._fromBank = q._fromBank;
      return clean;
    });

    await updateJob(url, key, jobId, {
      status: "complete", questions: cleanQuestions, source: bq.length ? "mixed" : "claude",
      bank_supplied: bq.length, completed_at: new Date().toISOString(),
    });

    console.log(`[Job ${jobId}] Complete: ${final.length} questions (${bq.length} bank, ${final.length - bq.length} claude, ${cleanQuestions.filter(q => q.svg).length} diagrams)`);
    res.status(200).json({ status: "complete", count: final.length });
  } catch (e) {
    console.error(`[Job ${jobId}] Failed:`, e.message);
    await updateJob(url, key, jobId, { status: "failed", error: e.message, completed_at: new Date().toISOString() });
    res.status(500).json({ status: "failed", error: e.message });
  }
});
