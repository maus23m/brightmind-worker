# CLAUDE.md — BrightMind Worker

Auto-loaded every session. Project orientation and the planning docs live in
`Project Files/` — read `CLAUDE_CODE_HANDOVER.md` first; it maps the other docs
and the current job, and §6 holds the project's full non-negotiable rules.

## Rules

### Keep documentation current (always)
Treat documentation as part of every change, not an afterthought. Whenever you
change the system, update whatever docs the change touches — proactively, without
being asked:

- `Project Files/CR_LOG.md` — change requests / features (one row per CR/item).
- `Project Files/DEFECT_LOG.md` — defects: log the defect *before* fixing it, and
  a defect isn't closed until a Tester test covers it.
- `Project Files/SESSION_HANDOVER_<YYYYMMDD>.md` — write/refresh at the end of a
  session; it is the only memory between sessions.
- READMEs, inline code comments, and any spec the change makes stale.

When it's ambiguous which doc applies, update the obvious ones and **flag the
judgement call** in your reply rather than staying silent — e.g. "logged in
CR_LOG as a feature; left DEFECT_LOG untouched since no defect was involved — say
if you want a forward-reference added."
