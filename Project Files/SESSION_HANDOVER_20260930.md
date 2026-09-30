# Session Handover — 30 Sep 2026

Resuming after ~3-month pause (last commit `df494f3`, 25 Jun 2026, DEF-053). Claude.ai project
files are stale (stop at 25 May) — repo `Project Files/` is the source of truth.

## Done this session

- **Model upgrade via admin `runtime_config` (no redeploy):** `CLAUDE_MODEL` and `DIAGRAM_MODEL` →
  `claude-opus-5-5` (previously `CLAUDE_MODEL = claude-opus-4-8`, `DIAGRAM_MODEL = claude-opus-4-7`).
  Changed by maus23@gmail.com, 30 Sep 2026.
- **First live check:** Year 7 "Nets of 3D shapes" diagram (open-top box 10×8×5) — correct
  proportions, no answer leak, answer 260 cm². Minor: "5 cm" label placement ambiguous (no
  dimension line) — harmless when the question text states the value.
- **RLS live check (Supabase advisor, CRITICAL):** RLS still DISABLED on `question_bank`,
  `child_question_history`, `question_rejections_backup_20260614`.

## Next actions (in order)

1. **Verify model switch in Cloud Run logs** — job-start line should show both models from
   `config` = `claude-opus-5-5`. Record total job time vs ~26 s budget. If slow/timeouts: set
   `CLAUDE_MODEL=claude-sonnet-5-5`, keep Opus for diagrams.
2. **Diagram regression pass** on previously failing topics: angles on a straight line (DEF-052),
   circles/radii (DEF-045), coordinates (DEF-043). Close DEF-040 / DEF-052 on owner visual QA.
3. **Remove stale hardcoded model defaults:** `index.js` `CONFIG_DEFAULTS` (`claude-sonnet-4-6`)
   and `migrations/0001` seed. Confirm still-valid ids; update + Tester guard (same class as DEF-053).
4. **RLS:** add policies, then enable RLS on `question_bank` + `child_question_history`; drop
   `question_rejections_backup_20260614` if no longer needed. Log as a DEF entry.
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
