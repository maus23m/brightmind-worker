// BrightMind — analytics-agent core (DEF-057). Pure logic, no I/O, no Deno APIs:
// imported by index.ts (Deno) and by analytics.test.js (Node) — one implementation, tested.
//
// Two passes: (1) METRICS are computed here, deterministically, from the child's results;
// (2) Claude only writes the narrative and PICKS a chart key — chart numbers are always
// built here from METRICS, so a model slip can never put a wrong number on a chart.

// The system prompt. Must stay byte-identical to prompts/analytics.txt (prompts live in
// git — analytics.test.js enforces the sync, same pattern as run-sweep / DEF-048).
export const ANALYTICS_PROMPT = `You are BrightMind's progress analyst. You explain a child's test results to their parent in plain, warm, specific English. The parent is not a teacher.

You are given METRICS: numbers already computed from the child's completed tests for ONE school year and ONE date range. They are the only facts you have.

RULES
- Use only numbers that appear in METRICS. Never estimate, extrapolate or invent a figure, topic, date or test.
- If METRICS cannot answer the question (e.g. too few tests, or the data needed is not there), say so plainly and say what would answer it (e.g. "after 3 more Algebra tests").
- Fewer than 3 tests in a group is too few to call a strength or weakness — say "early signs" instead.
- Keep it short: 2–4 sentences. Lead with the answer. Name topics exactly as they appear in METRICS.
- Encouraging but honest. No praise for weak results, no alarm over small samples.
- You may use **bold** for one or two key phrases. No other formatting, no headings, no lists.
- chart: pick the ONE chart that best supports your answer, or "none":
    topic_scores      — average score per topic
    score_trend       — score of each test over time
    difficulty_scores — average score per difficulty setting
    substrand_scores  — % correct per sub-skill
    depth_scores      — % correct per depth (recall → reasoning)
    none              — no chart helps (e.g. a question about time spent)
  Only pick a chart whose data is non-empty in METRICS.
- follow_ups: exactly 3 short questions the parent might ask next, answerable from METRICS.

OUTPUT — JSON only, exactly this shape.

WORKED EXAMPLE
METRICS:
{"child":"Emma","yearGroup":7,"subject":"maths","from":"2026-09-01","to":"2026-10-06",
 "summary":{"tests":6,"questions":54,"avgPct":71,"avgSecsPerQuestion":31},
 "byTopic":[{"label":"Fractions","tests":3,"avgPct":52},{"label":"Algebra","tests":3,"avgPct":89}],
 "trend":[{"label":"02 Sep","pct":56},{"label":"09 Sep","pct":60},{"label":"16 Sep","pct":67},{"label":"23 Sep","pct":78},{"label":"30 Sep","pct":80},{"label":"06 Oct","pct":85}],
 "byDifficulty":[{"label":"medium","tests":6,"avgPct":71}],
 "bySubStrand":[{"label":"Adding fractions","answers":9,"pct":44},{"label":"Simplifying expressions","answers":10,"pct":90}],
 "byDepth":[{"label":"recall","answers":20,"pct":85},{"label":"reasoning","answers":12,"pct":50}],
 "timeByTopic":[{"label":"Fractions","avgSecsPerQuestion":42},{"label":"Algebra","avgSecsPerQuestion":20}]}
QUESTION: Which topics is my child struggling with most?
ANSWER:
{"narrative":"Emma's weakest area is **Fractions**, averaging 52% over 3 tests, against 89% in Algebra. Within Fractions, adding fractions is the sticking point at 44% correct, and she spends twice as long per question there (42s vs 20s). A short run of fraction-addition practice is the best next step.","chart":"topic_scores","follow_ups":["Has her Fractions score improved over time?","Which sub-skills is she strongest at?","Is she better at recall or reasoning questions?"]}
`;

export const CHART_KEYS = ["topic_scores", "score_trend", "difficulty_scores", "substrand_scores", "depth_scores", "none"];

// Structured-output schema for the model reply (output_config.format).
export const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    narrative: { type: "string" },
    chart: { type: "string", enum: CHART_KEYS },
    follow_ups: { type: "array", items: { type: "string" } },
  },
  required: ["narrative", "chart", "follow_ups"],
  additionalProperties: false,
};

const pct = (n) => Math.round(n * 100);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const fmtDay = (iso) => {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]}`;
};

// Group helper → [{label, n, values}] sorted by label for stable output.
function group(items, keyFn, valFn) {
  const m = new Map();
  for (const it of items) {
    const keys = [].concat(keyFn(it)).filter((k) => k != null && k !== "");
    for (const k of keys) {
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(valFn(it));
    }
  }
  return [...m.entries()].map(([label, values]) => ({ label: String(label), values })).sort((a, b) => a.label.localeCompare(b.label));
}

// results: rows {subject, topics[], correct, total, pct, time_taken, completed_at, answers[],
// tutorials:{difficulty}} — already filtered to one child, one year, one date range.
export function computeMetrics(results, scope) {
  const rows = (results || []).filter((r) => r && Number(r.total) > 0)
    .sort((a, b) => String(a.completed_at).localeCompare(String(b.completed_at)));
  const answers = rows.flatMap((r) => (Array.isArray(r.answers) ? r.answers : []).filter(Boolean));
  const isRight = (a) => a.selected === a.correct;
  const qCount = rows.reduce((s, r) => s + Number(r.total), 0);
  const secs = rows.filter((r) => Number(r.time_taken) > 0);

  return {
    child: scope.childName || "your child",
    yearGroup: scope.yearGroup,
    subject: scope.subject || "both",
    from: scope.dateFrom,
    to: scope.dateTo,
    summary: {
      tests: rows.length,
      questions: qCount,
      avgPct: rows.length ? pct(mean(rows.map((r) => Number(r.pct)))) : 0,
      avgSecsPerQuestion: secs.length ? Math.round(mean(secs.map((r) => r.time_taken / r.total))) : 0,
    },
    byTopic: group(rows, (r) => r.topics || [], (r) => Number(r.pct))
      .map((g) => ({ label: g.label, tests: g.values.length, avgPct: pct(mean(g.values)) })),
    trend: rows.map((r) => ({ label: fmtDay(r.completed_at), pct: pct(Number(r.pct)) })),
    byDifficulty: group(rows, (r) => r.tutorials && r.tutorials.difficulty, (r) => Number(r.pct))
      .map((g) => ({ label: g.label, tests: g.values.length, avgPct: pct(mean(g.values)) })),
    bySubStrand: group(answers, (a) => a.subStrand, isRight)
      .map((g) => ({ label: g.label, answers: g.values.length, pct: pct(mean(g.values.map(Number))) })),
    byDepth: group(answers, (a) => a.depth, isRight)
      .map((g) => ({ label: g.label, answers: g.values.length, pct: pct(mean(g.values.map(Number))) })),
    timeByTopic: group(secs, (r) => r.topics || [], (r) => r.time_taken / r.total)
      .map((g) => ({ label: g.label, avgSecsPerQuestion: Math.round(mean(g.values)) })),
  };
}

// Chart data is built ONLY from metrics. Unknown key or empty series → no chart.
export function buildChart(metrics, key) {
  const spec = {
    topic_scores:      ["bar",  "Average score by topic",      metrics.byTopic,      "avgPct"],
    score_trend:       ["line", "Score per test over time",    metrics.trend,        "pct"],
    difficulty_scores: ["bar",  "Average score by difficulty", metrics.byDifficulty, "avgPct"],
    substrand_scores:  ["bar",  "% correct by sub-skill",      metrics.bySubStrand,  "pct"],
    depth_scores:      ["bar",  "% correct by depth",          metrics.byDepth,      "pct"],
  }[key];
  if (!spec || !Array.isArray(spec[2]) || spec[2].length === 0) return { chartType: "none", chartData: { title: "", labels: [], values: [] } };
  const [chartType, title, series, field] = spec;
  return { chartType, chartData: { title, labels: series.map((s) => s.label), values: series.map((s) => s[field]) } };
}

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// The UI inserts the narrative as HTML — escape everything, then allow only **bold**.
export function narrativeToHtml(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

// Validate the model's JSON reply and shape the response the UI expects:
// {narrative, chartType, chartData{title,labels,values}, followUpSuggestions}. Throws on junk.
export function shapeAnswer(raw, metrics) {
  let obj = raw;
  if (typeof raw === "string") obj = JSON.parse(raw.replace(/```json|```/g, "").trim());
  if (!obj || typeof obj !== "object") throw new Error("answer is not an object");
  const narrative = typeof obj.narrative === "string" ? obj.narrative.trim() : "";
  if (!narrative) throw new Error("answer has no narrative");
  const key = CHART_KEYS.includes(obj.chart) ? obj.chart : "none";
  const followUps = (Array.isArray(obj.follow_ups) ? obj.follow_ups : [])
    .filter((f) => typeof f === "string" && f.trim()).map((f) => f.trim().slice(0, 120)).slice(0, 3);
  return { narrative: narrativeToHtml(narrative), ...buildChart(metrics, key), followUpSuggestions: followUps };
}

// Answer without calling the model when there is nothing to analyse.
export function emptyAnswer(scope) {
  const who = escapeHtml(scope.childName || "your child");
  return {
    narrative: `There are no completed tests for <strong>${who}</strong> in Year ${escapeHtml(scope.yearGroup)} between ${escapeHtml(scope.dateFrom)} and ${escapeHtml(scope.dateTo)}${scope.subject && scope.subject !== "both" ? ` (${escapeHtml(scope.subject)})` : ""}. Widen the dates, pick another school year, or set a tutorial to start building a picture.`,
    chartType: "none",
    chartData: { title: "", labels: [], values: [] },
    followUpSuggestions: [],
  };
}

// Validate the request scope. Returns an error string, or null when valid.
export function scopeError(scope) {
  if (!scope || typeof scope !== "object") return "missing scope";
  if (!/^[0-9a-f-]{36}$/i.test(String(scope.childId || ""))) return "invalid childId";
  if (!Number.isInteger(Number(scope.yearGroup)) || Number(scope.yearGroup) < 1 || Number(scope.yearGroup) > 13) return "invalid yearGroup";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(scope.dateFrom || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(scope.dateTo || ""))) return "invalid date range";
  if (scope.dateFrom > scope.dateTo) return "dateFrom is after dateTo";
  if (!["both", "maths", "science"].includes(scope.subject || "both")) return "invalid subject";
  return null;
}
