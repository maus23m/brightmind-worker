// BrightMind V2 — Agent handoff schemas (DEF-061). Owner: Orchestrator (the data contract
// between an agent's reply and the code that consumes it).
//
// WHY THIS EXISTS: every agent → code handoff used to ask Claude for JSON in prose and then
// JSON.parse the free text. One stray character (e.g. an unquoted ratio `[2:3]`) failed the
// whole tutorial job (DEF-061). Each handoff now sends one of these schemas as
// `output_config.format` (Claude structured outputs): the API constrains the reply to the
// schema, so it is always valid JSON of the expected shape. The agents still REASON in plain
// language inside their string fields (questions, explanations, reasons) — only the final
// handoff to code is typed.
//
// Structured-output schema rules (API): every object has `additionalProperties: false`;
// no numeric/string-length/array-length constraints; no open-ended maps. So:
//   - optional fields are REQUIRED + nullable (the model sends null), and `fromSchema*`
//     drops the nulls so downstream code sees the same shapes as before;
//   - the formula `vars` map is an array of {name, value} pairs, rebuilt into an object;
//   - "exactly 4 options" etc. stay as code checks (generate() filter, review.js).
//
// Pure and dependency-free, like compute.js / review.js — unit-tested in schemas.test.js.

const DEPTH_ENUM = ["recall", "procedure", "application", "reasoning"];
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const obj = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const NUMS = { type: "array", items: { type: "number" } };
const STRS = { type: "array", items: { type: "string" } };

// ── Stage 1: question generation ──
// One schema variant per compute shape. Ratios are TYPED (an array of numbers, one per
// part) — the model never has to write "2:3" inside a numeric field.
const LIST_OPS = ["sum", "product", "count", "min", "max", "range", "difference", "mean",
  "median", "mode", "percent_of", "fraction_of", "divide", "largest", "smallest"];
const COMPUTE_VARIANTS = [
  obj({ op: { type: "string", enum: LIST_OPS }, inputs: NUMS }),
  obj({ op: { type: "string", enum: ["closest_to", "equal_to"] }, inputs: NUMS, target: { type: "number" } }),
  obj({
    op: { type: "string", const: "formula" },
    expr: { type: "string" },
    vars: { type: "array", items: obj({ name: { type: "string" }, value: { type: "number" } }) },
  }),
  obj({
    op: { type: "string", const: "solve_for" },
    var: { type: "string" }, lhs: { type: "string" }, rhs: { type: "string" }, candidates: NUMS,
  }),
  // Ratio ops (DEF-061). ratio = the parts in order, e.g. 2:3 → [2, 3].
  // simplify_ratio: the answer option is the ratio in simplest whole-number form.
  obj({ op: { type: "string", const: "simplify_ratio" }, ratio: NUMS }),
  // share_ratio: share `total` in `ratio`; the answer is the size of part number `part`
  // (1 = first part). E.g. share 60 in 2:3, part 2 → 36.
  obj({ op: { type: "string", const: "share_ratio" }, total: { type: "number" }, ratio: NUMS, part: { type: "integer" } }),
  // equation_balance: `equation` holds a "?" coefficient, or null when every option is a
  // full equation (the which-is-balanced mode).
  obj({ op: { type: "string", const: "equation_balance" }, equation: nullable({ type: "string" }) }),
];

const QUESTION_SCHEMA = obj({
  q: { type: "string" },
  o: STRS,
  c: { type: "integer" },
  e: { type: "string" },
  subStrand: { type: "string" },
  depth: { type: "string", enum: DEPTH_ENUM },
  subtopic: { type: "string" },
  needsDiagram: { type: "boolean" },
  diagramPrompt: nullable({ type: "string" }),
  verify: { type: "string", enum: ["arithmetic", "equation_balance", "none"] },
  compute: { anyOf: [...COMPUTE_VARIANTS, { type: "null" }] },
});

// Structured outputs need an object at the root, so the array is wrapped.
const QUESTIONS_SCHEMA = obj({ questions: { type: "array", items: QUESTION_SCHEMA } });

// ── Stage 4: review (audit + child, one call) ──
const REWRITE_SCHEMA = obj({ q: { type: "string" }, o: STRS, c: { type: "integer" }, e: { type: "string" } });
const REVIEW_SCHEMA = obj({
  results: {
    type: "array",
    items: obj({
      i: { type: "integer" },
      audit: obj({ pass: { type: "boolean" }, reason: nullable({ type: "string" }), rewrite: nullable(REWRITE_SCHEMA) }),
      child: obj({ pass: { type: "boolean" }, reason: nullable({ type: "string" }) }),
    }),
  },
});

// ── Curriculum sweep (CLI + run-sweep Edge Function) ──
// Keep in step with supabase/functions/run-sweep/index.ts SWEEP_SCHEMA (DEF-048 sync debt;
// sweep.test.js asserts the two match).
const SWEEP_SCHEMA = obj({
  sub_strands: {
    type: "array",
    items: obj({
      id: { type: "string" },
      name: { type: "string" },
      depth_bands: { type: "array", items: { type: "string", enum: DEPTH_ENUM } },
      provenance: STRS,
      year_flag: { type: "string", enum: ["agreed", "disputed"] },
    }),
  },
  prerequisites: { type: "array", items: obj({ sub_strand: { type: "string" }, requires: STRS }) },
  misconceptions: {
    type: "array",
    items: obj({
      sub_strand: nullable({ type: "string" }),
      wrong: { type: "string" },
      why: nullable({ type: "string" }),
      correct: nullable({ type: "string" }),
    }),
  },
});

// output_config value for a schema.
const jsonFormat = (schema) => ({ format: { type: "json_schema", schema } });

// Drop null-valued keys (schema-required-but-nullable fields → the old optional shape).
function dropNulls(o) {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

// Schema question → the internal question shape compute.js / the pipeline already use.
function fromSchemaQuestion(q) {
  const out = dropNulls(q);
  if (q && q.diagramPrompt === null) out.diagramPrompt = null; // pipeline reads null explicitly
  if (out.compute && typeof out.compute === "object") {
    const cb = dropNulls(out.compute);
    if (Array.isArray(cb.vars)) {
      const vars = {};
      for (const p of cb.vars) if (p && typeof p.name === "string") vars[p.name] = p.value;
      cb.vars = vars;
    }
    out.compute = cb;
  }
  return out;
}

// Schema review results → the [{i, audit, child}] list review.js applyReview() consumes.
function fromSchemaReview(r) {
  const list = r && Array.isArray(r.results) ? r.results : [];
  return list.map((x) => ({
    i: x.i,
    audit: dropNulls(x.audit),
    child: dropNulls(x.child),
  }));
}

// Sweep payload: drop null optional misconception fields (validateProposalPayload follows).
function fromSchemaSweep(p) {
  if (!p || typeof p !== "object") return p;
  return { ...p, misconceptions: (p.misconceptions || []).map(dropNulls) };
}

// Text of a Messages API reply, after the stop_reason checks every caller needs.
// Structured output guarantees the JSON only on a normal finish: a truncated reply
// (max_tokens, DEF-060) or a refusal may not match the schema, so those throw clearly.
function replyText(d, { maxTokens, model } = {}) {
  if (d.stop_reason === "max_tokens") throw new Error(`Claude output truncated at max_tokens=${maxTokens} (model ${model})`);
  if (d.stop_reason === "refusal") throw new Error(`Claude declined the request (refusal${d.stop_details && d.stop_details.category ? `: ${d.stop_details.category}` : ""}, model ${model})`);
  return (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

// Parse a structured-output reply. It should always be valid JSON; if it ever is not,
// LOG the text around the failure so the cause is visible (DEF-061 — the original failure
// could not be diagnosed because the raw reply was never logged), and throw a short message
// (it lands in generation_jobs.error, which the app shows — no raw model text there).
// `log` is injectable for tests.
function parseStructured(raw, label = "reply", log = console.error) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    const m = /position (\d+)/.exec(e.message);
    const at = m ? Number(m[1]) : 0;
    const excerpt = String(raw).slice(Math.max(0, at - 250), at + 250);
    log(`[Handoff] ${label} is not valid JSON (${e.message}); ${String(raw).length} chars; near: ${JSON.stringify(excerpt)}`);
    throw new Error(`${label} is not valid JSON: ${e.message}`);
  }
}

module.exports = {
  QUESTIONS_SCHEMA, QUESTION_SCHEMA, REVIEW_SCHEMA, SWEEP_SCHEMA, COMPUTE_VARIANTS, LIST_OPS,
  jsonFormat, fromSchemaQuestion, fromSchemaReview, fromSchemaSweep, replyText, parseStructured, dropNulls,
};
