// BrightMind V2 — GCP Cloud Function Worker
// Pipeline: Bank → Generate (text only) → Verify → Draw Diagrams (Gemini) → Audit → Child Agent → Bank Write
// Diagrams: Claude writes the prompt (understands pedagogy), Gemini renders PNG image.
// Images uploaded to Supabase Storage, public URL stored in svg field as <img> tag.

const CLAUDE_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";
const GEMINI_MODEL = "gemini-2.0-flash-exp";
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models";

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

async function callClaude(apiKey, messages, maxTokens = 8000) {
  const msgs = typeof messages === "string"
    ? [{ role: "user", content: messages }]
    : messages;

  const res = await fetch(CLAUDE_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: msgs }),
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
      `question_rejections?subject=eq.${encodeURIComponent(subj)}&year_group=eq.${yr}&order=created_at.desc&limit=50&select=reason,question_text`
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
    const grouped = {};
    rejections.forEach(r => { grouped[r.reason] = (grouped[r.reason] || 0) + 1; });
    const summary = Object.entries(grouped).map(([reason, count]) => `- ${reason} (${count}x)`).join("\n");
    rejStr = `\nPARENT FEEDBACK — these issues were flagged by parents reviewing previous questions for this subject and year group. Avoid these problems:\n${summary}\n`;
  }

  return `You are an AI tutor with deep knowledge of the UK National Curriculum and child cognitive development.

TASK: Generate ${n} multiple-choice questions for Year ${yr} ${subj}, topics: ${topics.join(", ")}, difficulty: ${diff}.

PRINCIPLES:
- You understand what Year ${yr} students (age ${yr + 4}-${yr + 5}) have been taught and how they think.
- For MATHS: reason about what mastery looks like for each topic at this year group. Mix applied word problems with direct procedural questions as appropriate. Use contexts children relate to.
- For SCIENCE: Biology = knowledge of systems. Physics = application of concepts. Chemistry = both. The phenomenon is always the subject — never use fictional characters or stories to frame questions.
- Questions must be precisely calibrated to Year ${yr} — not too easy, not beyond their curriculum.
- Each question: under 60 words. Each explanation: under 25 words. 4 options, exactly 1 correct.

For each question, indicate whether a diagram would help the student understand or answer it (needsDiagram: true/false). A diagram helps when the question involves visual data (charts, graphs, tables), spatial concepts (shapes, angles, forces, transformations), or scientific structures (cells, circuits, systems, organisms).

When needsDiagram is true, also provide diagramPrompt: a detailed text description of the diagram to generate. The description must include:
- Exactly what objects, structures, or data to show
- All labels and text that must appear
- Scientific/mathematical accuracy requirements
- Style: clean educational illustration, white background, labelled, suitable for children age ${yr + 4}-${yr + 5}
- For charts/graphs: axis labels, scale, data values, title
- Do NOT reference the question text — the diagram must be self-explanatory
${rejStr}${exStr}

Return ONLY a JSON array, no markdown, no backticks:
[{"q":"question text","o":["A","B","C","D"],"c":0,"e":"explanation","needsDiagram":true,"diagramPrompt":"detailed description..."}]`;
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
    }));
}

// ── Stage 2: Deterministic Verifier (maths only) ──

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

// ── Stage 3: Gemini Diagram Generation ──

async function callGemini(geminiKey, prompt) {
  const url = `${GEMINI_API}/${GEMINI_MODEL}:generateContent?key=${geminiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  for (const candidate of data.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (part.inlineData) {
        return {
          base64: part.inlineData.data,
          mimeType: part.inlineData.mimeType || "image/png",
        };
      }
    }
  }
  return null;
}

async function uploadDiagram(supaUrl, serviceKey, imageBase64, filename, mimeType) {
  const imageBytes = Buffer.from(imageBase64, "base64");
  const uploadUrl = `${supaUrl}/storage/v1/object/diagrams/${filename}`;

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": mimeType,
      "x-upsert": "true",
    },
    body: imageBytes,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Storage upload ${res.status}: ${errText.slice(0, 200)}`);
  }

  return `${supaUrl}/storage/v1/object/public/diagrams/${filename}`;
}

async function generateDiagram(geminiKey, supaUrl, serviceKey, question, yr, subj) {
  // Use Claude's diagramPrompt if available, otherwise build one
  const diagramDesc = question.diagramPrompt || `Educational diagram for a Year ${yr} ${subj} question: "${question.q}". Clean educational illustration, white background, clearly labelled, suitable for children age ${yr + 4}-${yr + 5}.`;

  const geminiPrompt = `Generate a clean educational diagram image.

${diagramDesc}

Style requirements:
- White or very light background
- Clear, bold lines and shapes
- Large readable text labels (minimum 14pt equivalent)
- Pleasant colours suitable for children
- No decorative clutter — only educational content
- All text must be sharp and legible
- If this is a chart or graph: both axes MUST have visible labels with units`;

  const image = await callGemini(geminiKey, geminiPrompt);
  if (!image) return null;

  // Upload to Supabase Storage
  const ext = image.mimeType.includes("png") ? "png" : "webp";
  const hash = qh(question.q);
  const filename = `${hash}_${Date.now()}.${ext}`;

  const publicUrl = await uploadDiagram(supaUrl, serviceKey, image.base64, filename, image.mimeType);
  return publicUrl;
}

async function processDiagrams(geminiKey, supaUrl, serviceKey, qs, yr, subj) {
  const results = [];

  for (const q of qs) {
    if (!q.needsDiagram) {
      results.push(q);
      continue;
    }

    let imgUrl = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      console.log(`[Diagram] Gemini rendering for: "${q.q.slice(0, 50)}..." (attempt ${attempt})`);
      try {
        imgUrl = await generateDiagram(geminiKey, supaUrl, serviceKey, q, yr, subj);
        if (imgUrl) {
          console.log(`[Diagram] Success: ${imgUrl}`);
          break;
        }
      } catch (e) {
        console.error(`[Diagram] Attempt ${attempt} failed: ${e.message}`);
      }
    }

    if (imgUrl) {
      // svg field gets an <img> tag — frontend renders via boxEl.innerHTML
      results.push({ ...q, svg: `<img src="${imgUrl}" alt="Diagram" style="width:100%;height:auto;display:block;" />` });
    } else {
      console.log(`[Diagram] Giving up on diagram for: "${q.q.slice(0, 50)}..."`);
      results.push(q); // question still works, just without diagram
    }
  }

  return results;
}

// ── Stage 6: Audit Agent ──

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
If pass:false AND you can fix it, include a "rewrite" object with corrected fields (q, o, c, e).
If pass:false and unfixable, just return pass:false with no rewrite.

Questions:
${JSON.stringify(qs.map((q, i) => ({ i, q: q.q, o: q.o, c: q.c, e: q.e, hasDiagram: !!q.svg })))}

Return ONLY JSON array, no markdown:
[{"i":0,"pass":true}] or [{"i":0,"pass":false,"reason":"...","rewrite":{"q":"...","o":[...],"c":0,"e":"..."}}]`;

    const raw = await callClaude(apiKey, prompt, 2000);
    const results = JSON.parse(raw.replace(/```json|```/g, "").trim());

    return qs.map((q, i) => {
      const r = results.find((x) => x.i === i);
      if (!r) return q;
      if (r.pass) return q;
      if (r.rewrite && r.rewrite.q && Array.isArray(r.rewrite.o) && r.rewrite.o.length === 4 && typeof r.rewrite.c === "number") {
        return { ...r.rewrite, e: r.rewrite.e || q.e, ...(q.svg ? { svg: q.svg } : {}), _auditRewritten: true };
      }
      return { ...q, _auditFailed: true, _auditReason: r.reason || "failed" };
    });
  } catch (e) {
    console.error("Audit error:", e);
    return qs;
  }
}

// ── Stage 7: Child Agent ──

async function childAgent(apiKey, qs, yr, subj) {
  if (!qs.length) return qs;
  try {
    const prompt = `You are a Year ${yr} student (age ${yr + 4}-${yr + 5}) in a UK school.

You are taking a ${subj} test. For each question below, decide if YOU can understand and attempt it.

Flag a question (pass: false) if:
- The wording confuses you or uses words you haven't learned yet
- Two options both seem correct to you
- It requires knowledge you haven't been taught yet in Year ${yr}
- The question feels like it belongs to a higher year group

Be honest — if you're unsure, flag it.

Questions:
${JSON.stringify(qs.map((q, i) => ({ i, q: q.q, o: q.o, hasDiagram: !!q.svg })))}

Return ONLY JSON array:
[{"i":0,"pass":true}] or [{"i":0,"pass":false,"reason":"I don't understand what X means"}]`;

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

// ── Stage 8: Bank Write ──

async function bankWrite(url, key, qs, subj, yr, topics, diff) {
  const store = qs.filter((q) => !q._fromBank && !q._auditFailed && !q._childFailed && q.q);
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
  const geminiKey = process.env.GEMINI_API_KEY;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey || !url || !key) { res.status(500).json({ error: "Missing env vars" }); return; }
  if (!geminiKey) console.warn("[WARN] GEMINI_API_KEY not set — diagrams will be skipped");

  const { jobId } = req.body;
  if (!jobId) { res.status(400).json({ error: "Missing jobId" }); return; }

  try {
    const jobs = await supaFetch(url, key, `generation_jobs?id=eq.${jobId}`);
    if (!jobs?.length) { res.status(404).json({ error: "Job not found" }); return; }
    const job = jobs[0];
    if (job.status !== "pending") { res.status(200).json({ status: "already_processed" }); return; }

    await updateJob(url, key, jobId, { status: "processing", started_at: new Date().toISOString() });

    const { subject, year_group: yr, topics, difficulty, question_count: count, child_id: childId, previous_ids: previousIds } = job;
    console.log(`[Job ${jobId}] Starting: ${subject} Y${yr} ${topics.join(",")} ${difficulty} x${count}`);

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

    // Stage 1: Generate (text only, with diagramPrompt where needed)
    const excl = [...recent, ...bq.map((q) => q.q?.trim().slice(0, 80)).filter(Boolean)];
    const rejections = await getRecentRejections(url, key, subject, yr);
    if (rejections.length) console.log(`[Job ${jobId}] Loaded ${rejections.length} parent rejections for feedback`);
    let generated = await generate(apiKey, subject, yr, topics, difficulty, need, excl, rejections);
    if (seen.size) generated = generated.filter((q) => !seen.has(qh(q.q)));
    console.log(`[Job ${jobId}] Stage 1: Generated ${generated.length} (${generated.filter(q => q.needsDiagram).length} need diagrams)`);

    // Stage 2: Verify
    const verified = verify(generated, subject);
    console.log(`[Job ${jobId}] Stage 2: Verified ${verified.length}`);

    // Stage 3: Gemini Diagram Generation
    let withDiagrams;
    if (geminiKey) {
      withDiagrams = await processDiagrams(geminiKey, url, key, verified, yr, subject);
      console.log(`[Job ${jobId}] Stage 3: ${withDiagrams.filter(q => q.svg).length} diagrams rendered (Gemini)`);
    } else {
      withDiagrams = verified;
      console.log(`[Job ${jobId}] Stage 3: Skipped (no GEMINI_API_KEY)`);
    }

    // Stage 4: Audit
    const audited = await audit(apiKey, withDiagrams, yr, subject);
    const auditPassed = audited.filter((q) => !q._auditFailed);
    console.log(`[Job ${jobId}] Stage 4: Audit ${auditPassed.length}/${audited.length} passed`);

    // Stage 5: Child Agent
    const childChecked = await childAgent(apiKey, auditPassed, yr, subject);
    const childPassed = childChecked.filter((q) => !q._childFailed);
    console.log(`[Job ${jobId}] Stage 5: Child Agent ${childPassed.length}/${childChecked.length} passed`);

    // Stage 6: Bank Write
    await bankWrite(url, key, childPassed, subject, yr, topics, difficulty);

    let final = dedup([...bq, ...childPassed]);

    // Top-up
    if (final.length < count) {
      console.log(`[Job ${jobId}] Top-up: need ${count - final.length} more`);
      try {
        const topupExcl = [...excl, ...final.map((q) => q.q?.slice(0, 80)).filter(Boolean)];
        const topup = await generate(apiKey, subject, yr, topics, difficulty, count - final.length, topupExcl);
        const topupVerified = verify(topup, subject);
        let topupWithDiagrams;
        if (geminiKey) {
          topupWithDiagrams = await processDiagrams(geminiKey, url, key, topupVerified, yr, subject);
        } else {
          topupWithDiagrams = topupVerified;
        }
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
