# Session Handover — 12 June 2026

## What was done

### Step 1: Close DEF-033, DEF-043, DEF-044 (housekeeping + Tester tests)

All three fixes were confirmed in `main` by code audit. Added 9 structural assertions to `prompts.test.js` (now 51 tests, was 42):
- **DEF-043** (5): coordinate-grid letter-name-only rule in `question_gen.txt` + `diagram_system.txt`.
- **DEF-033** (2): `processDiagrams` DROPPED log + `results.push` gated on svg truthy.
- **DEF-044** (2): `final.length === 0` guard + zero-question path writes `status:'failed'`.

Defect log updated: DEF-033, DEF-043, DEF-044 all marked **RESOLVED (12 Jun 2026)**.

### Step 2 (bonus discovery): DEF-035 already resolved in code

Code audit found `review.js` `buildReviewQuestions()` already passes `diagramPrompt: q.diagramPrompt || null` to the auditor (with a `// DEF-035` comment), and `review.txt` criterion 3 already checks it for scenario/data mismatch and coordinate answer leaks. The defect log was wrong. Added 2 structural Tester assertions and marked **RESOLVED**.

### Step 3: DEF-034 — Route top-up through Stage 4 review (MAJOR fix)

Top-up questions previously went `generate → compute → processDiagrams → bankWrite`, skipping Stage 4 (Audit + Child agents). Fix: added `review()` call and `topupPassed` filter in `index.js` top-up block, with a `Top-up Stage 4: N/M passed` log line — identical pattern to the main path. Added 2 structural Tester assertions to `prompts.test.js`.

Defect log updated: DEF-034 marked **RESOLVED (12 Jun 2026)**.

### Step 4 (same session): DEF-038 — Fix decorative plant-cell diagram example

Re-audit found the nutrition/digestion example was already data-rich. The **plant-cell example** (`question_gen.txt` lines 283-292) was the remaining decorative one — labels only, no counts. Fixed by:
- Prose: "exactly 5 small oval chloroplasts" + vacuole "fills about 60% of the cell area"
- Label whitelist: `Vacuole — '60% of cell area'` and `Chloroplasts — '5 visible'`

Follows the adjacent atom example pattern (explicit counts in both prose and labels). DEF-038 marked RESOLVED.

### Step 5 (same session): CR-031 — Allow re-runs in sweeps

New CR from owner: the sweep skipped any topic already pending/approved with no way to re-sweep. Built a `force` option across all three sweep surfaces (the DEF-048 sync trio, moved together):
- **Edge Function** (`supabase/functions/run-sweep/index.ts`): `force` body param; supersedes the pending proposal (status → `superseded`, no migration needed — plain text column, audit trigger logs it) then writes fresh. Approved objects untouched (approve RPC versions/archives on approval of the fresh proposal).
- **Admin app** (`frontend/admin.html`): "Re-sweep existing" checkbox (`sw-force`) wired into the run-sweep call.
- **CLI** (`scripts/curriculum_sweep.js`): `--force` flag; `planTargets` force mode; `supersedePending()` before writes in single + batch modes.

Tester: `sweep.test.js` 27 → 37. **DEPLOY PENDING:** the Edge Function redeploy was permission-blocked in-session — until redeployed, the checkbox is a safe no-op (live function ignores the unknown `force` field and keeps skipping).

### Step 6 (same session): CR-032 — Subtopic selection in the tutorial wizard

New CR from owner: expand each selected topic into its approved sub-strands in wizard step 2; parent can deselect; all selected by default. Built fail-open end-to-end:
- **Frontend** (`frontend/index.html`): `#subtopic-panel` + `loadApprovedSubStrands` / `renderSubtopicPanel` / `onSubtopicToggle`; hooks in all three topic-mutation paths; step-2 gate (≥1 subtopic per expandable topic); `subtopics` in the job payload. +5 wizard self-tests.
- **Worker** (`index.js` + `curriculum.js`): new pure `filterApprovedSubStrands` narrows approved objects to the parent's selection (name/id slug match, misconception pruning, zero-match fail-open); applied before the coverage merge so the CR-022 gap driver honours it too. +15 curriculum tests.
- **Migration** `0004_subtopic_selection.sql`: `generation_jobs.subtopics jsonb` + authenticated read of approved `curriculum_objects` (currently admin-only RLS).

**TWO DEPLOY DEPENDENCIES (both safe no-ops until done):**
1. Apply migration 0004 (MCP blocked in-session). Without it the panel never shows (RLS blocks the read).
2. Update the `generate-questions` Edge Function (deployed-only, source NOT in repo — same DEF-048/DEF-050 class) to copy `subtopics` from the request body into its `generation_jobs` insert. One-line change; without it the worker never sees the field and fails open.

## Final state this session

- Branch: `claude/next-steps-planning-iu0n39` (PR #20)
- `npm test` green: **compute 70 + review 33 + prompts 57 + config 16 + curriculum 45 + sweep 37 + coverage 36 = 294 passed, 0 failed**
- `node --check` clean (index.js, curriculum.js, CLI, admin.html + index.html inline scripts)

## Open work

| Item | Status |
|---|---|
| CR-031 Edge Function redeploy (`run-sweep` to `rtyvomkhajyinlycgjzm`) | PENDING — Supabase MCP approval gate blocked all calls in-session; owner to deploy or approve the connection |
| CR-032 migration 0004 apply + `generate-questions` Edge Function update (copy `subtopics` body field into the `generation_jobs` insert) | PENDING — same MCP block; function source not in repo |
| CR-022 final close — run `scripts/depth_tag_check.js`, record agreement number | PENDING (operator action; in-session Supabase MCP reads also blocked) |

## Still open defects
- DEF-036, DEF-040 (awaiting visual QA), DEF-047, DEF-048, DEF-049

## Notes for next session
- Only remaining code-gated item: operator runs `node scripts/depth_tag_check.js` with Supabase creds (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` for project `rtyvomkhajyinlycgjzm`) → records agreement %, updates `Project Files/CR_LOG.md` CR-022 row, closes DEF-049.
- All other remaining open defects (DEF-036, DEF-047, DEF-048) are MINOR with existing mitigations. DEF-040 awaits visual QA by the owner.
