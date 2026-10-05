# Session Handover — 28 Jun 2026

## What was done — DEF-054 (Approve "JWT expired") + CR-033 (sweep coverage dashboard)

Owner ran a whole-curriculum **Year-2 maths** sweep. Two problems, both fixed.

### DEF-054 — "Approve failed: JWT expired" (CRITICAL, resolved)
**Symptom:** several proposals could not be approved; live DB confirmed 11 of 34 Year-2
maths topics stuck in `pending_review` (Counting & Ordering, Place Value, Comparing
Numbers, Rounding, Mental Addition/Subtraction, Column Addition/Subtraction, Word
Problems, Times Tables, Pictograms); the rest approved.

**Root cause:** `frontend/admin.html` refreshed the Supabase access token only once, at
`boot()`. The ~1-hour JWT was then reused raw as `session.token` everywhere. A
whole-curriculum sweep + review runs past the hour → Approve (and any admin write) 401s.
A **class** bug: every authed call shared the one stale token.

**Fix (admin.html):**
- `decodeJwtExp` + `tokenNeedsRefresh` (canonical, unit-tested in
  `scripts/sweep_coverage.js`; mirrored inline) + `authToken(force?)` — the single source
  of a usable token. Refreshes via the stored refresh token when within 60s of expiry;
  de-duped (`_refreshing`) so concurrent loaders trigger one refresh (refresh tokens are
  single-use). Refresh failure → clear session + back to sign-in.
- New `authedReq` wrapper in the supabase client: managed calls attach a fresh token and,
  belt-and-braces, force-refresh + retry once on a 401. All call sites (`load*`,
  `saveConfig`, `approveProposal`, `rejectProposal`, the `runSweep` loop) now drop the
  explicit `session.token` and go through it. Sign-in/boot still pass explicit tokens.
- **The 11 stuck proposals were NOT auto-approved** (curriculum is human-gated). The fix
  lets the operator open Curriculum → Approve each one; it now succeeds. ← owner action.

### CR-033 — Sweep coverage dashboard + persisted outcomes (DONE)
Sweep errors were never persisted (returned in the HTTP response, logged to a transient
div). Now captured + surfaced.
- **Migration `0006_sweep_runs.sql`** (idempotent; applied to `rtyvomkhajyinlycgjzm`):
  append-only `sweep_runs` (outcome = created|skipped|error, detail, model, run_by) +
  index + RLS (admins read via `is_admin()`; service role inserts, bypasses RLS).
- **`run-sweep` edge fn:** `logRun()` writes a row on every terminal path
  (skipped/created/each error). **Redeployed via MCP — version 4.** Source in git is the
  truth; prod only updates on MCP deploy.
- **admin.html "Coverage" tab:** subject+year selector → full taxonomy topic list joined
  against approved objects / proposals / latest sweep_runs, status per topic (pure
  `deriveSweepStatus`, canonical in `scripts/sweep_coverage.js`) + summary chips. Degrades
  gracefully if `sweep_runs` is absent.

## Tester / verification
- New `scripts/sweep_coverage.js` (canonical `tokenNeedsRefresh` + `deriveSweepStatus`) +
  new `admin.test.js` (18 cases, both paths) wired into `npm test`.
- `sweep.test.js` CR-031 skip-window widened (the inserted `logRun` pushed it past the old
  80-char regex — behaviour unchanged).
- `npm test` green; `node --check` clean on the extracted admin `<script>` and new JS.
- DB verified: `sweep_runs` exists, RLS on, `sweep_runs_admin_read` policy present.
- Live edge invocation (writing a real `sweep_runs` row) NOT smoke-tested here — needs an
  admin JWT. First real sweep after deploy will populate it; verify a `created` row lands.

## Files
- `frontend/admin.html` — token refresh (DEF-054) + Coverage tab (CR-033).
- `supabase/functions/run-sweep/index.ts` — `logRun` on every path (deployed v4).
- `migrations/0006_sweep_runs.sql` (applied).
- `scripts/sweep_coverage.js` (new), `admin.test.js` (new), `package.json` (test wired).
- `Project Files/DEFECT_LOG.md` (DEF-054), `CR_LOG.md` (CR-033).

## Notes / for the owner
- Branch: `claude/year2-maths-sweep-dashboard-sbt61j`.
- `run-sweep` deployed with `verify_jwt:false` (unchanged — the function does its own
  admin gate via `/auth/v1/user` + `admin_users`).
- Open the Coverage tab on maths/Year 2: expect ~23 approved, 11 pending, 0 errored, 0 not
  swept (matches current live data). Re-approve the 11 pending to finish Year-2 maths.
