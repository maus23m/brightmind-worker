// BrightMind V2 — GCP Cloud Function Worker
// Full 5-stage pipeline: Bank → Generate → Verify → Audit → Child Agent → Bank Write
// No timeout constraints — runs until complete

const CLAUDE_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

// ── ENV (set in GCP Console) ──
// ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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

async function callClaude(apiKey, prompt, maxTokens = 8000) {
  const res = await fetch(CLAUDE_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
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

// ── Stage 1: Generation ──

const SVG_EXAMPLES = `
EXAMPLE SVG DIAGRAMS — use these as style reference when you decide a diagram helps:

1. Bar chart (statistics):
<svg viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg"><rect width="300" height="200" fill="#F5F3EE"/><text x="150" y="20" text-anchor="middle" font-size="14" font-weight="bold">Favourite Fruits</text><rect x="40" y="60" width="40" height="100" fill="#4A90D9" rx="3"/><text x="60" y="175" text-anchor="middle" font-size="12">Apple</text><text x="60" y="55" text-anchor="middle" font-size="11">10</text><rect x="100" y="100" width="40" height="60" fill="#E8734A" rx="3"/><text x="120" y="175" text-anchor="middle" font-size="12">Banana</text><text x="120" y="95" text-anchor="middle" font-size="11">6</text><rect x="160" y="80" width="40" height="80" fill="#5CB85C" rx="3"/><text x="180" y="175" text-anchor="middle" font-size="12">Grape</text><text x="180" y="75" text-anchor="middle" font-size="11">8</text><rect x="220" y="120" width="40" height="40" fill="#F0AD4E" rx="3"/><text x="240" y="175" text-anchor="middle" font-size="12">Pear</text><text x="240" y="115" text-anchor="middle" font-size="11">4</text></svg>

2. Simple circuit (electricity):
<svg viewBox="0 0 280 200" xmlns="http://www.w3.org/2000/svg"><rect width="280" height="200" fill="#F5F3EE"/><rect x="40" y="40" width="200" height="120" rx="10" fill="none" stroke="#333" stroke-width="3"/><rect x="120" y="30" width="40" height="20" fill="#F0AD4E" stroke="#333" stroke-width="2"/><text x="140" y="25" text-anchor="middle" font-size="11" font-weight="bold">Battery</text><circle cx="140" cy="160" r="12" fill="#FFFFCC" stroke="#333" stroke-width="2"/><text x="140" y="185" text-anchor="middle" font-size="11">Bulb</text><rect x="30" y="90" width="20" height="20" fill="none" stroke="#333" stroke-width="2"/><text x="40" y="125" text-anchor="middle" font-size="10">Switch</text></svg>

3. Angle diagram (geometry):
<svg viewBox="0 0 250 200" xmlns="http://www.w3.org/2000/svg"><rect width="250" height="200" fill="#F5F3EE"/><line x1="40" y1="150" x2="210" y2="150" stroke="#333" stroke-width="2"/><line x1="40" y1="150" x2="160" y2="40" stroke="#333" stroke-width="2"/><path d="M 80 150 A 40 40 0 0 0 68 120" fill="none" stroke="#4A90D9" stroke-width="2"/><text x="85" y="135" font-size="14" fill="#4A90D9" font-weight="bold">35°</text><text x="125" y="170" font-size="12">Find the missing angle</text></svg>

4. Cell diagram (biology):
<svg viewBox="0 0 280 220" xmlns="http://www.w3.org/2000/svg"><rect width="280" height="220" fill="#F5F3EE"/><ellipse cx="140" cy="110" rx="120" ry="80" fill="#E8F5E9" stroke="#2E7D32" stroke-width="2"/><ellipse cx="140" cy="110" rx="35" ry="25" fill="#FFF9C4" stroke="#F57F17" stroke-width="2"/><text x="140" y="115" text-anchor="middle" font-size="11" font-weight="bold">Nucleus</text><text x="140" y="30" text-anchor="middle" font-size="13" font-weight="bold">Animal Cell</text><text x="260" y="70" font-size="10">Cell membrane</text><line x1="245" y1="73" x2="220" y2="85" stroke="#333" stroke-width="1"/><text x="60" y="160" font-size="10">Cytoplasm</text></svg>

5. Force diagram (physics):
<svg viewBox="0 0 250 250" xmlns="http://www.w3.org/2000/svg"><rect width="250" height="250" fill="#F5F3EE"/><rect x="90" y="100" width="70" height="50" fill="#BBDEFB" stroke="#1565C0" stroke-width="2" rx="4"/><text x="125" y="130" text-anchor="middle" font-size="12" font-weight="bold">5 kg</text><line x1="125" y1="100" x2="125" y2="30" stroke="#D32F2F" stroke-width="3" marker-end="url(#ah)"/><text x="135" y="55" font-size="11" fill="#D32F2F">Push 20N</text><line x1="125" y1="150" x2="125" y2="220" stroke="#1565C0" stroke-width="3" marker-end="url(#ah)"/><text x="135" y="200" font-size="11" fill="#1565C0">Weight</text><defs><marker id="ah" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6Z" fill="context-stroke"/></marker></defs></svg>
`;

function buildPrompt(subj, yr, topics, diff, n, excl) {
  const exStr = excl.length ? `\nDo NOT repeat these questions:\n${excl.map((q, i) => `${i + 1}. ${q}`).join("\n")}` : "";

  return `You are an AI tutor with deep knowledge of the UK National Curriculum and child cognitive development.

TASK: Generate ${n} multiple-choice questions for Year ${yr} ${subj}, topics: ${topics.join(", ")}, difficulty: ${diff}.

PRINCIPLES:
- You understand what Year ${yr} students (age ${yr + 4}-${yr + 5}) have been taught and how they think.
- For MATHS: reason about what mastery looks like for each topic at this year group. Mix applied word problems with direct procedural questions as appropriate. Use contexts children relate to.
- For SCIENCE: Biology = knowledge of systems. Physics = application of concepts. Chemistry = both. The phenomenon is always the subject — never use fictional characters or stories to frame questions.
- Questions must be precisely calibrated to Year ${yr} — not too easy, not beyond their curriculum.
- Each question: under 60 words. Each explanation: under 25 words. 4 options, exactly 1 correct.

DIAGRAMS:
- If a diagram would help the student understand the question better than words alone, include an "svg" field with a complete SVG.
- The diagram must stand alone — a student should understand what it shows without reading the question first.
- SVG rules: viewBox fits content, background #F5F3EE, font-size >= 14 for labels, stroke-width >= 2, under 2000 chars, use simple shapes and clear colours.
- Do NOT use emoji in SVGs. Use shapes, lines, and text only.
${SVG_EXAMPLES}
${exStr}

Return ONLY a JSON array, no markdown, no backticks:
[{"q":"question text","o":["A","B","C","D"],"c":0,"e":"explanation","svg":"<svg ...>...</svg> or omit if no diagram needed"}]`;
}

async function generate(apiKey, subj, yr, topics, diff, n, excl = []) {
  const prompt = buildPrompt(subj, yr, topics, diff, n, excl);
  const raw = await callClaude(apiKey, prompt, 8000);
  const qs = JSON.parse(raw.replace(/```json|```/g, "").trim());
  if (!Array.isArray(qs) || !qs.length) throw new Error("Empty generation");
  return qs
    .filter((q) => q.q && Array.isArray(q.o) && q.o.length === 4 && typeof q.c === "number")
    .map((q) => ({
      ...q,
      e: q.e || `Option ${q.c + 1}.`,
      ...(q.svg && typeof q.svg === "string" && q.svg.trim().startsWith("<svg") ? { svg: q.svg.trim() } : {}),
    }));
}

// ── Stage 2: Deterministic Verifier ──

function verify(qs, subj) {
  if (subj !== "maths") return qs;
  return qs.map((q) => {
    try {
      const e = q.e || "";
      const pm = e.match(/=\s*([-]?\d+\.?\d*)/);
      if (!pm) return q;
      const ans = parseFloat(pm[1]);
      if (!isFinite(ans)) return q;
      const opts = q.o.map((o) => {
        const v = parseFloat(o.replace(/[^0-9.-]/g, ""));
        return isFinite(v) ? v : null;
      });
      const match = opts.findIndex((v) => v !== null && Math.abs(v - ans) < 0.05);
      if (match >= 0 && match !== q.c) return { ...q, c: match };
      return q;
    } catch (e) {
      return q;
    }
  });
}

// ── Stage 3: Audit Agent ──

async function audit(apiKey, qs, yr, subj) {
  if (!qs.length) return qs;
  try {
    const prompt = `You are a senior curriculum quality auditor for the UK National Curriculum.

Audit these Year ${yr} ${subj} questions against ALL 8 criteria:
1. Question quality — clear, well-formed, appropriate question type
2. Question type — matches the topic and difficulty
3. Internal consistency — question, options, correct answer, and explanation all agree
4. Answer correctness — the marked correct answer is actually correct
5. Unambiguous — exactly one option is defensibly correct
6. Age-appropriate — suitable for Year ${yr} (age ${yr + 4}-${yr + 5})
7. Explanation quality — concise, accurate, helps the student learn
8. Set-level diversity — flag any questions that are semantically near-duplicates of each other in this set

For each question, return pass:true or pass:false.
If pass:false AND you can fix it, include a "rewrite" object with corrected fields (q, o, c, e). Preserve the svg field unchanged if present.
If pass:false and unfixable, just return pass:false with no rewrite.

Questions:
${JSON.stringify(qs.map((q, i) => ({ i, q: q.q, o: q.o, c: q.c, e: q.e, hasSvg: !!q.svg })))}

Return ONLY JSON array, no markdown:
[{"i":0,"pass":true}] or [{"i":0,"pass":false,"reason":"...","rewrite":{"q":"...","o":[...],"c":0,"e":"..."}}]`;

    const raw = await callClaude(apiKey, prompt, 2000);
    const results = JSON.parse(raw.replace(/```json|```/g, "").trim());

    return qs.map((q, i) => {
      const r = results.find((x) => x.i === i);
      if (!r) return q;
      if (r.pass) return q;
      if (r.rewrite && r.rewrite.q && Array.isArray(r.rewrite.o) && r.rewrite.o.length === 4 && typeof r.rewrite.c === "number") {
        return {
          ...r.rewrite,
          e: r.rewrite.e || q.e,
          ...(q.svg ? { svg: q.svg } : {}),
          _auditRewritten: true,
        };
      }
      return { ...q, _auditFailed: true, _auditReason: r.reason || "failed" };
    });
  } catch (e) {
    console.error("Audit error:", e);
    return qs;
  }
}

// ── Stage 3.5: Child Agent ──

async function childAgent(apiKey, qs, yr, subj) {
  if (!qs.length) return qs;
  try {
    const prompt = `You are a Year ${yr} student (age ${yr + 4}-${yr + 5}) in a UK school.

You are taking a ${subj} test. For each question below, decide if YOU can understand and attempt it.

Flag a question (pass: false) if:
- The wording confuses you or uses words you haven't learned yet
- Two options both seem correct to you
- It requires knowledge you haven't been taught yet in Year ${yr}
- If there's a diagram description that doesn't match what the question asks
- The question feels like it belongs to a higher year group

Be honest — if you're unsure, flag it.

Questions:
${JSON.stringify(qs.map((q, i) => ({ i, q: q.q, o: q.o, hasSvg: !!q.svg })))}

Return ONLY JSON array:
[{"i":0,"pass":true}] or [{"i":0,"pass":false,"reason":"I don't understand what X means"}]`;

    const raw = await callClaude(apiKey, prompt, 1500);
    const results = JSON.parse(raw.replace(/```json|```/g, "").trim());

    return qs.map((q, i) => {
      const r = results.find((x) => x.i === i);
      if (!r || r.pass) return q;
      return { ...q, _childFailed: true, _childReason: r.reason || "flagged by child agent" };
    });
  } catch (e) {
    console.error("Child agent error:", e);
    return qs;
  }
}

// ── Stage 4: Bank Write ──

async function bankWrite(url, key, qs, subj, yr, topics, diff) {
  const store = qs.filter((q) => !q._fromBank && !q._auditFailed && !q._childFailed && q.q);
  if (!store.length) return;
  const rows = store.map((q) => ({
    subject: subj,
    year_group: yr,
    topic: q._topic || topics[0],
    difficulty: diff,
    q: q.q,
    o: q.o,
    c: q.c,
    e: q.e,
    ...(q.svg ? { svg: q.svg } : {}),
    audit_score: q._auditRewritten ? 0.7 : 0.9,
    source: "claude",
    content_hash: qh(q.q),
  }));
  try {
    await fetch(`${url}/rest/v1/question_bank`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
  } catch (e) {
    console.error("Bank write error:", e);
  }
}

// ── Record child history ──

async function record(url, key, childId, qs, subj, topics) {
  if (!childId || !qs.length) return;
  try {
    const rows = qs.filter((q) => q.q).map((q) => ({
      child_id: childId,
      question_hash: qh(q.q),
      topic: q._topic || topics[0] || null,
      subject: subj,
    }));
    await fetch(`${url}/rest/v1/child_question_history`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
  } catch (e) {}
}

// ── Update job status ──

async function updateJob(url, key, jobId, update) {
  await fetch(`${url}/rest/v1/generation_jobs?id=eq.${jobId}`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(update),
  });
}

// ── Main Handler ──

const functions = require("@google-cloud/functions-framework");

functions.http("worker", async (req, res) => {
  // CORS
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey || !url || !key) {
    res.status(500).json({ error: "Missing env vars" });
    return;
  }

  const { jobId } = req.body;
  if (!jobId) { res.status(400).json({ error: "Missing jobId" }); return; }

  try {
    // Fetch job
    const jobs = await supaFetch(url, key, `generation_jobs?id=eq.${jobId}`);
    if (!jobs?.length) { res.status(404).json({ error: "Job not found" }); return; }
    const job = jobs[0];
    if (job.status !== "pending") { res.status(200).json({ status: "already_processed" }); return; }

    // Mark processing
    await updateJob(url, key, jobId, { status: "processing", started_at: new Date().toISOString() });

    const { subject, year_group: yr, topics, difficulty, question_count: count, child_id: childId, previous_ids: previousIds } = job;

    console.log(`[Job ${jobId}] Starting: ${subject} Y${yr} ${topics.join(",")} ${difficulty} x${count}`);

    // ── Stage 0: Bank Read ──
    let seen = new Set();
    let recent = [];
    if (childId) {
      const d = await getSeen(url, key, childId, topics);
      seen = d.h;
      recent = d.t;
    }

    let bq = await adaptBank(url, key, subject, yr, topics, difficulty, count, previousIds || [], seen);
    const need = count - bq.length;
    console.log(`[Job ${jobId}] Stage 0: Bank ${bq.length}/${count}, need ${need}`);

    if (need <= 0) {
      if (childId) await record(url, key, childId, bq, subject, topics);
      await updateJob(url, key, jobId, {
        status: "complete",
        questions: bq,
        source: "bank",
        bank_supplied: bq.length,
        completed_at: new Date().toISOString(),
      });
      console.log(`[Job ${jobId}] Complete (bank only)`);
      return;
    }

    // ── Stage 1: Generate ──
    const excl = [...recent, ...bq.map((q) => q.q?.trim().slice(0, 80)).filter(Boolean)];
    let generated = await generate(apiKey, subject, yr, topics, difficulty, need, excl);
    if (seen.size) generated = generated.filter((q) => !seen.has(qh(q.q)));
    console.log(`[Job ${jobId}] Stage 1: Generated ${generated.length}`);

    // ── Stage 2: Verify ──
    const verified = verify(generated, subject);
    console.log(`[Job ${jobId}] Stage 2: Verified ${verified.length}`);

    // ── Stage 3: Audit ──
    const audited = await audit(apiKey, verified, yr, subject);
    const auditPassed = audited.filter((q) => !q._auditFailed);
    console.log(`[Job ${jobId}] Stage 3: Audit ${auditPassed.length}/${audited.length} passed`);

    // ── Stage 3.5: Child Agent ──
    const childChecked = await childAgent(apiKey, auditPassed, yr, subject);
    const childPassed = childChecked.filter((q) => !q._childFailed);
    console.log(`[Job ${jobId}] Stage 3.5: Child Agent ${childPassed.length}/${childChecked.length} passed`);

    // ── Stage 4: Bank Write ──
    await bankWrite(url, key, childPassed, subject, yr, topics, difficulty);

    // ── Combine ──
    let final = dedup([...bq, ...childPassed]);

    // ── Top-up if shortfall ──
    if (final.length < count) {
      console.log(`[Job ${jobId}] Top-up: need ${count - final.length} more`);
      try {
        const topupExcl = [...excl, ...final.map((q) => q.q?.slice(0, 80)).filter(Boolean)];
        const topup = await generate(apiKey, subject, yr, topics, difficulty, count - final.length, topupExcl);
        const topupVerified = verify(topup, subject);
        const es = new Set(final.map((q) => q.q?.trim().toLowerCase().slice(0, 80)));
        const fresh = dedup(topupVerified).filter((q) => !es.has(q.q?.trim().toLowerCase().slice(0, 80)));
        final = [...final, ...fresh.slice(0, count - final.length)];
        await bankWrite(url, key, fresh, subject, yr, topics, difficulty);
      } catch (e) {
        console.error(`[Job ${jobId}] Top-up error:`, e.message);
      }
    }

    // ── Record history ──
    if (childId) await record(url, key, childId, final, subject, topics);

    // ── Complete ──
    // Clean internal flags before storing
    const cleanQuestions = final.map((q) => {
      const clean = { q: q.q, o: q.o, c: q.c, e: q.e };
      if (q.svg) clean.svg = q.svg;
      if (q._bankId) clean._bankId = q._bankId;
      if (q._fromBank) clean._fromBank = q._fromBank;
      return clean;
    });

    await updateJob(url, key, jobId, {
      status: "complete",
      questions: cleanQuestions,
      source: bq.length ? "mixed" : "claude",
      bank_supplied: bq.length,
      completed_at: new Date().toISOString(),
    });

    console.log(`[Job ${jobId}] Complete: ${final.length} questions (${bq.length} bank, ${final.length - bq.length} claude)`);
    res.status(200).json({ status: "complete", count: final.length });
  } catch (e) {
    console.error(`[Job ${jobId}] Failed:`, e.message);
    await updateJob(url, key, jobId, {
      status: "failed",
      error: e.message,
      completed_at: new Date().toISOString(),
    });
    res.status(500).json({ status: "failed", error: e.message });
  }
});
