// BrightMind — run-sweep Edge Function (Admin backend, Slice 2).
// Admin-triggered curriculum sweep: distils a MAXIMUM-RECALL sub-strand taxonomy for one
// (subject, topic, year) via Claude and writes a curation_proposals row (pending_review)
// for a human to prune/approve. Admin-gated (caller must be in admin_users). The browser
// can't hold the Anthropic / service-role keys, so this server side does it.
//
// NOTE: the prompt + payload validation here are a Deno port of prompts/curriculum_sweep.txt
// and curriculum.js parseSweepResult/validateProposalPayload (kept in sync — see DEF-048).
//
// Env (Supabase injects SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY automatically):
//   ANTHROPIC_API_KEY  — set as a function secret: `supabase secrets set ANTHROPIC_API_KEY=…`
// The model is NOT an env/secret here — it is read from runtime_config (the admin config
// page), the same key the worker reads. See resolveModel + DEF-053.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const svc = () => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` });
const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// DEF-053: the sweep model is governed solely by runtime_config (the admin config page) —
// the same CLAUDE_MODEL key the worker reads via getConfig. NO hardcoded model id lives
// here: a stale/retired model literal is exactly what 404'd the sweep. Returns null when the
// key is absent or unreadable so the caller fails closed and tells the admin to set it,
// rather than silently substituting a buried default.
async function resolveModel(): Promise<string | null> {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/runtime_config?key=eq.CLAUDE_MODEL&select=value`, { headers: svc() },
    );
    if (!r.ok) return null;
    const rows = await r.json();
    const v = Array.isArray(rows) && rows[0] ? rows[0].value : null;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch (_) {
    return null;
  }
}

const SWEEP_PROMPT = `You are a UK curriculum specialist distilling teacher-knowledge for ONE topic at ONE year group. Your output is a PROPOSAL a human will prune and approve — never shown to a child directly.

TARGET: {{subject}}, topic "{{topic}}", Year {{year}}, scheme {{scheme}}.

GOVERNING PRINCIPLE — MAXIMUM RECALL: produce the UNION (superset) of every plausible sub-strand for this topic/year across the UK National Curriculum, major exam boards (AQA, Edexcel, OCR), and schemes (White Rose, NCETM, Bitesize). It is far safer to include a sub-strand the human then strikes than to omit one — a missing sub-strand is invisible. Never return a minimal "core only" list.

WIDTH vs DEPTH: a harder version of the same skill (e.g. one-step vs two-step equations) is DEPTH inside one sub-strand's depth bands, not a separate sub-strand.

For each sub-strand set: provenance (which sources place it here) and year_flag ("agreed" if sources agree it belongs at Year {{year}}, "disputed" if some schemes place it a year earlier/later). Also produce prerequisites and the common misconceptions a teacher sees (the wrong answer, why, the correction).

OUTPUT — return ONLY a JSON object of EXACTLY this shape, no prose, no markdown fences:
{
  "sub_strands": [
    { "id": "notation", "name": "Algebraic notation & conventions", "depth_bands": ["recall","procedure","application","reasoning"], "provenance": ["NC-KS3","NCETM"], "year_flag": "agreed" },
    { "id": "substitution", "name": "Substitution", "depth_bands": ["recall","procedure","application"], "provenance": ["NC-KS3","AQA"], "year_flag": "agreed" }
  ],
  "prerequisites": [ { "sub_strand": "solving_linear", "requires": ["substitution","simplifying"] } ],
  "misconceptions": [ { "sub_strand": "simplifying", "wrong": "5x + 3 = 8x", "why": "treats unlike terms as like", "correct": "5x + 3 (cannot be combined)" } ]
}
That example is Year 7 "Expressions & Equations" — produce the equivalent UNION for the TARGET. Include every plausible sub-strand with honest provenance + year_flag. Return JSON only.`;

// Port of curriculum.js validateProposalPayload — throws on anything unusable.
function validatePayload(obj: any) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("payload must be an object");
  if (!Array.isArray(obj.sub_strands) || obj.sub_strands.length === 0) throw new Error("sub_strands must be a non-empty array");
  const sub_strands = obj.sub_strands.map((s: any, i: number) => {
    const name = s && typeof s.name === "string" ? s.name.trim() : "";
    if (!name) throw new Error(`sub_strands[${i}] needs a name`);
    return {
      id: (s.id && String(s.id).trim()) || name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      name,
      depth_bands: Array.isArray(s.depth_bands) ? s.depth_bands : [],
      provenance: Array.isArray(s.provenance) ? s.provenance : [],
      year_flag: typeof s.year_flag === "string" ? s.year_flag : "agreed",
    };
  });
  return {
    sub_strands,
    prerequisites: Array.isArray(obj.prerequisites) ? obj.prerequisites : [],
    misconceptions: Array.isArray(obj.misconceptions) ? obj.misconceptions : [],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  try {
    // ── Admin gate ──
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json(401, { error: "missing Authorization token" });
    const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_KEY } });
    if (!uRes.ok) return json(401, { error: "invalid token" });
    const user = await uRes.json();
    const admins = await fetch(
      `${SUPABASE_URL}/rest/v1/admin_users?user_id=eq.${user.id}&select=user_id`, { headers: svc() },
    ).then((r) => r.json()).catch(() => []);
    if (!Array.isArray(admins) || admins.length === 0) return json(403, { error: "not an admin" });

    // ── Input ──
    // CR-031: `force` re-sweeps an existing topic — the pending proposal (if any) is
    // marked superseded and replaced; an approved object stays live until the fresh
    // proposal is approved (the approve RPC versions + archives it then).
    const { subject, topic, year, scheme = "NC", force = false } = await req.json();
    if (!subject || !topic || !year) return json(400, { error: "subject, topic and year are required" });

    // CR-033: record every terminal outcome of this sweep in sweep_runs (service role,
    // best-effort, never blocks the response) so the coverage dashboard can show
    // created / skipped / errored per topic. Errors used to vanish into the HTTP
    // response only — now they are reconstructable after the fact.
    const runBy = user.email || user.id;
    const logRun = (outcome: string, detail: string, model: string | null = null) =>
      fetch(`${SUPABASE_URL}/rest/v1/sweep_runs`, {
        method: "POST",
        headers: { ...svc(), "Content-Type": "application/json" },
        body: JSON.stringify({ subject, topic, year_group: Number(year), scheme, outcome, detail, model, run_by: runBy }),
      }).catch(() => {});

    if (!ANTHROPIC_API_KEY) {
      await logRun("error", "ANTHROPIC_API_KEY not configured on the function");
      return json(500, { error: "ANTHROPIC_API_KEY not configured on the function (set it as a Supabase secret)" });
    }
    const enc = encodeURIComponent;
    const base = `subject=eq.${enc(subject)}&year_group=eq.${year}&topic=eq.${enc(topic)}`;

    // ── Skip if already proposed/approved (unless force) ──
    const [pending, approved] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/curation_proposals?status=eq.pending_review&${base}&select=id`, { headers: svc() }).then((r) => r.json()).catch(() => []),
      fetch(`${SUPABASE_URL}/rest/v1/curriculum_objects?status=eq.approved&${base}&select=id`, { headers: svc() }).then((r) => r.json()).catch(() => []),
    ]);
    if (!force && (pending?.length || 0) + (approved?.length || 0) > 0) {
      await logRun("skipped", "already pending or approved");
      return json(200, { skipped: true, topic });
    }
    if (force && (pending?.length || 0) > 0) {
      const sRes = await fetch(`${SUPABASE_URL}/rest/v1/curation_proposals?status=eq.pending_review&${base}`, {
        method: "PATCH",
        headers: { ...svc(), "Content-Type": "application/json" },
        body: JSON.stringify({ status: "superseded" }),
      });
      if (!sRes.ok) {
        await logRun("error", `could not supersede pending proposal (${sRes.status})`);
        return json(500, { error: `could not supersede pending proposal (${sRes.status})` });
      }
    }

    // ── Resolve the model from runtime_config (admin config page) — single source of
    // truth. No hardcoded fallback: fail closed if it is unset (DEF-053).
    const MODEL = await resolveModel();
    if (!MODEL) {
      await logRun("error", "CLAUDE_MODEL not set in runtime_config");
      return json(500, { error: "CLAUDE_MODEL not set in runtime_config — set it on the admin config page" });
    }

    // ── Distil ──
    const prompt = SWEEP_PROMPT
      .replaceAll("{{subject}}", subject).replaceAll("{{topic}}", topic)
      .replaceAll("{{year}}", String(year)).replaceAll("{{scheme}}", scheme);
    const cRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: "user", content: prompt }] }),
    });
    if (!cRes.ok) {
      const detail = `Claude ${cRes.status}: ${(await cRes.text()).slice(0, 200)}`;
      await logRun("error", detail, MODEL);
      return json(502, { error: detail });
    }
    const cData = await cRes.json();
    const raw = (cData.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    let payload;
    try { payload = validatePayload(JSON.parse(raw.replace(/```json|```/g, "").trim())); }
    catch (e) {
      await logRun("error", `bad sweep output: ${(e as Error).message}`, MODEL);
      return json(502, { error: `bad sweep output: ${(e as Error).message}` });
    }

    // ── Write proposal ──
    const wRes = await fetch(`${SUPABASE_URL}/rest/v1/curation_proposals`, {
      method: "POST",
      headers: { ...svc(), "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({
        subject, topic, year_group: Number(year), scheme, proposed_payload: payload,
        source_run: { at: new Date().toISOString(), model: MODEL, via: "run-sweep", by: user.email || user.id },
        status: "pending_review",
      }),
    });
    if (!wRes.ok) {
      await logRun("error", `write failed ${wRes.status}`, MODEL);
      return json(500, { error: `write failed ${wRes.status}` });
    }
    const [row] = await wRes.json();
    await logRun("created", `${payload.sub_strands.length} sub-strands`, MODEL);
    return json(200, { ok: true, topic, id: row?.id, sub_strands: payload.sub_strands.length, misconceptions: payload.misconceptions.length });
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
});
