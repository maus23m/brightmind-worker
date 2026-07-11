# Session Handover — 16 June 2026

## What was done

### DEF-053 — Coverage driver leaked sub-strands across topics (CRITICAL, Orchestrator/Curriculum)

Owner reported "tutorial topic selection busted" with a live screenshot: a Year-2
**Angles Introduction** tutorial for child Rudhvi came back as 10 **tally-chart**
questions (chip said "Angles Introduction"; every question + diagram was about tally
marks).

**Topic selection was NOT the bug.** Traced the full pipeline against the live DB
(`brightmind-v2`, `rtyvomkhajyinlycgjzm`):

- `generation_jobs` row `9b57b663` stored `topics:["Angles Introduction"]` correctly,
  `subtopics:null`, `bank_supplied:0`, `source:"claude"` — so Claude **freshly generated
  tally questions for an Angles job**. The frontend passes topic by name everywhere; the
  worker fetches approved curriculum by exact topic name. No index/name swap exists.

**Root cause — the CR-022 coverage driver:**

1. `buildCoverageMatrix(childResults)` aggregated the child's recent results **across all
   topics**, so `observedSubStrands` carried tally sub-strands from Rudhvi's earlier
   **Tally Charts** tutorial (6/14).
2. "Angles Introduction" has **no approved `curriculum_objects` row** (only 4 Year-7 maths
   topics do) → `covObj = null`.
3. `buildCoverageTargetGuidance(matrix, null)` → `gridSubStrands(matrix, null)`
   (`coverage.js:52-57`) **fell back to `observedSubStrands`** = the tally sub-strands, and
   emitted a `{{coverage_target}}` "COVERAGE TARGETING … cover these first: …tally…" block.
4. That block, injected into the Angles prompt (`question_gen.txt:15`), **overrode the
   topic line**, so Claude generated tally questions.

Self-perpetuating loop — confirmed the 6/16 **Place Value** job (`8e05918b`) was
contaminated the same way (its results were tagged with tally sub-strands, which kept
re-seeding the observed list).

**Class:** generation steered by sub-strands that don't belong to the requested topic, via
the no-curriculum-object observed-fallback.

**Fix (code):**

1. `coverage.js` `buildCoverageTargetGuidance` — returns `""` unless an authoritative
   (approved) curriculum object with sub-strands is supplied. Steering is now
   **authoritative-only**. The observed fallback stays ONLY for the parent-facing coverage
   MAP (`gridStatus`/`recommendation`), which is unaffected.
2. `coverage.js` `buildCoverageMatrix(results, topics)` — optional topic filter; when
   passed, only results whose `topics` intersect are aggregated, so the matrix never mixes
   other topics. Backward compatible (no arg → legacy all-rows behaviour).
3. `index.js` — `getChildResults` now selects `topics`; the job handler builds the matrix
   scoped to the job topics (`buildCoverageMatrix(childResults, topics)`) and only derives
   `coverageTarget`/`gapSubStrands` when `covObj` is present. Self-enumerated topics (no
   approved object) get NO coverage steering — the prompt's own enumeration drives them.

No prompt change (an empty `{{coverage_target}}` already means "no steering"), so no paired
prompt-validation review was required.

**Tester:** `coverage.test.js` +8 assertions — topic-scoped matrix
(include/exclude/legacy/missing-`topics`) and authoritative-only steering (no curriculum
object → no block; approved object → still steers). Full `npm test` green (70 + 33 + 72 +
16 + 45 + 37 + 44, 0 failed). `node --check index.js`, `node --check coverage.js` clean.

**Data cleanup (purge, owner-approved):** deleted the contaminated records for child
b8b76b1b — **3 `results`, 2 `tutorials`, 3 `generation_jobs`** (Place Value + Angles).
The `question_bank` was clean (tally rows correctly tagged `Tally Charts`). A global scan
flagged a second child's Year-7 **Data Collection** tutorial, but that was a **false
positive** — Data Collection legitimately includes a "Tally charts and frequency tables"
sub-strand alongside surveys/frequency tables — so it was left untouched. Post-cleanup
contamination scan for Rudhvi: 0/0/0.

## State

- Branch: `claude/tutorial-topic-selection-bug-j981li`.
- Worker code change is NOT yet deployed to the running worker — needs the usual deploy
  for the fix to take effect in production generation.
- DB cleanup already applied to `rtyvomkhajyinlycgjzm` (live).

## Follow-ups / watch-outs

- After deploy, eyeball a fresh Year-2 "Angles Introduction" (and "Place Value") tutorial
  for Rudhvi to confirm questions are now on-topic (coverage steering is empty for these
  no-approved-object topics, so it's the clean self-enumeration path).
- Security advisory surfaced while querying: RLS is disabled on `question_bank`,
  `child_question_history`, `question_rejections_backup_20260614` — anyone with the anon
  key can read/modify every row. Not addressed here; raise with owner (do NOT enable RLS
  without policies or it blocks all access).
- DEF-052 (angle-diagram quality) still awaiting post-deploy visual QA from the 14 Jun fix.
