// BrightMind — analytics-agent Edge Function (DEF-057). Parent "Progress Analytics" chat.
// The frontend (frontend/index.html §V2.1) POSTs {question, history, scope} with the
// parent's Supabase Auth token. Flow:
//   1. Auth: token → auth user; the child must belong to that parent (users.parent_id).
//   2. Pass 1 (deterministic): read the child's results for ONE school year + date range
//      (service role) and compute METRICS (core.mjs computeMetrics).
//   3. Pass 2 (Claude): narrative + chart choice from METRICS only, structured output.
//      Chart numbers are always rebuilt from METRICS (core.mjs buildChart).
// The model comes from runtime_config CLAUDE_MODEL (admin config page) — no model literal
// here; fail closed if unset (same rule as run-sweep, DEF-053).
// Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (injected), ANTHROPIC_API_KEY (secret).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { ANALYTICS_PROMPT, ANSWER_SCHEMA, computeMetrics, emptyAnswer, scopeError, shapeAnswer } from "./core.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const svc = () => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` });
const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const log = (msg: string) => console.log(`[Analytics] ${msg}`);

async function resolveModel(): Promise<string | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/runtime_config?key=eq.CLAUDE_MODEL&select=value`, { headers: svc() });
    if (!r.ok) return null;
    const rows = await r.json();
    const v = Array.isArray(rows) && rows[0] ? rows[0].value : null;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch (_) {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const t0 = Date.now();
  try {
    // ── Auth: caller must be the child's parent ──
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json(401, { error: "Please sign in again." });
    const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_KEY } });
    if (!uRes.ok) return json(401, { error: "Your session has expired — please sign in again." });
    const user = await uRes.json();

    const { question, history = [], scope } = await req.json();
    const q = typeof question === "string" ? question.trim().slice(0, 500) : "";
    if (!q) return json(400, { error: "Please type a question." });
    const bad = scopeError(scope);
    if (bad) return json(400, { error: `Invalid scope: ${bad}` });

    const kids = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${scope.childId}&parent_id=eq.${user.id}&role=eq.child&select=id,name`,
      { headers: svc() },
    ).then((r) => r.json()).catch(() => []);
    if (!Array.isArray(kids) || kids.length === 0) {
      log(`403 parent=${user.id} child=${scope.childId}`);
      return json(403, { error: "You can only view analytics for your own children." });
    }
    const childScope = { ...scope, yearGroup: Number(scope.yearGroup), childName: kids[0].name || scope.childName };

    // ── Pass 1: deterministic metrics (one child, one school year, one date range) ──
    const dayAfter = new Date(`${scope.dateTo}T00:00:00Z`);
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
    const subj = scope.subject && scope.subject !== "both" ? `&subject=eq.${scope.subject}` : "";
    const rRes = await fetch(
      `${SUPABASE_URL}/rest/v1/results?child_id=eq.${scope.childId}&year_group=eq.${childScope.yearGroup}` +
        `&completed_at=gte.${scope.dateFrom}&completed_at=lt.${dayAfter.toISOString().slice(0, 10)}${subj}` +
        `&select=subject,topics,correct,total,pct,time_taken,completed_at,answers,tutorials(difficulty)&order=completed_at.asc`,
      { headers: svc() },
    );
    if (!rRes.ok) throw new Error(`results read failed (${rRes.status})`);
    const results = await rRes.json();
    if (!Array.isArray(results) || results.length === 0) {
      log(`no data child=${scope.childId} year=${childScope.yearGroup} ${scope.dateFrom}..${scope.dateTo}`);
      return json(200, emptyAnswer(childScope));
    }
    const metrics = computeMetrics(results, childScope);

    // ── Pass 2: narrative + chart choice ──
    if (!ANTHROPIC_API_KEY) return json(500, { error: "Analytics is not configured (ANTHROPIC_API_KEY missing)." });
    const model = await resolveModel();
    if (!model) return json(500, { error: "CLAUDE_MODEL not set in runtime_config — set it on the admin config page." });

    const prior = (Array.isArray(history) ? history : [])
      .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-6)
      .map((m: any) => ({ role: m.role, content: m.content.replace(/<[^>]+>/g, "").slice(0, 2000) }));
    const messages = [...prior, { role: "user", content: `QUESTION: ${q}` }];

    const cRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        system: `${ANALYTICS_PROMPT}\n\nMETRICS:\n${JSON.stringify(metrics)}`,
        messages,
        output_config: { effort: "low", format: { type: "json_schema", schema: ANSWER_SCHEMA } },
      }),
    });
    if (!cRes.ok) {
      const detail = (await cRes.text()).slice(0, 200);
      log(`Claude ${cRes.status}: ${detail}`);
      return json(502, { error: `The analysis service is unavailable right now (${cRes.status}). Please try again.` });
    }
    const cData = await cRes.json();
    if (cData.stop_reason === "refusal") return json(502, { error: "The analysis could not be produced for that question. Please rephrase it." });
    const raw = (cData.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    let answer;
    try {
      answer = shapeAnswer(raw, metrics);
    } catch (e) {
      log(`bad model output: ${(e as Error).message}`);
      return json(502, { error: "The analysis came back malformed. Please try again." });
    }
    log(`ok child=${scope.childId} year=${childScope.yearGroup} tests=${metrics.summary.tests} chart=${answer.chartType} model=${model} ${Date.now() - t0}ms`);
    return json(200, answer);
  } catch (e) {
    log(`error: ${(e as Error).message}`);
    return json(500, { error: "Something went wrong analysing results. Please try again." });
  }
});
