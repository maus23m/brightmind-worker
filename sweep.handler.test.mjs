// BrightMind — Tester: DEF-060 — the REAL run-sweep handler, end to end.
// Run: node --experimental-strip-types sweep.handler.test.mjs   (via npm test)
// Loads supabase/functions/run-sweep/index.ts unmodified except the jsr type import, with
// Deno + fetch stubbed (Supabase REST/Auth and the Claude API). Covers the happy path and
// the truncation path that produced "Unterminated string in JSON" for Y8 Charts & Graphs.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bm-sw-"));
fs.writeFileSync(path.join(tmp, "index.mts"),
  fs.readFileSync(path.join(here, "supabase", "functions", "run-sweep", "index.ts"), "utf-8").replace(/^import "jsr:.*$/m, ""));

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`FAIL  ${name}`); } };

let handler;
const env = { SUPABASE_URL: "https://sb", SUPABASE_SERVICE_ROLE_KEY: "svc", ANTHROPIC_API_KEY: "ak" };
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };

const PAYLOAD = JSON.stringify({
  sub_strands: [{ id: "bar_charts", name: "Bar charts", depth_bands: ["recall"], provenance: ["NC-KS3"], year_flag: "agreed" }],
  prerequisites: [], misconceptions: [],
});
let world, calls;
const reset = () => {
  calls = [];
  world = { claude: { stop_reason: "end_turn", content: [{ type: "text", text: PAYLOAD }] } };
};
const res = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, opts });
  if (u.endsWith("/auth/v1/user")) return res(200, { id: "admin-1", email: "a@b" });
  if (u.includes("/rest/v1/admin_users?")) return res(200, [{ user_id: "admin-1" }]);
  if (u.includes("/rest/v1/curation_proposals?")) return res(200, []);
  if (u.includes("/rest/v1/curriculum_objects?")) return res(200, []);
  if (u.includes("/rest/v1/runtime_config?")) return res(200, [{ value: "claude-test-model" }]);
  if (u.endsWith("/rest/v1/curation_proposals")) return res(201, [{ id: "p1" }]);
  if (u.endsWith("/rest/v1/sweep_runs")) return res(201, {});
  if (u.startsWith("https://api.anthropic.com/")) return res(200, world.claude);
  throw new Error("unexpected fetch " + u);
};

await import(pathToFileURL(path.join(tmp, "index.mts")).href);
check("handler registered via Deno.serve", typeof handler === "function");

const sweep = async () => {
  const r = await handler(new Request("https://fn/run-sweep", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer jwt" },
    body: JSON.stringify({ subject: "Maths", topic: "Charts & Graphs", year: 8 }),
  }));
  return { status: r.status, body: await r.json() };
};
const runLog = () => calls.filter((c) => c.url.endsWith("/rest/v1/sweep_runs")).map((c) => JSON.parse(c.opts.body));

// Happy path
reset();
let r = await sweep();
check("happy: 200 + proposal created", r.status === 200 && r.body.ok && r.body.sub_strands === 1);
const req = JSON.parse(calls.find((c) => c.url.startsWith("https://api.anthropic.com/")).opts.body);
check("DEF-060: max_tokens raised above the old 8000 cap", req.max_tokens >= 16000);
check("happy: sweep_runs logs created", runLog().some((x) => x.outcome === "created"));

// DEF-060: truncated output (stop_reason max_tokens) is reported as truncation, not bad JSON
reset();
world.claude = { stop_reason: "max_tokens", content: [{ type: "text", text: PAYLOAD.slice(0, 60) }] };
r = await sweep();
check("DEF-060: truncated → 502", r.status === 502);
check("DEF-060: error names truncation", /truncated/.test(r.body.error) && !/Unterminated|bad sweep output/.test(r.body.error));
check("DEF-060: truncation logged to sweep_runs", runLog().some((x) => x.outcome === "error" && /truncated/.test(x.detail)));
check("DEF-060: no proposal written on truncation", !calls.some((c) => c.url.endsWith("/rest/v1/curation_proposals")));

// Unhappy: complete but malformed output still reports bad sweep output
reset();
world.claude = { stop_reason: "end_turn", content: [{ type: "text", text: "{not json" }] };
r = await sweep();
check("malformed (not truncated) → bad sweep output", r.status === 502 && /bad sweep output/.test(r.body.error));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
