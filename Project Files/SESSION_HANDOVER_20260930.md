# Session Handover — 30 Sep 2026

Resuming after ~3-month pause (last commit on `main` `df494f3`, 25 Jun 2026, DEF-053).
*Correction (6 Oct): two later sessions existed on unmerged branches — 16 Jun (`SESSION_HANDOVER_20260616.md`) and 28 Jun (`_20260628.md`) — merged 5 Oct as PRs #25/#27. IDs DEF-054 (RLS) in this file is now **DEF-059**.* Claude.ai project
files are stale (stop at 25 May) — repo `Project Files/` is the source of truth.

## Done this session

- **Model upgrade via admin `runtime_config` (no redeploy):** `CLAUDE_MODEL` and `DIAGRAM_MODEL` →
  `claude-opus-5-5` (previously `CLAUDE_MODEL = claude-opus-4-8`, `DIAGRAM_MODEL = claude-opus-4-7`).
  Changed by maus23@gmail.com, 30 Sep 2026.
- **First live check:** Year 7 "Nets of 3D shapes" diagram (open-top box 10×8×5) — correct
  proportions, no answer leak, answer 260 cm². Minor: "5 cm" label placement ambiguous (no
  dimension line) — harmless when the question text states the value.
- **RLS live check (Supabase advisor, CRITICAL):** RLS was DISABLED on `question_bank`,
  `child_question_history`, `question_rejections_backup_20260614`.
- **DEF-054 (CRITICAL) — RESOLVED.** Migration `0006_rls_question_tables.sql` applied to
  `rtyvomkhajyinlycgjzm`: RLS on all three, admin-only SELECT, no client write policy.
  Verified live: anon sees 0 rows; service role still sees all (bank 73, history 541, backup 23).
  Advisor now shows no RLS errors. New `security.test.js` (in `npm test`): every table the code
  references must be RLS-enabled by a migration or on the verified pre-migration list.
- **Backup table kept, not dropped:** `question_rejections_backup_20260614` = 23 parent rejections
  (16 May–14 Jun, all maths Y2/Y7; 7 diagram-missing, 1 wrong-answer, 15 other/misc — most with notes).
  It is the ONLY copy (live `question_rejections` is empty). Useful input for the diagram
  regression pass and the golden set.
- **DEF-055 (MINOR) — RESOLVED.** `index.js` fallbacks + `migrations/0001` seed → `claude-opus-5-5`
  (both models). `config.test.js` now enforces code default == seed and no model literal
  elsewhere. **Needs a Cloud Run redeploy to take effect** (fallback only — live config unaffected).
- **DEF-056 (MAJOR) — RESOLVED.** Child year change didn't flow through: dashboard tiles and
  topic badges showed last year's scores/tutorials (Spruha Y7→Y8, Rudhvi Y2→Y3; all 93 results
  were prior-year). Migration `0007_results_year_group.sql` (applied live): `results.year_group`
  added, backfilled from the tutorial, stamped on insert by trigger. Frontend `inYear()` now
  scopes tile %/test count, topic badges, adaptive difficulty and the progress screen; worker
  coverage matrix (`getChildResults`) reads only the job's year. Streaks/calendar/dedupe stay
  cross-year by design. Tester: `yearscope.test.js`. **Needs frontend (Netlify) + worker
  (Cloud Run) deploy.** Owner check after deploy: both tiles show "No maths tests yet" and the
  topic grid shows no badges until Year 8 / Year 3 tutorials are done.
- `npm test` green (9 suites).

## Next actions (in order)

1. **Verify model switch in Cloud Run logs** — job-start line should show both models from
   `config` = `claude-opus-5-5`. Record total job time vs ~26 s budget. If slow/timeouts: set
   `CLAUDE_MODEL=claude-sonnet-5-5`, keep Opus for diagrams.
2. **Diagram regression pass** on previously failing topics: angles on a straight line (DEF-052),
   circles/radii (DEF-045), coordinates (DEF-043). Close DEF-040 / DEF-052 on owner visual QA.
3. ~~Stale model defaults~~ — done (DEF-055). Redeploy the worker to pick up the new fallback.
4. ~~RLS~~ — done (DEF-054). Remaining advisor WARNs (by design / owner): `is_admin()` and
   `approve_curation_proposal()` are SECURITY DEFINER callable by clients (both gate on admin
   internally); **enable Leaked Password Protection** in Supabase Auth settings (dashboard toggle).
5. **CR-017:** legacy bank verify migration (bank was empty until DEF-051 fix on 14 Jun — small exposure).
6. **ID clash:** PreLaunch Spec "CR-021 accuracy regression battery" collides with CR_LOG CR-021
   (diagram reviewer, reverted). Re-ID the battery.
7. **Accuracy battery** Layer 1 formalise; Layers 2–4 need human golden set (blocked on
   launch-surface decision).
8. **CR-018:** clean-dividing inputs in `question_gen.txt` (paired audit/review validation).

## Still open

DEF-036, DEF-047, DEF-048, CR-010, CR-012. Owner decision pending: Coverage Map observed →
confident (n=40 at 95%).

## Human track (not started)

Launch surface (1–2 year groups); golden set with curriculum specialist; UK GDPR + Children's
Code; privacy policy/ToS; parental consent; retention/deletion; payment provider + pricing.
