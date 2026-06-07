# BrightMind — Links & Environments

Quick registry of the project's URLs, PRs, and how to preview/test. Keep this current
as part of any change (per CLAUDE.md). No secrets here — credentials live in Supabase /
the deploy env only.

## Apps — test & production
| What | URL | Notes |
|---|---|---|
| Admin app — preview (no deploy) | https://raw.githack.com/maus23m/brightmind-worker/main/frontend/admin.html | Serves `frontend/admin.html` from `main` as a live page; runs against Supabase directly. Swap `main` for a branch to test unmerged work. |
| Parent app — preview (no deploy) | https://raw.githack.com/maus23m/brightmind-worker/main/frontend/index.html | Same, for the parent/child app. |
| Production (Netlify) | https://brightmind-tutor.netlify.app | `/admin.html` for admin. **Netlify autodeploy is PAUSED** — production will not update on push until re-enabled / manually deployed. |
| GitHub Pages (if enabled) | https://maus23m.github.io/brightmind-worker/admin.html | Built from `main` via `.github/workflows/pages.yml`. |

Admin login: `maus23@gmail.com` (temp password set out-of-band; password reset is broken — see DEF-047).

## Backend
| What | Value |
|---|---|
| Worker repo | `maus23m/brightmind-worker` (GCP Cloud Run) |
| Supabase project | `rtyvomkhajyinlycgjzm` (brightmind-v2) |
| Edge functions | `generate-questions`, `job-status`, `run-sweep` (admin-gated curriculum sweep) |

**Run sweep:** the admin "Run sweep" button (Curriculum tab) calls the `run-sweep` Edge
Function, which reads the project-wide `ANTHROPIC_API_KEY` Supabase secret (already
configured — no setup needed). Confirmed working. The CLI sweep
(`node scripts/curriculum_sweep.js …`) uses your shell env instead.

## Pull requests
| PR | Title | State |
|---|---|---|
| #15 | Admin backend Slice 1 — runtime_config dials (+ CLAUDE.md) | merged |
| #16 | ADMIN-2 — Curriculum curation & approval | merged |
| #17 | Curriculum sweep — per-subject+year batch mode | open (from `claude/optimistic-allen-dsblK`) |

New PR for the active branch (if not yet created):
https://github.com/maus23m/brightmind-worker/compare/main...claude/optimistic-allen-dsblK?expand=1
