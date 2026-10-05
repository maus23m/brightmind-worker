# Session Handover — 21 Jun 2026

## What was done — DEF-053: "Run sweep" 404 (sweep model brought out of code into config)

**Symptom (owner screenshot):** admin "Run sweep" → `Acids & Bases: Claude 404: ... "model":"claude-sonnet-4-20250514"`.

**Root cause:** Claude Sonnet 4 (`claude-sonnet-4-20250514`) retired 15 Jun 2026 → now 404s. The
`run-sweep` Edge Function read its model from an unset `CLAUDE_MODEL` secret and fell back to that
**hardcoded** retired id. Unlike the worker (`index.js` `getConfig`), the sweep **never read
`runtime_config`**, so the admin's config-page setting (`CLAUDE_MODEL = claude-opus-4-8`, set
10 Jun) never governed it. The retired id was also hardcoded as a fallback in five files.

**Fix — the model now lives only in `runtime_config` (the admin config page):**
- `supabase/functions/run-sweep/index.ts` — removed the hardcoded model; new `resolveModel()`
  reads `runtime_config?key=eq.CLAUDE_MODEL` via the existing service-role headers and **fails
  closed** (500 "CLAUDE_MODEL not set in runtime_config — set it on the admin config page") if
  absent. No buried fallback.
- `scripts/curriculum_sweep.js`, `scripts/depth_tag_check.js` — read the same key via
  `resolveModel()` (config is source of truth; `CLAUDE_MODEL` env is an offline fallback; throws
  if neither yields a model). No model literal.
- `index.js` — keeps its single env-overridable `CONFIG_DEFAULTS` default; value updated to the
  live `claude-sonnet-4-6` (worker must not fail mid-job, so it retains its one tested default).
- `migrations/0001_admin_runtime_config.sql` — seed (config-layer default for a fresh DB) updated
  to `claude-sonnet-4-6`. Live DB already overrides to `claude-opus-4-8`; `on conflict do nothing`.
- No frontend change — `frontend/admin.html` already lists/edits every `runtime_config` key.

**Tester:** `sweep.test.js` DEF-053 block — retired id absent repo-wide; the three sweep paths
carry no model literal; edge fn + both CLIs read `runtime_config` `CLAUDE_MODEL`; edge fn fails
closed when unset; migration seeds a live default. `npm test` green.

**Deploy:** `run-sweep` Edge Function redeployed to project `rtyvomkhajyinlycgjzm` via Supabase MCP
(the function only updates in production on MCP deploy — git is the source).

**Verified:** `runtime_config.CLAUDE_MODEL = claude-opus-4-8` (live). The sweep now resolves that
value; proposal provenance (`source_run.model`) records the real model used.

## Notes
- DEF-051 (bank writes) and DEF-052 were already taken — this work is **DEF-053**.
- Design choice: the **sweep** fails closed when `CLAUDE_MODEL` is unset (literal meaning of
  "bring the fallback out into config" + project fail-closed discipline). The **worker** keeps one
  env-overridable default because it must not fail mid-pipeline.
- Branch: `claude/sweep-error-azyiiv`.
