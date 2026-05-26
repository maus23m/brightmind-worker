# BrightMind Defect Log

Last updated: 23 May 2026

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
| DEF-039 | Diagram system prompt over-simplified. The full rule set in `diagram_system.txt` was stripped to a minimal version on the mistaken theory that the rules were degrading geometric accuracy. This was a misdiagnosis (see DEF-040). The simplification removed genuine safeguards (answer-leak whitelist enforcement, label-overlap rules). Fix: reverted `diagram_system.txt` to the full-rules version. Deployed 23 May 2026. | MAJOR | ✅ RESOLVED (DEPLOYED) |

## Open / In Progress

| ID | Description | Severity | Status | Owner |
|---|---|---|---|---|
| DEF-033 | Diagram-dependent questions served without diagram. When drawDiagram fails, question served with needsDiagram=true but no svg. Fix: drop question, log diagnostic, top-up fills gap. | CRITICAL | IN-TEST | Orchestrator |
| DEF-034 | Top-up questions skip audit and child agent. Stages 4 and 5 bypassed. Unaudited questions reach children. | MAJOR | OPEN | Orchestrator [Note 25 May 2026: the DEF-041 compute engine routes top-up questions through Stage 2 verification correctly — but DEF-034 (top-up bypassing audit + child agents) remains OPEN and is unaffected by that fix.] |
| DEF-035 | Audit agent has no diagram awareness. Receives hasDiagram boolean but never sees diagramPrompt. Cannot catch diagram-question mismatches. | MAJOR | OPEN | Reviewer |
| DEF-036 | All banked questions tagged with first topic only. q._topic never set during generation. bankWrite defaults to topics[0]. | MINOR | OPEN | Curriculum |
| DEF-037 | DIAGRAM_MAX_TOKENS env var not used. Code uses hardcoded 16000. | MINOR | OPEN | Orchestrator |
| DEF-038 | Nutrition & Digestion diagram example is decorative — labels organs but contains no question-specific data. Child cannot derive answer from diagram alone. Needs rewriting with measurable data. Same pattern may affect Cells example. | MEDIUM | OPEN | Designer |
| DEF-040 | Diagram quality gap caused by model mismatch, not prompt. The pipeline diagram stage ran on Sonnet 4 (`claude-sonnet-4-20250514`) while the test "Diagram Engine" ran on a stronger model (Opus). The two were never a controlled comparison — model was an unlogged variable, so repeated diagram defects were wrongly attributed to prompt quality. Fix: dedicated `DIAGRAM_MODEL` env var (default `claude-opus-4-7`) used only for the diagram stage; question generation, audit and child agent stay on the default model. Model string now logged on every diagram call and at job start so it can never again be an invisible variable. Deployed 23 May 2026 — Cloud Run logs confirm diagram stage running on `claude-opus-4-7`. Awaiting comprehensive visual quality check before final close. Lesson: when comparing pipeline output against a test harness, log the model on both sides. | MAJOR | DEPLOYED — awaiting visual QA | Designer |
| DEF-042 | Ambiguous select-among-the-options questions bypass the Compute Engine. Surfaced by a Year 7 number-line question "Which number is closest to 50?" options {46,48,52,55} marked 48 correct — but 48 and 52 are BOTH exactly 2 from 50: two correct answers, and the explanation ("48 is only 2 away… closer than the others") is false. ROOT CAUSE: questions whose answer is chosen by comparing the options (closest-to, largest, smallest, equal-to) are calculable but had no `op`, so the generator tagged them `verify:"none"` → audit agent → no arithmetic check (the DEF-041 class of gap). Separately, NOTHING checked for duplicate/ambiguous options on any question, including `verify:"none"` ones. CLASS of problem: any MCQ that can have more than one correct answer. FIX (26 May 2026 — broad): (1) four tie-rejecting comparison ops in `compute.js` — `closest_to`, `largest`, `smallest`, `equal_to`; each returns null (→ reject) when two options are equally correct. (2) UNIVERSAL duplicate-option guard in `computeVerify` runs on EVERY question regardless of verify type — rejects any MCQ with two numerically-equal or textually-identical options (catches non-numeric ambiguity on `verify:"none"` too). (3) answer-to-option matching rewritten to match the CLOSEST option, not the first within tolerance — fixes mis-match on closely-spaced decimals (0.6 vs 0.605); tie detection uses a tight epsilon (1e-9) separate from the answer-match tolerance (0.01). Generator updated (`prompts/question_gen.txt`): new ops + worked example + a general "no ambiguous questions / all four options distinct" rule. `index.js` unchanged — `computeVerify` already runs on the full generated array so the guard covers `verify:"none"`. TESTER: `compute_test.js` — 28 cases incl. each comparison op, each tie case, the exact DEF-042 question, numeric + text duplicate-option rejection, the decimal closest-match fix. RELATED: CR-019 logged to feed `_computeReason` free text back into top-up regeneration. | MAJOR | RESOLVED (26 May 2026) — Tester: compute_test.js |
| DEF-041 | Wrong correct-answer + wrong worked explanation in a generated question. "Daily customers… range?" data {45,38,52,41,64,78,56}; true range = 78−38 = 40. App marked correct answer as 33 with explanation "78−45=33" — used Monday's 45 as the minimum instead of Tuesday's 38. Child answered 40 (correct) and was marked wrong. ROOT CAUSE: the old Stage 2 `verify()` was not a missing check but an actively wrong one — it regex-matched the last `=number` in the explanation, treated it as truth, and overwrote `c` to match. Generator's answer and explanation shared the same slip, so making them agree cemented the error; audit/child agents never recompute arithmetic. CLASS of problem: numerical errors in any computed-answer question (range, mean, median, mode, totals, %). FIX (25 May 2026): `verify()` deleted; replaced by a deterministic Compute Engine in `compute.js` (`computeVerify`). Engine recomputes the answer from a structured `compute:{op,inputs}` block — never reads `c` or `e` — then confirms `c`, corrects `c` to the verified value, or rejects the question (fail-closed: unknown op / missing block / tied mode / answer-not-in-options all reject). Generator now emits `verify` + `compute` fields (`prompts/question_gen.txt`); `prompts/audit.txt` criteria 4 & 7 narrowed so the auditor never re-judges or overrides a compute-verified answer; `index.js` `audit()` hard-guards the same in code. Top-up questions also pass through the engine. TESTER: `compute.test.js`, 14 cases incl. the exact DEF-041 question (min not first in list) and the audit-rewrite guard — all pass. Live deploy confirmed: GCP logs show the engine correctly rejecting an unverifiable `mean` question. | CRITICAL | RESOLVED (25 May 2026) — Tester: compute.test.js | Reviewer |
