# BrightMind — Admin Backend Spec

The missing operator layer. Today the only surfaces are the parent app and raw tooling (Supabase SQL, GCP console, hand-edited prompts). This adds an **internal admin app** where *you* turn dials and *humans* approve curriculum — without touching the live app's shape and without adding any child-facing surface.

**What it is:** a second single-page app (HTML/React), Supabase-backed, admin-gated, on Netlify alongside the tutor app. Same stack you already run.
**What it is not:** a platform, a CMS, or anything a parent or child sees. Internal only.

The worker stays the runtime. The admin app is where curriculum knowledge is curated/approved and runtime config is adjusted. The worker reads both from Supabase at run time — no web access in the tutorial path.

---

## Three surfaces

### A. Curriculum curation & approval (the credible-tutor knowledge)
The human step of the offline curation tool. Sweep proposes; human disposes; approved object is frozen and versioned. This is where "knows what a real teacher knows" actually gets built and signed off.

### B. Runtime config (the dials you asked for)
Move adjustable values out of env vars / hardcoding into a Supabase config table the worker reads at run time. Change without a redeploy. **Prompts are excluded** (see guardrails).

### C. Dashboards (read-only)
Coverage matrices (CR-022), rejection rate + notes (CR-030), accuracy battery results (CR-021). Views over data you'll already have.

---

## Data model (Supabase, project `rtyvomkhajyinlycgjzm`)

### `curriculum_objects` — the frozen, versioned teacher knowledge
One approved object per (subject, topic, year, scheme). Worker reads the latest `approved` row.

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| subject | text | maths / science |
| topic | text | e.g. "Expressions and Equations" |
| year_group | int | |
| scheme | text | scheme of work the year-placement is pinned to (KS3 years aren't statutory) |
| version | int | increments per approval |
| status | text | draft / approved / archived |
| payload | jsonb | the knowledge — see below |
| approved_by | text | |
| approved_at | timestamptz | |
| created_at | timestamptz | default now() |

`payload` (jsonb):
```json
{
  "sub_strands": [
    { "id": "notation", "name": "Algebraic notation & conventions",
      "depth_bands": ["recall","procedure","application","reasoning"],
      "provenance": ["NC-KS3","AQA","WhiteRose","Bitesize"],
      "year_flag": "agreed" }
  ],
  "prerequisites": [
    { "sub_strand": "solving_equations", "requires": ["substitution","simplifying"] }
  ],
  "misconceptions": [
    { "sub_strand": "simplifying", "wrong": "5x + 3 = 8x",
      "why": "treats unlike terms as like", "correct": "5x + 3 (cannot combine)" }
  ]
}
```
Three outputs from one source sweep: **sub-strands** (width), **prerequisites** (sequencing), **misconceptions** (real-teacher feedback). All human-approved before any child sees them.

### `curation_proposals` — the sweep output awaiting review
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| subject / topic / year_group / scheme | — | target of the sweep |
| proposed_payload | jsonb | **union / maximum recall** superset, each item with provenance + year-disagreement flags |
| source_run | jsonb | which sources fetched, when |
| status | text | pending_review / approved / rejected |
| created_at | timestamptz | |

Approving a proposal writes a `curriculum_objects` row (version++, status=approved, stamped). Maximum recall in, human prunes down — never the reverse (a missing sub-strand is invisible; an extra one is one click to strike).

### `runtime_config` — the dials
| column | type | notes |
|---|---|---|
| key | text pk | e.g. PIPELINE_MODEL |
| value | jsonb | |
| value_type | text | string / number / bool / json |
| description | text | |
| updated_by | text | |
| updated_at | timestamptz | |

Safe to make DB-editable: model strings, `DIAGRAM_MODEL`, accuracy gate, tolerance constants (`EPS`, `MATCH_TOL`), generation counts, feature flags. Worker reads with a short TTL cache.

### `config_audit` — who changed what, when
Append-only log of every `runtime_config` and `curriculum_objects` change. Non-negotiable for a product serving children — every dial change is traceable.

---

## Curation review flow
1. Operator triggers a sweep for (subject, topic, year, scheme) from the admin app.
2. **Offline job** (Claude Code script — not the worker, not the hot path): fetches official sources first (gov.uk statutory PoS PDF, exam-board specs under free/OGL access), cross-checks teaching sites, distils the **union** taxonomy + prerequisites + misconceptions with provenance → writes a `curation_proposals` row. Runs rarely (curriculum changes ~yearly).
3. Operator/specialist opens the proposal: superset shown, each item with its sources and any year-placement disagreement flagged. Prune, edit, add.
4. **Approve** → frozen as a versioned `curriculum_objects` row, stamped with approver.
5. Worker reads the approved object at tutorial-set time. Fast local lookup, zero web, zero added trust surface.

The sweep is a *sourcing step for the human*, never an autonomous stage. The web informs the specialist; the specialist's approved object informs the child.

---

## Security
- Admin app behind Supabase Auth; `admin_users` table or `is_admin` claim.
- RLS: only admins read/write `curriculum_objects`, `curation_proposals`, `runtime_config`, `config_audit`.
- Worker uses the service role to read `runtime_config` + approved `curriculum_objects`.
- No anon access to any admin table.

---

## Guardrails
- **Prompts stay in git, not the config table.** Live-editable prompts would break the prompt-change rule (prompt + validation reviewed together) and git discipline. If prompts ever move to the DB, they must stay versioned with the paired-review step — never a free-text box. Plain config values are safe; prompts are not.
- **No curriculum object reaches a child unapproved.** `status=approved` + a human stamp is the gate. Draft/proposal data is admin-only.
- **Internal only.** Nothing here renders in the parent or child app.

---

## Build order
**Claude Code can build:** the admin SPA, all four table schemas (via `apply_migration`, idempotent `ADD COLUMN IF NOT EXISTS`), the worker's config read + cache, the offline sweep/distill script, the read-only dashboards.
**Human must do:** approve every curriculum object (the specialist's curation judgement) — the one step the tool exists to capture, and the one Claude Code cannot supply.

**Suggested first slice:** `runtime_config` + `config_audit` + worker read + a minimal config screen. Smallest, immediately useful (dials without redeploys), and proves the admin-app + RLS pattern before the heavier curation flow.
