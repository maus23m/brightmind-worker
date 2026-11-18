// BrightMind V2 — Tester: typed agent → code handoffs (DEF-061)
// Run: node schemas.test.js
// Live failure 18 Nov 2026: a Y8 Ratio/Proportion job died on `Expected ',' or ']' after
// array element in JSON` — the generator's free-text JSON was parsed with a bare JSON.parse.
// Every JSON handoff now uses structured outputs (output_config.format + schemas.js).
// These tests cover: the schemas obey the API's structured-output rules; the prompt's own
// worked examples validate against the schema they teach; the adapters rebuild the internal
// shapes; the typed ratio ops; and generate()/review() end to end against a mocked fetch
// (happy path, malformed reply, refusal, truncation, network failure).
const fs = require("fs");
const path = require("path");
const S = require("./schemas");
const { computeVerify, simplifyRatio, optionRatio } = require("./compute");

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}

// ── Minimal JSON-schema validator for the subset structured outputs uses ──
function validate(schema, v, at = "$") {
  if (schema.anyOf) {
    const errs = schema.anyOf.map((s) => validate(s, v, at));
    return errs.some((e) => e.length === 0) ? [] : [`${at}: matches no anyOf branch (${errs.map((e) => e[0]).join(" | ")})`];
  }
  if ("const" in schema && v !== schema.const) return [`${at}: expected const ${schema.const}`];
  if (schema.enum && !schema.enum.includes(v)) return [`${at}: ${JSON.stringify(v)} not in enum`];
  const t = schema.type;
  const typeOk = t === undefined ||
    (t === "null" && v === null) ||
    (t === "string" && typeof v === "string") ||
    (t === "boolean" && typeof v === "boolean") ||
    (t === "number" && typeof v === "number" && Number.isFinite(v)) ||
    (t === "integer" && Number.isInteger(v)) ||
    (t === "array" && Array.isArray(v)) ||
    (t === "object" && v && typeof v === "object" && !Array.isArray(v));
  if (!typeOk) return [`${at}: expected ${t}, got ${JSON.stringify(v)}`];
  if (t === "array") return v.flatMap((x, i) => validate(schema.items, x, `${at}[${i}]`));
  if (t === "object") {
    const errs = [];
    for (const k of schema.required || []) if (!(k in v)) errs.push(`${at}: missing ${k}`);
    for (const k of Object.keys(v)) {
      if (!schema.properties[k]) errs.push(`${at}: extra property ${k}`);
      else errs.push(...validate(schema.properties[k], v[k], `${at}.${k}`));
    }
    return errs;
  }
  return [];
}

// ── 1. Schemas follow the structured-output rules (API rejects anything else) ──
{
  const UNSUPPORTED = ["minimum", "maximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "pattern", "uniqueItems"];
  const problems = [];
  const walk = (s, at) => {
    if (!s || typeof s !== "object") return;
    for (const k of UNSUPPORTED) if (k in s) problems.push(`${at}: uses ${k}`);
    if (s.type === "object") {
      if (s.additionalProperties !== false) problems.push(`${at}: additionalProperties must be false`);
      const keys = Object.keys(s.properties || {});
      if (keys.sort().join() !== [...(s.required || [])].sort().join()) problems.push(`${at}: every property must be required (use nullable for optional)`);
      keys.forEach((k) => walk(s.properties[k], `${at}.${k}`));
    }
    if (s.items) walk(s.items, `${at}[]`);
    (s.anyOf || []).forEach((b, i) => walk(b, `${at}|${i}`));
  };
  for (const [name, sch] of Object.entries({ QUESTIONS_SCHEMA: S.QUESTIONS_SCHEMA, REVIEW_SCHEMA: S.REVIEW_SCHEMA, SWEEP_SCHEMA: S.SWEEP_SCHEMA })) {
    const before = problems.length;
    walk(sch, name);
    check(`${name}: root is an object and obeys structured-output rules`, sch.type === "object" && problems.length === before);
  }
  if (problems.length) console.log(problems.join("\n"));
  check("jsonFormat wraps the schema as output_config.format json_schema",
    JSON.stringify(S.jsonFormat(S.REVIEW_SCHEMA)) === JSON.stringify({ format: { type: "json_schema", schema: S.REVIEW_SCHEMA } }));
  // Every op the compute engine knows has a schema branch (and vice versa) — a new op must
  // be added to both, or the model can't emit it / code can't check it.
  const schemaOps = S.COMPUTE_VARIANTS.flatMap((v) => v.properties.op.enum || [v.properties.op.const]).sort();
  const engineOps = [...require("./compute").KNOWN_OPS, "formula", "solve_for", "simplify_ratio", "share_ratio", "equation_balance"].sort();
  check("every compute op has exactly one schema branch", schemaOps.join() === engineOps.join());
}

// ── 2. The prompt's worked examples validate against the schema they teach ──
{
  const gen = fs.readFileSync(path.join(__dirname, "prompts", "question_gen.txt"), "utf-8");
  // Full-shape examples (every line carrying the 2D tags) must be schema-valid questions.
  const lines = gen.split("\n").map((l) => l.trim().replace(/,$/, "")).filter((l) => l.startsWith('{"q":') && l.includes('"subStrand"'));
  check("question_gen has full-shape worked examples (incl. both ratio ops)", lines.length >= 6 &&
    lines.some((l) => l.includes('"simplify_ratio"')) && lines.some((l) => l.includes('"share_ratio"')));
  for (const l of lines) {
    let errs;
    try { errs = validate(S.QUESTION_SCHEMA, JSON.parse(l)); } catch (e) { errs = [`not JSON: ${e.message}`]; }
    check(`worked example is schema-valid: ${l.slice(0, 60)}…`, errs.length === 0);
    if (errs.length) console.log("   " + errs.join("\n   "));
  }
  // The output block is a complete {"questions":[...]} object.
  const m = gen.match(/\{"questions":\[[\s\S]*?\n\]\}/);
  let errs = ["no {\"questions\":[...]} block"];
  if (m) { try { errs = validate(S.QUESTIONS_SCHEMA, JSON.parse(m[0])); } catch (e) { errs = [e.message]; } }
  check("question_gen OUTPUT block validates against QUESTIONS_SCHEMA", errs.length === 0);
  check("question_gen no longer teaches the vars-as-map shape", !/"vars":\{/.test(gen));
  check("question_gen forbids ratios as numbers in compute", /NEVER write "2:3" or 2\/5 as a number/.test(gen));

  const rev = fs.readFileSync(path.join(__dirname, "prompts", "review.txt"), "utf-8");
  const rm = rev.match(/\{"results":\[[\s\S]*?\n\]\}/);
  errs = ["no {\"results\":[...]} block"];
  if (rm) { try { errs = validate(S.REVIEW_SCHEMA, JSON.parse(rm[0].replace(/"\.\.\."/g, '"x"'))); } catch (e) { errs = [e.message]; } }
  check("review.txt OUTPUT block validates against REVIEW_SCHEMA", errs.length === 0);

  const sweep = fs.readFileSync(path.join(__dirname, "prompts", "curriculum_sweep.txt"), "utf-8");
  const sm = sweep.match(/\n\{\n[\s\S]*?\n\}\n/);
  errs = ["no example object"];
  if (sm) { try { errs = validate(S.SWEEP_SCHEMA, JSON.parse(sm[0])); } catch (e) { errs = [e.message]; } }
  check("curriculum_sweep.txt example validates against SWEEP_SCHEMA", errs.length === 0);
}

// ── 3. Adapters rebuild the internal shapes ──
{
  const q = S.fromSchemaQuestion({ q: "x", o: ["1", "2", "3", "4"], c: 1, e: "e", subStrand: "s", depth: "procedure", subtopic: "s",
    needsDiagram: false, diagramPrompt: null, verify: "arithmetic",
    compute: { op: "formula", expr: "a*b", vars: [{ name: "a", value: 2 }, { name: "b", value: 3 }] } });
  check("fromSchemaQuestion: vars pairs → { name: value } map", JSON.stringify(q.compute.vars) === '{"a":2,"b":3}');
  check("fromSchemaQuestion: diagramPrompt null kept explicit", q.diagramPrompt === null && "diagramPrompt" in q);
  const n = S.fromSchemaQuestion({ q: "x", o: ["a", "b", "c", "d"], c: 0, e: "e", verify: "none", compute: null, diagramPrompt: null });
  check("fromSchemaQuestion: compute null dropped", !("compute" in n));
  const eb = S.fromSchemaQuestion({ q: "x", o: ["a", "b", "c", "d"], c: 0, verify: "equation_balance", compute: { op: "equation_balance", equation: null } });
  check("fromSchemaQuestion: equation null dropped (which-is-balanced mode)", eb.compute.op === "equation_balance" && !("equation" in eb.compute));
  const formulaChecked = computeVerify([{ ...q, o: ["5", "6", "7", "8"], c: 0 }])[0];
  check("adapted formula question verifies in the compute engine (c corrected to 6)", formulaChecked.c === 1 && formulaChecked._computeCorrected === true);

  const r = S.fromSchemaReview({ results: [{ i: 0, audit: { pass: true, reason: null, rewrite: null }, child: { pass: false, reason: "hard" } }] });
  check("fromSchemaReview: nulls dropped, verdicts kept", r.length === 1 && !("rewrite" in r[0].audit) && !("reason" in r[0].audit) && r[0].child.reason === "hard");
  check("fromSchemaReview: missing results → [] (review fails open)", S.fromSchemaReview(null).length === 0);
  const sw = S.fromSchemaSweep({ sub_strands: [], prerequisites: [], misconceptions: [{ sub_strand: null, wrong: "w", why: null, correct: "c" }] });
  check("fromSchemaSweep: null misconception fields dropped", JSON.stringify(sw.misconceptions[0]) === '{"wrong":"w","correct":"c"}');
}

// ── 4. Typed ratio ops in the compute engine ──
{
  const base = { q: "Simplify 12:18", verify: "arithmetic", compute: { op: "simplify_ratio", ratio: [12, 18] } };
  check("optionRatio parses '2 : 3' and '1:2:5'", JSON.stringify(optionRatio("2 : 3")) === "[2,3]" && JSON.stringify(optionRatio("1:2:5")) === "[1,2,5]");
  check("optionRatio: a plain number is not a ratio", optionRatio("23") === null);
  check("simplifyRatio scales decimals (1.5:2 → 3:4)", JSON.stringify(simplifyRatio([1.5, 2])) === "[3,4]");
  let r = computeVerify([{ ...base, o: ["6:9", "2:3", "3:2", "4:6"], c: 1 }])[0];
  check("simplify_ratio: correct c verified", r._computeVerified === true && r._computeTruth === "2:3");
  r = computeVerify([{ ...base, o: ["6:9", "2:3", "3:2", "4:6"], c: 0 }])[0];
  check("simplify_ratio: wrong c corrected to the simplest form", r.c === 1 && r._computeCorrected === true);
  r = computeVerify([{ ...base, o: ["6:9", "3:2", "4:6", "12:18"], c: 0 }])[0];
  check("simplify_ratio: no simplest-form option → rejected", r._computeFailed === true);
  r = computeVerify([{ ...base, compute: { op: "simplify_ratio", ratio: [12] }, o: ["6:9", "2:3", "3:2", "4:6"], c: 1 }])[0];
  check("simplify_ratio: one-part ratio → rejected", r._computeFailed === true);
  r = computeVerify([{ ...base, compute: { op: "simplify_ratio", ratio: [0, 3] }, o: ["6:9", "2:3", "3:2", "4:6"], c: 1 }])[0];
  check("simplify_ratio: zero part → rejected", r._computeFailed === true);

  const share = { q: "Share £60 in 2:3; Ben's share?", verify: "arithmetic", o: ["£24", "£36", "£40", "£20"],
    compute: { op: "share_ratio", total: 60, ratio: [2, 3], part: 2 } };
  r = computeVerify([{ ...share, c: 1 }])[0];
  check("share_ratio: £60 in 2:3, part 2 = £36 verified", r._computeVerified === true && r._computeTruth === 36);
  r = computeVerify([{ ...share, c: 0 }])[0];
  check("share_ratio: wrong c corrected", r.c === 1 && r._computeCorrected === true);
  r = computeVerify([{ ...share, c: 1, compute: { ...share.compute, part: 3 } }])[0];
  check("share_ratio: part out of range → rejected", r._computeFailed === true);
  r = computeVerify([{ ...share, c: 1, compute: { ...share.compute, total: "60" } }])[0];
  check("share_ratio: non-numeric total → rejected", r._computeFailed === true);
}

// ── 5. replyText / parseStructured ──
{
  const ok = S.replyText({ stop_reason: "end_turn", content: [{ type: "text", text: ' {"a":1} ' }] });
  check("replyText: returns the trimmed text on a normal finish", ok === '{"a":1}');
  let msg = "";
  try { S.replyText({ stop_reason: "max_tokens", content: [] }, { maxTokens: 10, model: "m" }); } catch (e) { msg = e.message; }
  check("replyText: max_tokens → truncation error (DEF-060)", /truncated at max_tokens=10/.test(msg));
  msg = "";
  try { S.replyText({ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] }, { model: "m" }); } catch (e) { msg = e.message; }
  check("replyText: refusal → clear error naming the category", /declined.*refusal: cyber/.test(msg));

  check("parseStructured: valid JSON parsed", S.parseStructured('{"x":[1,2]}').x[1] === 2);
  // The DEF-061 failure shape: an unquoted ratio inside a numeric array.
  const bad = '{"questions":[{"q":"Share 60 in 2:3","compute":{"op":"fraction_of","inputs":[2:3]}}]}';
  const logs = [];
  msg = "";
  try { S.parseStructured(bad, "generation reply", (l) => logs.push(l)); } catch (e) { msg = e.message; }
  check("parseStructured: DEF-061 shape throws a short, labelled error", /^generation reply is not valid JSON: /.test(msg) && !msg.includes("near"));
  check("parseStructured: logs the text near the failure", logs.length === 1 && logs[0].includes("[2:3]") && logs[0].includes("[Handoff]"));
}

// ── 6. generate() / review() end to end against a mocked Messages API ──
(async () => {
  const { _generate, _review } = require("./index");
  const realFetch = global.fetch;
  const realErr = console.error;
  let lastBody = null;
  const reply = (body, status = 200) => async (_url, opts) => {
    lastBody = JSON.parse(opts.body);
    if (body instanceof Error) throw body;
    return { ok: status === 200, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  const msg = (text, stop = "end_turn") => ({ stop_reason: stop, content: [{ type: "text", text }] });
  const goodQ = { q: "Amy and Ben share £60 in the ratio 2:3. How much does Ben get?", o: ["£24", "£36", "£40", "£20"], c: 1,
    e: "£12 per part, Ben 3 parts.", subStrand: "Sharing in a ratio", depth: "application", subtopic: "Sharing in a ratio",
    needsDiagram: false, diagramPrompt: null, verify: "arithmetic", compute: { op: "share_ratio", total: 60, ratio: [2, 3], part: 2 } };
  const cfg = { model: "claude-opus-5-5", diagramModel: "claude-opus-5-5", maxTokens: 16000, diagMaxTokens: 16000 };
  const gen = () => _generate("k", "maths", 8, ["Ratio", "Proportion"], "medium", 1, [], [], cfg, [], "");
  const rejects = async (fn) => { try { await fn(); return ""; } catch (e) { return e.message; } };
  try {
    console.error = () => {};
    global.fetch = reply(msg(JSON.stringify({ questions: [goodQ] })));
    const qs = await gen();
    check("generate: request carries output_config json_schema = QUESTIONS_SCHEMA",
      lastBody.output_config && lastBody.output_config.format.type === "json_schema" &&
      JSON.stringify(lastBody.output_config.format.schema) === JSON.stringify(S.QUESTIONS_SCHEMA));
    check("generate: structured reply → question with typed ratio compute",
      qs.length === 1 && qs[0].compute.op === "share_ratio" && JSON.stringify(qs[0].compute.ratio) === "[2,3]");
    check("generate → compute engine: ratio answer verified", computeVerify(qs)[0]._computeVerified === true);

    global.fetch = reply(msg('{"questions":[{"q":"x","compute":{"inputs":[2:3]}}]}'));
    check("generate: malformed reply → labelled error (unhappy path)", /generation reply is not valid JSON/.test(await rejects(gen)));
    global.fetch = reply(msg("", "refusal"));
    check("generate: refusal → clear error", /declined/.test(await rejects(gen)));
    global.fetch = reply(msg('{"questions":[', "max_tokens"));
    check("generate: truncation → truncation error", /truncated/.test(await rejects(gen)));
    global.fetch = reply(msg(JSON.stringify({ questions: [] })));
    check("generate: empty list → Empty generation", /Empty generation/.test(await rejects(gen)));
    global.fetch = reply(new Error("ECONNRESET"));
    check("generate: network failure propagates", /ECONNRESET/.test(await rejects(gen)));
    global.fetch = reply({ error: "overloaded" }, 529);
    check("generate: API error status propagates", /Claude 529/.test(await rejects(gen)));

    const qs2 = [{ q: "a", o: ["1", "2", "3", "4"], c: 0, e: "e" }, { q: "b", o: ["1", "2", "3", "4"], c: 0, e: "e" }];
    global.fetch = reply(msg(JSON.stringify({ results: [
      { i: 0, audit: { pass: true, reason: null, rewrite: null }, child: { pass: true, reason: null } },
      { i: 1, audit: { pass: false, reason: "dup", rewrite: null }, child: { pass: true, reason: null } },
    ] })));
    const rv = await _review("k", qs2, 8, "maths", cfg);
    check("review: request carries REVIEW_SCHEMA", JSON.stringify(lastBody.output_config.format.schema) === JSON.stringify(S.REVIEW_SCHEMA));
    check("review: structured verdicts applied (q1 audit-failed)", !rv[0]._auditFailed && rv[1]._auditFailed === true && rv[1]._auditReason === "dup");
    global.fetch = reply(msg("not json"));
    const open = await _review("k", qs2, 8, "maths", cfg);
    check("review: malformed reply fails open (questions pass through)", open.length === 2 && !open[1]._auditFailed);
  } finally {
    global.fetch = realFetch;
    console.error = realErr;
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
