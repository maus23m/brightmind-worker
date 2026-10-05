// BrightMind — Tester: admin SPA pure logic (DEF-054 token refresh + CR-033 coverage).
// Run: node admin.test.js
// Pure logic only (no browser, no network). Guards the canonical functions in
// scripts/sweep_coverage.js that frontend/admin.html mirrors inline.
const { tokenNeedsRefresh, deriveSweepStatus } = require("./scripts/sweep_coverage");

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}

// ── DEF-054: tokenNeedsRefresh ──
{
  const now = 1_700_000_000; // fixed "now" in seconds
  // Happy path: a token valid well into the future is NOT refreshed.
  check("token: valid 10min-future token kept", tokenNeedsRefresh(now + 600, now) === false);
  // Unhappy paths: expired, within skew, and unknown exp all force a refresh.
  check("token: already-expired token refreshed", tokenNeedsRefresh(now - 1, now) === true);
  check("token: exactly-now token refreshed", tokenNeedsRefresh(now, now) === true);
  check("token: within default 60s skew refreshed", tokenNeedsRefresh(now + 30, now) === true);
  check("token: just outside 60s skew kept", tokenNeedsRefresh(now + 61, now) === false);
  check("token: null exp refreshed (no usable expiry)", tokenNeedsRefresh(null, now) === true);
  check("token: NaN exp refreshed", tokenNeedsRefresh(NaN, now) === true);
  // Custom skew is honoured.
  check("token: custom 300s skew refreshes 4min-future token", tokenNeedsRefresh(now + 240, now, 300) === true);
}

// ── CR-033: deriveSweepStatus ──
{
  const approvedObj = { status: "approved" };
  const pending = { status: "pending_review" };
  const rejected = { status: "rejected" };
  const superseded = { status: "superseded" };
  const errRun = { outcome: "error" };
  const okRun = { outcome: "created" };

  // Happy path: each settled state maps to its bucket.
  check("status: approved object → approved", deriveSweepStatus({ object: approvedObj }) === "approved");
  check("status: pending proposal → pending_review", deriveSweepStatus({ proposal: pending }) === "pending_review");
  check("status: rejected proposal → rejected", deriveSweepStatus({ proposal: rejected }) === "rejected");
  check("status: superseded proposal → superseded", deriveSweepStatus({ proposal: superseded }) === "superseded");
  check("status: error run, nothing else → error", deriveSweepStatus({ lastRun: errRun }) === "error");

  // Unhappy / edge paths.
  check("status: nothing at all → not_swept", deriveSweepStatus({}) === "not_swept");
  check("status: no-arg call → not_swept", deriveSweepStatus() === "not_swept");
  check("status: created run only → not_swept (no proposal yet means nothing to review)",
    deriveSweepStatus({ lastRun: okRun }) === "not_swept");

  // Precedence: a live approved object wins over a later errored run.
  check("status: approved object beats later error run",
    deriveSweepStatus({ object: approvedObj, lastRun: errRun }) === "approved");
  // A pending proposal outranks an old error run.
  check("status: pending proposal beats error run",
    deriveSweepStatus({ proposal: pending, lastRun: errRun }) === "pending_review");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
