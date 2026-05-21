# BrightMind V2 Session Handover — 21 May 2026

## What Was Done This Session

### Diagram Prompt Gap (Main Task)
- **Root cause identified**: Only 7 of 14 diagram topics had worked examples in `question_gen.txt`. The question generator wrote poor `diagramPrompt` values for topics without examples because it had no reference.
- **8 new examples written** for: Circles, 3D Shapes, Pythagoras & Trig, Cells & Organisation, Nutrition & Digestion, Atoms & Elements, Forces & Motion, Waves & Sound.
- **7 validated via test engine artifact** — all produced correct, child-readable SVGs on first generation. Forces & Motion had an arrow direction issue (stochastic variance, not prompt).
- **1 excluded (DEF-038)**: Nutrition & Digestion example is decorative — labels parts but contains no question-answerable data. Needs rewriting with specific measurable data.
- **Updated `question_gen.txt`** delivered — now has 14 GOOD examples (was 7). File ready in `prompts/` directory.

### Diagram System Prompt
- **Label overlap rule added** to `diagram_system.txt`: "When placing multiple labels along one edge, check total text width against available space. If labels would overlap, rotate them 45 degrees, or stack them on two rows alternating up/down, or abbreviate."
- Triggered by shop till diagram where 7 coin section labels overlapped.

### DEF-033 Fix (Critical)
- **Problem**: Questions requiring diagrams were served without diagrams when `drawDiagram` failed.
- **Fix**: Drop the question instead of pushing it through. Top-up fills the gap.
- **Diagnostic logging added**: Logs the `diagramPrompt` sent, what came back (truncated raw response), and why it failed.
- **Updated `index.js`** delivered. Status: IN-TEST.

### Cosmetic CRs (V2.13)
- CR-001: Mobile nav — horizontal scroll ✅
- CR-002: Retake attempt count ✅
- CR-003: Difficulty badge on results ✅
- CR-004: Tutorial numbering for same topic ✅
- CR-005: Undefined avatar fix ✅
- CR-011: Oxford×Cambridge text removed ✅

### Deployment
- V2.13 deployed to Netlify via GitHub repo (`brightmind-worker/frontend/index.html`).
- Netlify site now linked to GitHub — push to `main` auto-deploys.

---

## Files Delivered This Session

| File | Purpose | Deploy To |
|---|---|---|
| `question_gen.txt` | Updated prompt with 14 diagram examples | `prompts/` in brightmind-worker repo |
| `diagram_system.txt` | Updated with label overlap rule | `prompts/` in brightmind-worker repo |
| `index.js` | DEF-033 fix + diagnostic logging | Root of brightmind-worker repo |
| `BrightMind_Tutor_App_V2__13_.html` | Frontend with 6 CRs applied | `frontend/index.html` in repo ✅ Deployed |

---

## Open Defects (Priority Order)

| ID | Severity | Summary |
|---|---|---|
| DEF-033 | CRITICAL | Diagramless questions served — fix delivered, IN-TEST |
| DEF-034 | MAJOR | Top-up skips audit and child agent |
| DEF-035 | MAJOR | Audit agent has no diagram awareness |
| DEF-036 | MINOR | Bank questions all tagged with first topic |
| DEF-037 | MINOR | DIAGRAM_MAX_TOKENS env var unused |
| DEF-038 | MEDIUM | Nutrition & Digestion diagram example is decorative |

## Open CRs

| ID | Severity | Summary |
|---|---|---|
| CR-006 | MEDIUM | No loading indicators on buttons |
| CR-007 | MEDIUM | Tutorial generation lost on navigate away |
| CR-008 | MEDIUM | Child selection on tutorial setup Step 1 |
| CR-009 | LOW | Tutorial completion count on topic selection |
| CR-010 | LOW | Question ratio for multi-topic |
| CR-012 | LOW | Empty dashboard sections on mobile |
| CR-013 | LOW | Topic Mastery tile click → filtered results |
| CR-014 | LOW | Streak Calendar date click → filtered results |

---

## Security Debt

- `qual=true` anon RLS policies on tutorials/results/streaks for child access (children have no JWT — they use parent's session indirectly). This is the V2 security gap that needs resolving before public launch.

---

## Architecture Notes

- **Frontend**: Single HTML file (`frontend/index.html`), deployed via Netlify from GitHub.
- **Worker**: GCP Cloud Function (`index.js`), prompts in `prompts/` directory as `.txt` files.
- **Database**: Supabase (project `rtyvomkhajyinlycgjzm`, eu-west-1).
- **Diagram engine**: Claude SVG via Anthropic API. System prompt in `diagram_system.txt`, user prompt template in `diagram_user.txt`.
- **Pipeline**: Bank → Generate (text only) → Verify → Draw Diagrams → Audit → Child Agent → Bank Write.

---

## Key Principles (Carry Forward)

1. **Don't break what works** — test new examples before merging into production prompts.
2. **Fix the class, not the instance** — label overlap rule applies to all diagrams, not just the shop till.
3. **Show, don't describe** — worked SVG examples in prompts, not text descriptions of what good looks like.
4. **Prompt + validation coupling** — any prompt change requires validation review.
5. **Diagram is evidence** — the child must be able to answer the question from the diagram alone. Decorative diagrams are defects.
6. **Read the file, don't remember it** — every session starts by reading project files, not relying on memory.
