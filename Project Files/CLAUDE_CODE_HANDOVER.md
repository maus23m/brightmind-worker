# Claude Code — Handover Brief

Read this top to bottom before touching anything. It is self-contained: you should not need to reconstruct any prior discussion. Detail lives in the three planning docs named below, but everything you need to start is here.

---

## 1. What BrightMind is (30 seconds)
AI tutoring app, UK National Curriculum, Years 2–11, Maths + Science. Parent configures tutorials, child completes them. Differentiator: questions are **generated on demand**, not pulled from a fixed bank.

**Stack:** GCP Cloud Run worker (`maus23m/brightmind-worker`) → Supabase (project `rtyvomkhajyinlycgjzm`) → single-page HTML frontend on Netlify.
**Pipeline:** Bank read (Stage 0) → Generate → Verify/Compute (`compute.js`) → Draw diagrams → Audit → Child Agent → Bank write.
**Five-agent architecture:** Orchestrator (flow/data), Designer (UI/prompts), Curriculum (topic index/validation/diagram logging), Reviewer (spec compliance), Tester (automated tests). Every feature belongs to one. No code outside this framework.

---

## 2. Current decision — read this so you don't build the wrong thing
**Feature/CR work is PAUSED.** The owner has stopped new CR implementation until the app becomes a *credible tutor* — one that holds the curriculum knowledge a real teacher has (full sub-strand coverage, prerequisites, misconceptions).

The foundation for that is a new **internal admin backend** (operator surface). It is the only thing to build now. The backlog of CRs is real but **on hold** — listed in §5 as context, not as work.

---

## 3. The three planning docs and how they relate
You are not lost if you hold this map:
1. **BrightMind_PreLaunch_Spec.md** — the launch plan + all CRs (CR-021..CR-030 etc.). The *features*.
2. **BrightMind_PreLaunch_Split.md** — same work split by executor (Claude Code vs human).
3. **BrightMind_Admin_Backend_Spec.md** — the *foundation* the features sit on. **This is your source of truth for the current job.**

Relationship: the **admin backend (doc 3) produces and stores the curriculum knowledge** that the paused feature **CR-022 (doc 1) consumes**. Workshop vs product. You are building the workshop, starting with its smallest useful slice.

---

## 4. YOUR JOB NOW — Admin backend, first slice
Scope deliberately small. Do **only** this; do not start the curation flow yet.

**Build:** `runtime_config` + `config_audit` tables, the worker's config read, and a minimal admin config screen.

Why this slice first: smallest, immediately useful (adjust dials without a redeploy), and it proves the admin-app + RLS pattern before the heavier curriculum-curation work.

**Tables** (via Supabase MCP `apply_migration`, idempotent — `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`):
- `runtime_config`: `key` (text pk), `value` (jsonb), `value_type`, `description`, `updated_by`, `updated_at`. See doc 3 for full column notes.
- `config_audit`: append-only — what key changed, old→new value, who, when.

**Worker:** read `runtime_config` with a short TTL cache; fall back to current env-var defaults if a key is absent (no behaviour change until a value is set). Safe keys to migrate first: `PIPELINE_MODEL`, `DIAGRAM_MODEL`, accuracy gate, `EPS`, `MATCH_TOL`, generation counts.

**Admin screen:** separate single-page app (HTML/React), Netlify, behind Supabase Auth + admin gate. List/edit config keys; every write logs to `config_audit`.

**Security:** RLS so only admins touch `runtime_config` / `config_audit`; worker uses service role to read. No anon access.

**Definition of done (the project's bar, not optional):**
- Migration runs idempotently against `rtyvomkhajyinlycgjzm`.
- Worker reads a live config value and a deleted/absent key falls back to default.
- Every config write appears in `config_audit`.
- `node --check` passes on all JS and the HTML's script blocks.
- Tester coverage for both paths: value present (used) and value absent (falls back). Plus an unhappy path (non-admin write rejected by RLS).
- Owns Orchestrator-agent log calls.

---

## 5. Backlog — CONTEXT ONLY, do not build
Specced and waiting (full detail in docs 1–3). Do not start any of these without explicit go:
- **Admin backend, later slices:** `curriculum_objects` + `curation_proposals` tables, the offline source-sweep/distill script, the human approval flow, dashboards.
- **CR-021** accuracy regression battery · **CR-022** coverage/mastery model · **CR-023** billing · **CR-024** observability · **CR-025** accessibility · **CR-026** deterministic floor · **CR-027** verified-corpus freeze + few-shot · **CR-028** provenance · **CR-029** drift alarm · **CR-030** rejection feedback loop.
- Open defects/CRs in `DEFECT_LOG.md` / `CR_LOG.md`.

---

## 6. Non-negotiable rules (this project's discipline — follow exactly)
- **Read the file before editing it.** Use the view tool every time; `str_replace` needs exact matches. Never edit from memory.
- **`node --check` before shipping any HTML/JS.** TypeScript annotations leaking into browser JS have broken the app before.
- **Log the defect before fixing it** (`DEFECT_LOG.md`), and a defect isn't closed until a Tester test covers it.
- **Never narrow-fix.** Fix the class of problem, not the one instance.
- **Prompt changes:** prompt + validation filter reviewed together, always. Teach prompts with complete worked examples, not descriptions.
- **Prompts stay in git, not the config table.** Do not make prompts DB-editable. Plain config values only.
- **Curriculum knowledge is human-gated.** No `curriculum_objects` row reaches a child without `status=approved` + a human stamp. The web never enters the tutorial path — the source sweep is offline, feeding a human, not the runtime.
- **Curriculum enumeration = maximum recall.** When that slice comes: union of N sources with provenance + year-disagreement flags, human prunes down. Never a minimal default (that silently drops topics — it already dropped factorising once).
- **File sync:** sandbox edits reach the repo by manual download/upload; Supabase MCP is the only direct-write path. Migrations go through MCP; code/HTML/prompt files are handed back for the owner to commit.
- **Update the session summary at the end.** It is the only memory between sessions.
- **Communicate outcomes, not process.** Owner prefers short, direct replies.

---

## Start here
1. Read `BrightMind_Admin_Backend_Spec.md` in full (your job's source of truth).
2. Read the current worker `index.js` and the relevant config/env handling before writing the read path.
3. Build the §4 slice. Stop at its definition of done. Do not drift into §5.
