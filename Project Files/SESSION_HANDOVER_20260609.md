# BrightMind V2 Session Handover — 9 June 2026

Branch: `claude/ecstatic-hamilton-1f71tr` (worker repo `maus23m/brightmind-worker`).
**Reopened and finished CR-022** (depth/width coverage + mastery model) — the 5 Jun "DONE"
had shipped only 1 of its 6 pillars (logged as **DEF-049**). Built the full 2D model in
5 sub-slices. Code complete + tests green; one operator step (a reliability number) gates
the final close. Nothing is deployed yet — files handed back to commit; one migration was
applied via Supabase MCP.

## What Was Done This Session

### Decision baked in first (before coding)
- **Axis = orthogonal.** Depth (recall→procedure→application→reasoning) is independent of
  the Easy/Medium/Hard *difficulty* dial. Matrix is `sub_strand × depth`; difficulty is
  within-cell granularity. Written into `BrightMind_PreLaunch_Spec.md` CR-022 detail.
- **Depth is anchored, not free-labelled** (the depth-axis version of model-judging-model
  is the exact failure to avoid). The prompt anchors depth to labelled exemplar cells; a
  depth-tag agreement number is measured and the parent recommendation is **gated** on it.
- Logged **DEF-049** + a **CR-022 (cont.)** row *before* touching code (log-before-fixing).

### CR-022 (cont.) — full build, 5 safe sub-slices
- **A — 2D tag (backward compatible).** `prompts/question_gen.txt`: every question now
  carries `subStrand` (verbatim from the approved block when present) + `depth` (4 bands,
  anchored to exemplars, "depth ≠ difficulty / spread across both axes"); `subtopic` kept
  as a one-release alias. `index.js generate()` parses + normalises both; new pure
  `curriculum.js approvedSubStrandIndex` aligns `subStrand` to the canonical approved name
  (off-list → kept + warned; invalid depth → null — never dropped, fallback preserved).
  `review.js` carries the tags across audit rewrites. `bankWrite`/`adaptBank`/
  `cleanQuestions` + the per-job log all went 2D. Migration `coverage_2d` (mirror
  `migrations/0003_coverage_2d.sql`): `question_bank.sub_strand`+`depth` (idempotent,
  backfilled from `subtopic`), coverage index, seeded `COVERAGE_WEAK_PCT` dial.
- **B — per-child matrix.** New pure `coverage.js`: `buildCoverageMatrix` is a projection
  over `results.answers` (NO new table), `gridStatus` (untested/weak/strong; **NULL depth
  lights no cell** — DEF-049 invariant so a 100%-recall set never reads as mastered),
  `untestedCells`.
- **C — parent recommendation.** `coverage.js recommendation` + frontend **Coverage Map**
  card (`renderCoverageMastery`, observed grid) + 2D `renderCoverageSummary` (width chips +
  depth strip). MCQ + freeform answer records now carry the tags (the matrix's source).
  **GATED:** the card shows OBSERVED coverage ("practised"), not a mastery verdict, until
  the agreement number clears threshold.
- **D — width-adaptive driver.** `coverage.js buildCoverageTargetGuidance` + new
  `{{coverage_target}}` prompt block (soft "prioritise", never a hard gate; composes with
  difficulty). Handler reads the child's matrix (`getChildResults`) → threads into both
  generate calls. `""` when no matrix/curriculum → prompt identical to today.
- **E — gap-aware top-up.** `adaptBank` gains a gap-cell bank tier *before* difficulty.
  Width gap-fill works now; depth-targeted fill grows as the bank re-tags (caveat, by
  design — legacy rows backfilled width-only, depth NULL).

### Amendment 3 — DONE-label audit (report-only, no fixes; work is paused)
Scanned `CR_LOG.md` DONE rows against their specs:
- **CR-022** — the material mislabel (1 of 6 pillars shipped). Now reopened + finished.
- **CR-019** ("DONE") rests on *indirect* test coverage ("compute_test.js rejection text +
  manual top-up log check") — no dedicated automated test for the top-up feedback
  injection itself. Minor; flag only.
- CR-021 / CR-021a are honestly logged as **REVERTED**. DEF-043/044 correctly sit at
  **IN-TEST**, not DONE. CR-015/016/020, ADMIN-1/2 spot-checked — test coverage matches
  their claims, look genuinely done.
Conclusion: CR-022 was the one overstated label; CR-019's is a soft flag.

## Test status
`npm test` green: compute 70 + review 33 + prompts 42 + config 16 + curriculum 30 +
sweep 20 + **coverage 36** (new file). `node --check` clean on all JS + the HTML inline
script. New `coverage.test.js` includes the **two spec-mandated tests**: (1) a 100%-recall
tutorial shows application/reasoning untested, not mastered; (2) a gap matrix produces
target guidance naming the gap cells.

## Deploy / operate notes
- Migration `coverage_2d` already applied to `rtyvomkhajyinlycgjzm` via MCP (idempotent;
  verified: `sub_strand`+`depth` columns, `idx_question_bank_coverage`, `COVERAGE_WEAK_PCT`
  = 0.6). Backfill touched 0 rows (existing 10 bank rows had null `subtopic`).
- Worker behaviour is **unchanged** until: a child has depth-tagged history (matrix steers)
  AND/OR an approved curriculum object exists. No approved object / no tags → today's
  pipeline byte-for-byte.
- `COVERAGE_WEAK_PCT` appears automatically in the admin Config tab (the admin app lists
  the table) — no `admin.html` change needed. It's the weak/strong cell threshold (0–1).
- **The one open operator step (DEF-049 final close):** run
  `node scripts/depth_tag_check.js [--limit 40] [--subject maths] [--year 7]` with
  ANTHROPIC_API_KEY + Supabase service role. It judges recent depth-tagged bank questions
  with an independent classifier and prints an **agreement %** + confusion table. Record
  the number here. If it clears the agreed threshold, promote the parent recommendation
  from observed → confident (flip `confident` in `renderCoverageMastery` / pass
  `confident:true` to `recommendation`). Until then, leave it OBSERVED. Not run in-session
  (no API key here), exactly like the curriculum sweep.

## Still Open (carried forward)
- **DEF-049** — CR-022 final close pending the depth-tag agreement number (above).
- DEF-048 (taxonomy sync debt) — NOTE: the frontend Coverage Map aggregation in
  `renderCoverageMastery` reimplements `coverage.js buildCoverageMatrix` inline (a single
  HTML page can't `require` the node module). Same one-source-of-truth debt class as
  DEF-048; kept thin. Proper fix needs a build step or a shared bundle.
- DEF-047 (admin temp password), DEF-033/034/035/036/038/040/043/044. CR-010/012/017/018.
  CR-019 done-label soft flag (above). Paused CR-023..CR-030 backlog.
- Admin later slices: dashboards (coverage/rejection/accuracy), migrate EPS/MATCH_TOL +
  generation-count dials.

## Key principles (carry forward)
1. Depth is anchored to exemplars, never free-labelled — and its reliability is measured
   before the matrix's depth axis is trusted for a mastery verdict.
2. NULL depth = unknown, never "all bands covered" — no false mastery from legacy rows.
3. Fallback sacred: no approved object / no child history → byte-for-byte today's pipeline.
4. Matrix is a projection over `results.answers` — no second write path.
5. A DONE label is a claim to verify against the spec, not to trust (DEF-049).
6. Fix the class, show-don't-describe, log every resolved variable, read the file first.
