# BrightMind V2 Session Handover — 7 June 2026

Branch: `claude/optimistic-allen-dsblK` (worker repo `maus23m/brightmind-worker`).
Built the **admin backend** in two slices on top of the 5 Jun work. PR #15 (Slice 1 +
CLAUDE.md) is **merged to main**; the curriculum slice (Slice 2) is committed on the
branch.

## What Was Done This Session

### CLAUDE.md — auto-loaded rulebook (NEW)
- Added a root `CLAUDE.md` (Claude Code auto-loads it every session). Folded the
  project's RULE/WHEN/CHECK discipline into it: orientation, five-agent ownership,
  files/code, defects, prompts, diagrams, documentation, communication.
- New standing rule: **keep documentation current as part of every change, proactively;
  flag the judgement call when it's ambiguous which doc applies.**
- Fixed three stale rules while folding them in: session-summary filename (now
  CLAUDE_CODE_HANDOVER + SESSION_HANDOVER_*), prompt+validation location (now the
  worker's `prompts/` + index/compute/review, not "the Edge Function"), and the
  draw-SVG-directly rule (reframed around the CR-021 revert, not the old JSXGraph cause).

### ADMIN-1 — Admin backend Slice 1: runtime_config dials (DONE, merged)
- DB (`migrations/0001_admin_runtime_config.sql`, applied via MCP): `runtime_config`,
  append-only `config_audit`, `admin_users` gate; RLS via `is_admin()`; audit trigger;
  trigger RPC EXECUTE revoked. Seeded the 4 dials.
- Worker (`index.js`): `getConfig()` (60s TTL cache) + pure `_parseConfigValue`,
  resolved per job into `cfg`, threaded through generate/diagrams/review. Falls back to
  env/default on any miss → no behaviour change until a value is set. Logs resolved
  dials + config/default source.
- Admin app (`frontend/admin.html`, served at `/admin.html`): vanilla-JS SPA, Supabase
  Auth + `admin_users` gate, config list/edit + audit panel.
- Tester `config.test.js` (16). **First admin** `maus23@gmail.com` created directly in
  Supabase (auth.users + identity + admin_users) with a TEMP password
  `BrightMindAdmin!2026` — change it (see DEF-047). Admin app confirmed working in prod.

### ADMIN-2 — Admin backend Slice 2: curriculum curation & approval (DONE, on branch)
- DB (`migrations/0002_curriculum_curation.sql`, applied via MCP): `curriculum_objects`
  (frozen/versioned; payload = sub_strands/prerequisites/misconceptions) +
  `curation_proposals` (max-recall union, provenance + year_flag); RLS via `is_admin()`;
  audit trigger → `config_audit`; atomic `approve_curation_proposal()` RPC
  (next-version, archive-prior, stamp, mark-approved, internal admin guard). Seeded one
  real proposal from `Coverage_Taxonomy_Demo_Y7_Expressions_Equations.md`.
- `curriculum.js` (pure, shared by worker + sweep): validate / parse / latest-per-topic /
  `buildCurriculumGuidance` (the steering block).
- Worker: `getApprovedCurriculum()` resolved per job, threaded into
  `generate`→`buildPrompt`; new `{{curriculum}}` in `prompts/question_gen.txt`
  (approved = authoritative, self-enumeration = fallback). Steer-with-fallback, no hard
  gating. Job log prints steered/fallback topic split.
- Offline sweep `scripts/curriculum_sweep.js` + `prompts/curriculum_sweep.txt`:
  operator-run, best-effort source fetch, distils max-recall union → writes a
  `pending_review` proposal. NOT the worker/hot path. Needs the operator's
  `ANTHROPIC_API_KEY` (not run in-session).
- Admin app: Config | Curriculum tabs; proposal prune (untick) / edit / add, badges,
  Approve (RPC) / Reject; read-only approved-objects list.
- Tester `curriculum.test.js` (20) + `prompts.test.js` (+6). Left a pristine first-run
  state: 1 pending proposal, 0 approved objects.
- **Batch sweep:** `scripts/curriculum_sweep.js` gained a per-subject+year batch mode
  (`--subject maths --year 7 [--yes] [--topics] [--limit]`) reading a canonical
  `curriculum_taxonomy.json` (mirrors the frontend constants); skips already
  pending/approved topics; plan/confirm guard (no calls without `--yes`). New
  `sweep.test.js` (20). Taxonomy now duplicated frontend↔JSON → DEF-048 (sync debt).
- **In-app Run sweep:** admin-gated Supabase Edge Function `run-sweep`
  (`supabase/functions/run-sweep/index.ts`, deployed via MCP) + a "Run sweep" panel in
  the admin Curriculum tab (subject+year+topic / all-for-year). Moved
  `curriculum_taxonomy.json` → `frontend/` (served + fetched by the app). **Operator step:
  set `ANTHROPIC_API_KEY` as a Supabase function secret** or the button returns "key not
  configured". Edge function re-ports the prompt + validator (DEF-048).

## Test status
`npm test` green: compute 70 + review 30 + prompts 33 + config 16 + curriculum 20 + sweep 20.
`node --check` clean on all JS + both HTML script blocks.

## Deploy / operate notes
- Slice 1 + 2 migrations are already applied to `rtyvomkhajyinlycgjzm` via MCP (idempotent).
- Worker behaviour is unchanged until: a `runtime_config` value is set, or a
  `curriculum_objects` row is approved for a (subject, topic-chip, year). Topic must match
  the exact frontend chip string (e.g. `Expressions & Equations` with `&`).
- To generate a proposal: `node scripts/curriculum_sweep.js --subject maths --topic
  "Expressions & Equations" --year 7` (operator env with ANTHROPIC_API_KEY + Supabase
  service role). Approve it in the admin app's Curriculum tab.

## Still Open (carried forward)
- DEF-047 (NEW) — admin password reset broken; temp password still in use.
- DEF-033 (IN-TEST), DEF-034 (top-up skips audit/child), DEF-035 (audit diagram-blind),
  DEF-036 (bank topic tagging), DEF-038 (decorative diagram), DEF-040 (visual QA),
  DEF-043/044 (IN-TEST). CR-010, CR-012, CR-017, CR-018. Paused CR-022..CR-030 backlog.
- Admin backend later slices: dashboards (coverage/rejection/accuracy); migrate the
  deferred dials (EPS/MATCH_TOL in compute.js, generation counts).

## Key principles (carry forward)
1. Maximum recall in, human prunes down — never a minimal default (it dropped factorising once).
2. Human-gated: no curriculum object reaches a child without status=approved + a stamp.
3. Worker behaviour unchanged until a value/object is explicitly set — fallbacks preserved.
4. Fix the class, show-don't-describe, log every resolved variable, read the file before editing.
