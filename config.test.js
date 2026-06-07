// BrightMind V2 — Tester: runtime config read path (Admin backend — first slice)
// Run: node config.test.js
// Covers the worker's getConfig / _parseConfigValue against a SYNTHETIC fetcher —
// no network, no Supabase. Proves both DoD paths (value present → used; value
// absent → falls back) plus fetch-error fallback and the TTL cache behaviour.
// A short TTL is set BEFORE require so the cache-expiry path is testable quickly.
process.env.CONFIG_TTL_MS = "30";
const { getConfig, _parseConfigValue, CONFIG_DEFAULTS } = require("./index");

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A fetcher returning canned runtime_config rows; counts how often it is called.
function fakeFetcher(rows) {
  const fn = async () => { fn.calls++; return rows; };
  fn.calls = 0;
  return fn;
}

(async () => {
  // ── 1. _parseConfigValue — pure type coercion + absence handling ──
  {
    check("parse: number value coerced", _parseConfigValue({ value: 8000, value_type: "number" }, 1) === 8000);
    check("parse: numeric string coerced to number", _parseConfigValue({ value: "8000", value_type: "number" }, 1) === 8000);
    check("parse: string value passes through", _parseConfigValue({ value: "claude-opus-x", value_type: "string" }, "d") === "claude-opus-x");
    check("parse: bool 'true' → true", _parseConfigValue({ value: "true", value_type: "bool" }, false) === true);
    check("parse: bool false → false", _parseConfigValue({ value: false, value_type: "bool" }, true) === false);
    const obj = { a: 1 };
    check("parse: json value passes through", _parseConfigValue({ value: obj, value_type: "json" }, null) === obj);
    check("parse: missing row → fallback", _parseConfigValue(undefined, "FB") === "FB");
    check("parse: null value → fallback", _parseConfigValue({ value: null, value_type: "string" }, "FB") === "FB");
    check("parse: NaN number → fallback", _parseConfigValue({ value: "notnum", value_type: "number" }, 42) === 42);
  }

  // ── 2. Value present → the stored value is used (not the fallback) ──
  {
    const fetcher = fakeFetcher([{ value: "claude-opus-4-7", value_type: "string" }]);
    const v = await getConfig("u", "k", "TEST_PRESENT", "FALLBACK_MODEL", fetcher);
    check("present: stored value used", v === "claude-opus-4-7");
  }

  // ── 3. Value absent (no row) → falls back to default ──
  {
    const fetcher = fakeFetcher([]);
    const v = await getConfig("u", "k", "TEST_ABSENT", "FALLBACK_MODEL", fetcher);
    check("absent: returns fallback", v === "FALLBACK_MODEL");
  }

  // ── 4. Fetch error → falls back (a job must never break on a config read) ──
  {
    const thrower = async () => { throw new Error("network down"); };
    const v = await getConfig("u", "k", "TEST_ERROR", 8000, thrower);
    check("error: returns fallback", v === 8000);
  }

  // ── 5. Cache: second call within TTL does NOT hit the fetcher ──
  {
    const fetcher = fakeFetcher([{ value: 12345, value_type: "number" }]);
    const a = await getConfig("u", "k", "TEST_CACHE", 0, fetcher);
    const b = await getConfig("u", "k", "TEST_CACHE", 0, fetcher);
    check("cache: both calls return value", a === 12345 && b === 12345);
    check("cache: fetcher called once within TTL", fetcher.calls === 1);

    // ── 6. After TTL expiry, the value is refetched ──
    await sleep(50); // > CONFIG_TTL_MS (30ms)
    await getConfig("u", "k", "TEST_CACHE", 0, fetcher);
    check("cache: refetched after TTL expiry", fetcher.calls === 2);
  }

  // ── 7. CONFIG_DEFAULTS exposes the four migrated dials ──
  {
    check("defaults: has model + diagramModel + token caps",
      typeof CONFIG_DEFAULTS.model === "string" &&
      typeof CONFIG_DEFAULTS.diagramModel === "string" &&
      typeof CONFIG_DEFAULTS.maxTokens === "number" &&
      typeof CONFIG_DEFAULTS.diagMaxTokens === "number");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
