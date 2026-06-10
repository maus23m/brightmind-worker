# BrightMind V2 Session Handover — 10 June 2026

Branch: `claude/sleepy-rubin-dgffc0` (worker repo `maus23m/brightmind-worker`).
**DEF-050 diagnosed and fixed** — the in-app "Run sweep" panel (subject + year + topic
selection in the admin Curriculum tab) had vanished from the live previews. No code was
ever broken: the feature never reached `main`.

## Root cause (DEF-050)

On 7 June, commits `b751b0b` (in-app Run sweep panel + `supabase/functions/run-sweep/index.ts`
+ taxonomy move to `frontend/curriculum_taxonomy.json`) and `0da3fbd` (docs: confirmed
working) were pushed to `claude/optimistic-allen-dsblK` **after PR #17 from that branch had
already been merged**. The merge captured only up to `8d06e64` (batch CLI mode); the two
later commits were stranded on the branch. raw.githack and GitHub Pages serve `main`, so
the panel disappeared from both. The failure was silent because the feature's server half —
the `run-sweep` Edge Function — stayed deployed and ACTIVE in Supabase (verified via MCP)
while its UI half never reached `main`.

CLASS: (1) pushing to a branch after its PR merges strands commits invisibly;
(2) features split across git (frontend) and MCP-deployed state (Edge Functions) can
half-ship with nothing asserting the git half exists.

## What was done

1. **Logged DEF-050** in `DEFECT_LOG.md` (before fixing, per rule).
2. **Merged `origin/claude/optimistic-allen-dsblK`** into this branch — clean, no
   conflicts. Restores: the admin Run sweep panel (`frontend/admin.html`, +82 lines),
   `frontend/curriculum_taxonomy.json` (moved from root; app + CLI + tests all read this
   one copy), `supabase/functions/run-sweep/index.ts` (source of the already-live
   function), and that session's doc edits.
3. **Tester guard (closes DEF-050):** 7 structural assertions in `sweep.test.js` —
   `sw-subject`/`sw-year`/`sw-topic`/`sw-run` elements, the `/functions/v1/run-sweep`
   call, the taxonomy fetch, and Years 2–11 coverage. These fail loudly if the panel
   goes missing again.
4. **Docs reconciled:** `LINKS.md` (PR #17 marked merged with the stranded-commit note;
   PR #18 added; active-branch compare link updated), `DEFECT_LOG.md` (DEF-050 RESOLVED).

## Test status

`npm test` green: compute 70 + review 33 + prompts 42 + config 16 + curriculum 30 +
**sweep 27** (20 + 7 new DEF-050 guards) + coverage 36. `node --check` clean on all JS
and both HTML inline scripts.

## Deploy / operate notes

- **Nothing to deploy server-side** — the `run-sweep` Edge Function (v1) is already
  ACTIVE on `rtyvomkhajyinlycgjzm`; `ANTHROPIC_API_KEY` is already a project secret.
- **Owner verification:** open
  `https://raw.githack.com/maus23m/brightmind-worker/claude/sleepy-rubin-dgffc0/frontend/admin.html`
  → sign in → Curriculum tab → Run sweep panel with subject/year/topic selectors.
  Once merged to main, the main githack/Pages previews recover automatically
  (Pages deploys `frontend/`, which now carries `curriculum_taxonomy.json`).
- Netlify production autodeploy remains PAUSED (unchanged).

## Process rule to carry forward

After a PR merges, run `git log main..<branch>` before ending the session — it must be
empty. Anything listed is stranded work.

## Still open (carried forward, unchanged from 9 Jun)

- DEF-049 — CR-022 final close gated on the depth-tag agreement number
  (`scripts/depth_tag_check.js`, needs API key).
- DEF-048 (taxonomy/validator sync debt — partially improved: the json now has one
  canonical copy in `frontend/`, but the Deno re-port in `run-sweep` remains),
  DEF-047 (admin password reset), DEF-033/034/035/036/038/040/043/044.
- CR-010/012/017/018, CR-019 done-label soft flag. Paused CR-023..CR-030 backlog.
- Admin later slices: dashboards, migrate EPS/MATCH_TOL + generation-count dials.
