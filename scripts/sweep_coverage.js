// BrightMind — Curriculum agent: sweep-coverage + admin-session pure logic.
// Canonical, dependency-free functions shared by the admin SPA (frontend/admin.html)
// and the Tester (admin.test.js). The admin SPA cannot `require()` Node modules, so it
// mirrors these two functions VERBATIM inline (same mirror pattern the run-sweep edge
// function uses for curriculum.js — see DEF-048). If you change one, change the other;
// admin.test.js guards the canonical copy.

// ── Admin session: token freshness (DEF-054) ───────────────────────────────
// Decide whether the stored access token must be refreshed before use. Pure so the
// decision is unit-testable without a browser or a live Supabase session.
//   exp     — JWT `exp` claim in SECONDS since epoch, or null/undefined if unknown.
//   nowSec  — current time in SECONDS since epoch.
//   skewSec — refresh this many seconds BEFORE actual expiry (clock skew + in-flight).
// Returns true when there is no usable expiry, or the token is at/﻿past (exp - skew).
function tokenNeedsRefresh(exp, nowSec, skewSec = 60) {
  if (exp == null || !Number.isFinite(exp)) return true;
  return exp - nowSec <= skewSec;
}

// ── Coverage: one topic's status (CR-033) ──────────────────────────────────
// Collapse what we know about a single topic into one bucket for the dashboard.
// Inputs (any may be absent):
//   object  — latest approved curriculum_objects row (or null)
//   proposal — most-recent curation_proposals row for the topic (or null)
//   lastRun — most-recent sweep_runs row for the topic (or null)
// Precedence (most-settled wins): approved > pending_review > rejected/superseded
//   > error > not_swept. A live approved object is the truth even if a later sweep
//   run errored; a pending proposal outranks an old error; only the total absence of
//   object, proposal AND run row is "never swept".
function deriveSweepStatus({ object = null, proposal = null, lastRun = null } = {}) {
  if (object && object.status === 'approved') return 'approved';
  if (proposal && proposal.status === 'pending_review') return 'pending_review';
  if (proposal && proposal.status === 'rejected') return 'rejected';
  if (proposal && proposal.status === 'superseded') return 'superseded';
  if (lastRun && lastRun.outcome === 'error') return 'error';
  return 'not_swept';
}

module.exports = { tokenNeedsRefresh, deriveSweepStatus };
