// BrightMind V2 — Tester: DEF-057 — the REAL analytics-agent handler, end to end.
// Run: node --experimental-strip-types analytics.handler.test.mjs   (via analytics.test.js)
// Loads supabase/functions/analytics-agent/index.ts unmodified except the jsr type import,
// with Deno + fetch stubbed (Supabase REST/Auth and the Claude API), and drives requests
// through it: happy path, auth failures, wrong parent, no data, model failure.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fnDir = path.join(here, "supabase", "functions", "analytics-agent");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bm-an-"));
fs.copyFileSync(path.join(fnDir, "core.mjs"), path.join(tmp, "core.mjs"));
fs.writeFileSync(path.join(tmp, "index.mts"),
  fs.readFileSync(path.join(fnDir, "index.ts"), "utf-8").replace(/^import "jsr:.*$/m, ""));

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`FAIL  ${name}`); } };

let handler;
const env = { SUPABASE_URL: "https://sb", SUPABASE_SERVICE_ROLE_KEY: "svc", ANTHROPIC_API_KEY: "ak" };
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
console.log = ((orig) => (...a) => { if (!String(a[0]).startsWith("[Analytics]")) orig(...a); })(console.log);

const CHILD = "22222222-2222-2222-2222-222222222222";
const PARENT = "33333333-3333-3333-3333-333333333333";
let world, calls;
const reset = () => {
  calls = [];
  world = {
    user: { id: PARENT }, kids: [{ id: CHILD, name: "Spruha" }],
    results: [
      { subject: "maths", topics: ["Ratio"], correct: 3, total: 4, pct: 0.75, time_taken: 120, completed_at: "2026-09-20T10:00:00Z", answers: [], tutorials: { difficulty: "medium" } },
      { subject: "maths", topics: ["Proportion"], correct: 2, total: 4, pct: 0.5, time_taken: 200, completed_at: "2026-09-27T10:00:00Z", answers: [], tutorials: { difficulty: "medium" } },
    ],
    model: "claude-test-model",
    claude: { status: 200, body: { stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify({ narrative: "**Proportion** is the weaker topic at 50%.", chart: "topic_scores", follow_ups: ["a?", "b?", "c?"] }) }] } },
  };
};
const res = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), opts });
  const u = String(url);
  if (u.endsWith("/auth/v1/user")) return world.user ? res(200, world.user) : res(401, {});
  if (u.includes("/rest/v1/users?")) return res(200, u.includes(`parent_id=eq.${world.user.id}`) ? world.kids : []);
  if (u.includes("/rest/v1/results?")) return res(200, world.results);
  if (u.includes("/rest/v1/runtime_config?")) return res(200, world.model ? [{ value: world.model }] : []);
  if (u.startsWith("https://api.anthropic.com/")) return res(world.claude.status, world.claude.body);
  throw new Error("unexpected fetch " + u);
};

await import(pathToFileURL(path.join(tmp, "index.mts")).href);
check("handler registered via Deno.serve", typeof handler === "function");

const scope = { childId: CHILD, childName: "Spruha", subject: "both", yearGroup: 8, dateFrom: "2026-09-01", dateTo: "2026-10-06" };
const ask = async (body, token = "parent-jwt", method = "POST") => {
  const r = await handler(new Request("https://fn/analytics-agent", {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  }));
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
};

// Happy path
reset();
let r = await ask({ question: "Which topics is she struggling with?", history: [], scope });
check("happy: 200", r.status === 200);
check("happy: UI contract", r.body && r.body.narrative.includes("<strong>Proportion</strong>") && r.body.chartType === "bar" && r.body.followUpSuggestions.length === 3);
check("happy: chart from metrics", r.body.chartData.labels.join() === "Proportion,Ratio" && r.body.chartData.values.join() === "50,75");
check("happy: CORS header on response", r.headers.get("Access-Control-Allow-Origin") === "*");
const rq = calls.find((c) => c.url.includes("/rest/v1/results?")).url;
check("happy: results scoped to child + year 8 + dates", rq.includes(`child_id=eq.${CHILD}`) && rq.includes("year_group=eq.8") && rq.includes("completed_at=gte.2026-09-01") && rq.includes("completed_at=lt.2026-10-07"));
const cr = JSON.parse(calls.find((c) => c.url.startsWith("https://api.anthropic.com/")).opts.body);
check("happy: model from runtime_config", cr.model === "claude-test-model");
check("happy: structured output + effort set", cr.output_config && cr.output_config.format.type === "json_schema" && cr.output_config.effort === "low");
check("happy: no thinking/temperature params (Opus 5.5 rejects disabled thinking)", !("thinking" in cr) && !("temperature" in cr));
check("happy: METRICS in system prompt", /METRICS:\n\{/.test(cr.system) && cr.system.includes('"yearGroup":8'));

// Subject filter
reset();
await ask({ question: "q", scope: { ...scope, subject: "science" } });
check("subject filter applied", calls.find((c) => c.url.includes("/rest/v1/results?")).url.includes("subject=eq.science"));

// History is sanitised and capped
reset();
const hist = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `<b>m${i}</b>` }));
await ask({ question: "q", history: [...hist, { role: "system", content: "evil" }], scope });
const msgs = JSON.parse(calls.find((c) => c.url.startsWith("https://api.anthropic.com/")).opts.body).messages;
check("history: capped, HTML stripped, no system role", msgs.length === 7 && !msgs.some((m) => m.role === "system") && !msgs[0].content.includes("<b>"));

// Unhappy paths
reset(); r = await ask({ question: "q", scope }, null);
check("unhappy: no token → 401", r.status === 401);
reset(); world.user = null; r = await ask({ question: "q", scope });
check("unhappy: expired token → 401", r.status === 401);
reset(); world.kids = []; r = await ask({ question: "q", scope });
check("unhappy: not this parent's child → 403, no results read", r.status === 403 && !calls.some((c) => c.url.includes("/rest/v1/results?")));
reset(); r = await ask({ question: "", scope });
check("unhappy: empty question → 400", r.status === 400);
reset(); r = await ask({ question: "q", scope: { ...scope, yearGroup: null } });
check("unhappy: no school year → 400", r.status === 400);
reset(); world.results = []; r = await ask({ question: "q", scope });
check("no data: 200 explanation, no model call", r.status === 200 && /no completed tests/i.test(r.body.narrative) && !calls.some((c) => c.url.startsWith("https://api.anthropic.com/")));
reset(); world.model = null; r = await ask({ question: "q", scope });
check("unhappy: CLAUDE_MODEL unset → fails closed 500", r.status === 500 && /CLAUDE_MODEL/.test(r.body.error));
reset(); world.claude = { status: 529, body: { error: "overloaded" } }; r = await ask({ question: "q", scope });
check("unhappy: Claude error → 502 friendly message", r.status === 502 && /try again/i.test(r.body.error));
reset(); world.claude.body = { stop_reason: "refusal", content: [] }; r = await ask({ question: "q", scope });
check("unhappy: refusal → 502", r.status === 502);
reset(); world.claude.body = { stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }; r = await ask({ question: "q", scope });
check("unhappy: malformed model output → 502", r.status === 502);
reset(); world.claude.body = { stop_reason: "max_tokens", content: [{ type: "text", text: '{"narrative": "Propor' }] }; r = await ask({ question: "q", scope });
check("DEF-060: truncated output → 502 incomplete (not 'malformed')", r.status === 502 && /incomplete/.test(r.body.error));
reset(); globalThis.fetch = async () => { throw new Error("network down"); }; r = await ask({ question: "q", scope });
check("unhappy: network failure → 401/500 JSON, no crash", [401, 500].includes(r.status) && r.body && r.body.error);
r = await handler(new Request("https://fn/analytics-agent", { method: "OPTIONS" }));
check("CORS preflight → 200", r.status === 200);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
