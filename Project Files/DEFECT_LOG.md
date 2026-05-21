# BrightMind Defect Log

Last updated: 21 May 2026

## Resolved

| ID | Description | Severity | Status |
|---|---|---|---|
| DEF-001 | Sign In button does not advance to dashboard | CRITICAL | ✅ RESOLVED |
| DEF-002 | Topic checkboxes do not respond to click | CRITICAL | ✅ RESOLVED |
| DEF-003 | All data lost on page refresh | CRITICAL | ✅ RESOLVED |
| DEF-004 | Question generation hangs for 30+ seconds | CRITICAL | ✅ RESOLVED |
| DEF-005 | Cannot navigate beyond first 3 questions | CRITICAL | ✅ RESOLVED |
| DEF-006 | Saved tutorials not visible to parent | MAJOR | ✅ RESOLVED |
| DEF-007 | Timer shows numeric countdown, not a bar | MAJOR | ✅ RESOLVED |
| DEF-008 | Child selector hardcoded, not reading from stored profiles | MAJOR | ✅ RESOLVED |
| DEF-009 | App opening directly signed in without user knowing | MAJOR | ✅ RESOLVED |
| DEF-010 | Call stack crash on child login | CRITICAL | ✅ RESOLVED |
| DEF-011 | Dashboard stale cache after changes | MAJOR | ✅ RESOLVED |
| DEF-012 | Results not saving — RLS blocking | CRITICAL | ✅ RESOLVED |
| DEF-013 | Streak/badges not updating | MAJOR | ✅ RESOLVED |
| DEF-014 | Save allowed with flagged questions pending | MAJOR | ✅ RESOLVED |
| DEF-015 | Edge Function 500 after successful Claude call — prompt/validation mismatch | CRITICAL | ✅ RESOLVED |
| DEF-016 | Progress charts blank on navigation — canvas rendering timing | MAJOR | ✅ RESOLVED |
| DEF-017 | JWT token expiry causing silent write failures | CRITICAL | ✅ RESOLVED |
| DEF-018 | Bad diagram quality — JSXGraph replaced with direct Claude SVG | MAJOR | ✅ RESOLVED |
| DEF-019 | Question count less than requested — top-up Claude call added | MAJOR | ✅ RESOLVED |
| DEF-020 | Science questions used character framing — phenomenon-first rule enforced | MEDIUM | ✅ RESOLVED |
| DEF-021 | Floating battery label in electricity diagram — proper circuit SVG example added | MEDIUM | ✅ RESOLVED |
| DEF-022 | Duplicate questions in same tutorial — text dedup + exclude list on top-up | MAJOR | ✅ RESOLVED |
| DEF-023 | Hardcoded topic lists causing bare calculations — principle-based prompt | MEDIUM | ✅ RESOLVED |
| DEF-024 | Semantic near-duplicates slipping through — Audit Agent set-level diversity check | MEDIUM | ✅ RESOLVED |
| DEF-025 | Starter question buttons not firing — JSON.stringify double quotes broke onclick | MAJOR | ✅ RESOLVED |
| DEF-026 | Answer leak in diagrams — labels revealed correct answer | CRITICAL | ✅ RESOLVED |
| DEF-027 | Diagram labels not following whitelist — extra labels added by drawing agent | MAJOR | ✅ RESOLVED |
| DEF-028 | Answer leak via colour coding — correct option drawn in green | MAJOR | ✅ RESOLVED |
| DEF-029 | Diagram showed all 4 options instead of the scenario | MAJOR | ✅ RESOLVED |
| DEF-030 | Cross-parent data leak — permissive RLS policies | CRITICAL | ✅ RESOLVED (V2 auth model) |
| DEF-031 | Wrong-child data leak within same family | CRITICAL | ✅ RESOLVED (V2 auth model) |
| DEF-032 | Diagram max_tokens was 4096 causing complex SVGs to fail silently — raised to 16000 | MAJOR | ✅ RESOLVED |

## Open / In Progress

| ID | Description | Severity | Status | Owner |
|---|---|---|---|---|
| DEF-033 | Diagram-dependent questions served without diagram. When drawDiagram fails, question served with needsDiagram=true but no svg. Fix: drop question, log diagnostic, top-up fills gap. | CRITICAL | IN-TEST | Orchestrator |
| DEF-034 | Top-up questions skip audit and child agent. Stages 4 and 5 bypassed. Unaudited questions reach children. | MAJOR | OPEN | Orchestrator |
| DEF-035 | Audit agent has no diagram awareness. Receives hasDiagram boolean but never sees diagramPrompt. Cannot catch diagram-question mismatches. | MAJOR | OPEN | Reviewer |
| DEF-036 | All banked questions tagged with first topic only. q._topic never set during generation. bankWrite defaults to topics[0]. | MINOR | OPEN | Curriculum |
| DEF-037 | DIAGRAM_MAX_TOKENS env var not used. Code uses hardcoded 16000. | MINOR | OPEN | Orchestrator |
| DEF-038 | Nutrition & Digestion diagram example is decorative — labels organs but contains no question-specific data. Child cannot derive answer from diagram alone. Needs rewriting with measurable data. Same pattern may affect Cells example. | MEDIUM | OPEN | Designer |
