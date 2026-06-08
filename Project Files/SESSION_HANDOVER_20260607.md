# BrightMind V2 Session Handover — 7 June 2026

Branch: `claude/optimistic-allen-dsblK` (worker repo `maus23m/brightmind-worker`).
Built the **admin backend** (the operator surface from `BrightMind_Admin_Backend_Spec.md`)
in two slices on top of the 5 Jun work, then added batch + in-app curriculum sweeping.

**PR status:** #15 (Slice 1 + CLAUDE.md) **merged** · #16 (Slice 2 curriculum curation)
**merged** · **#17 OPEN** (batch sweep + in-app Run-sweep + LINKS.md + doc updates).
The `run-sweep` Edge Function and both DB migrations are **deployed live** regardless of #17.

---

## What Was Done This Session

### CLAUDE.md — auto-loaded rulebook (NEW, merged)
- Root `CLAUDE.md` (Claude Code auto-loads it every session) holding the project's
  RULE/WHEN/CHECK discipline: orientation, five-agent ownership, files/code, defects,
  prompts, diagrams, documentation, communication.
- New standing rule: **keep documentation current as part of every change, proactively;
  flag the judgement call when it's ambiguous which doc applies.**
- Fixed three stale rules while folding them in: session-summary filename, prompt+validation
  location (worker `prompts/` + index/compute/review, not "the Edge Function"), and the
  draw-SVG-directly rule (reframed around the CR-021 revert, not the old JSXGraph cause).

### ADMIN-1 — Slice 1: runtime_config dials (DONE, merged #15)
- DB (`migrations/0001_admin_runtime_config.sql`): `runtime_config`, append-only
  `config_audit`, `admin_users` gate; RLS via `is_admin()`; audit trigger (RPC EXECUTE
  revoked). Seeded the 4 dials.
- Worker (`index.js`): `getConfig()` (60s TTL cache) + pure `_parseConfigValue`, resolved
  per job into `cfg`, threaded through generate/diagrams/review. Falls back to env/default
  on any miss → no behaviour change until a value is set. Logs resolved dials + source.
- Admin app (`frontend/admin.html`, `/admin.html`): vanilla-JS SPA, Supabase Auth +
  `admin_users` gate, config list/edit + audit panel. Tester `config.test.js` (16).
- **First admin** `maus23@gmail.com` created directly in Supabase (auth.users + identity +
  admin_users), TEMP password `BrightMindAdmin!2026` (reset broken — DEF-047). Working in prod.

### ADMIN-2 — Slice 2: curriculum curation & approval (DONE, merged #16)
- DB (`migrations/0002_curriculum_curation.sql`): `curriculum_objects` (frozen/versioned;
  payload = sub_strands/prerequisites/misconceptions) + `curation_proposals` (max-recall
  union, provenance + year_flag); RLS via `is_admin()`; audit trigger → `config_audit`;
  atomic `approve_curation_proposal()` RPC (next-version, archive-prior, stamp, mark-approved,
  internal admin guard). Seeded one proposal from the Y7 Expressions & Equations demo doc.
- `curriculum.js` (pure, shared by worker + sweep): validate / parse / latest-per-topic /
  `buildCurriculumGuidance` (the steering block).
- Worker: `getApprovedCurriculum()` per job → `generate`→`buildPrompt`; new `{{curriculum}}`
  in `prompts/question_gen.txt` (approved = authoritative, self-enumeration = fallback).
  **Steer-with-fallback, no hard gating.** Job log prints steered/fallback topic split.
- Admin app: Config | Curriculum tabs; proposal prune (untick) / edit / add, provenance +
  year_flag badges; Approve (RPC) / Reject; read-only approved-objects list.
- Tester `curriculum.test.js` (20) + `prompts.test.js` (+6).

### Curriculum sweep — batch + in-app (DONE, OPEN in #17)
- **Offline sweep** `scripts/curriculum_sweep.js` + `prompts/curriculum_sweep.txt`: distils
  a max-recall union for a topic → writes a `pending_review` proposal. Single-topic mode +
  **per-subject+year batch mode** (`--subject maths --year 7 [--yes] [--topics] [--limit]`),
  reading `frontend/curriculum_taxonomy.json`; skips already pending/approved; plan/confirm
  guard (no Claude calls or writes without `--yes`). Tester `sweep.test.js` (20).
- **In-app Run sweep** (the operator-friendly path): admin-gated Supabase Edge Function
  `run-sweep` (`supabase/functions/run-sweep/index.ts`, deployed via MCP) — verifies caller
  ∈ admin_users, distils one topic via Claude, writes a proposal, skips existing. Admin
  Curriculum tab has a **"Run sweep" panel** (subject + year + topic, or all-for-year with a
  client-side loop + progress). **Confirmed working in-browser.** Reads the project-wide
  `ANTHROPIC_API_KEY` Supabase secret (already configured — no setup).
- `curriculum_taxonomy.json` lives in `frontend/` (served + fetched by the app, read by the
  CLI). Duplicates the frontend `CURRICULUM_KS*_*` constants AND the edge function re-ports
  the prompt + validator → **DEF-048** sync debt.

---

## Test status
`npm test` green: compute 70 + review 30 + prompts 33 + config 16 + curriculum 20 + sweep 20.
`node --check` clean on all JS + both HTML script blocks.

## Live state (Supabase `rtyvomkhajyinlycgjzm`)
- Migrations 0001 + 0002 applied (idempotent). Edge functions: `generate-questions`,
  `job-status`, `run-sweep`.
- Curriculum data: started this session at **1 pending proposal (Expressions & Equations Y7),
  0 approved** — will change as the owner tests Run-sweep / approvals.
- Worker behaviour unchanged until: a `runtime_config` value is set, OR a `curriculum_objects`
  row is approved for a (subject, **exact** topic-chip, year) — e.g. `Expressions & Equations`
  with `&`.

## How to operate
- **Generate proposals (easy):** admin app → Curriculum → **Run sweep** (subject/year/topic).
- **Generate proposals (CLI):** `node scripts/curriculum_sweep.js --subject maths --year 7
  --yes` (shell env with ANTHROPIC_API_KEY + Supabase service role).
- **Approve:** Curriculum tab → prune/edit a proposal → Approve & freeze → worker then steers
  generation for that topic.
- **Test links / URLs:** see `Project Files/LINKS.md` (raw.githack previews, production,
  Supabase, PR list). Admin app branch preview:
  `https://raw.githack.com/maus23m/brightmind-worker/claude/optimistic-allen-dsblK/frontend/admin.html`

## Still Open (carried forward)
- **Merge PR #17** to land batch sweep + the Run-sweep button on `main`/production.
- **DEF-047** — admin password reset broken; temp password still in use (owner deferred).
- **DEF-048** — curriculum taxonomy duplicated (frontend constants ↔ `curriculum_taxonomy.json`
  ↔ edge-function port); keep in sync, unify later.
- DEF-033 (IN-TEST), DEF-034 (top-up skips audit/child), DEF-035 (audit diagram-blind),
  DEF-036 (bank topic tagging), DEF-038 (decorative diagram), DEF-040 (visual QA),
  DEF-043/044 (IN-TEST). CR-010, CR-012, CR-017, CR-018. Paused CR-022..CR-030 backlog.
- Admin backend later slices: dashboards (coverage/rejection/accuracy); migrate the deferred
  dials (EPS/MATCH_TOL in compute.js, generation counts).

## Key principles (carry forward)
1. Maximum recall in, human prunes down — never a minimal default (it dropped factorising once).
2. Human-gated: no curriculum object reaches a child without status=approved + a stamp.
3. Worker behaviour unchanged until a value/object is explicitly set — fallbacks preserved.
4. Fix the class, show-don't-describe, log every resolved variable, read the file before editing.
