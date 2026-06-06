# BrightMind — Pre-Launch Spec

Governing rule: **a child sees nothing until its correctness is provable and we are legally cleared to hold their data.** Everything else is sequenced behind those two gates. New features are frozen until Phase 0 + Phase 1 close.

Phases are gates, not a calendar. A phase does not start until the one before it closes, except the Legal track (Phase 1) which runs in parallel from day one because it has external lead time.

Sizing: S = hours, M = a few days, L = a week+. No dates — these are gates.

---

## Phase 0 — Trust gates (BLOCKER)
No real child, no payment, until every item here is closed with Tester coverage.

| ID | Item | Owner agent | Size | Done means |
|---|---|---|---|---|
| DEF-034 | Top-up questions skip audit + child agent | Orchestrator | M | Top-up batch routed through Stages 4–5 identically to the main batch. Tester: a forced top-up question is shown to have audit + child verdicts attached. |
| CR-017 | Legacy `question_bank` rows never verified | Curriculum | M | Migration recompute-verifies every calculable row; mismatches deleted or corrected. Until migration runs, Stage 0 `adaptBank` is disabled so no unverified bank question is served. Tester: a known-bad legacy row is caught and removed by the migration. |
| DEF-033 | Diagram-dependent question served with no SVG | Orchestrator | S | Confirm IN-TEST fix closed: failed draw → question dropped + logged + top-up refills. Tester: forced draw failure never yields a `needsDiagram:true` question with null svg. |
| CR-015 | `divide` op + `equation_balance` verifier | Curriculum | M | Speed/density route through the compute engine, not audit. Atom-conservation check verifies balancing questions. Tester: division + balancing regression cases. Feeds CR-021 Layer 1. |
| **CR-021** | **Curriculum accuracy regression battery** | Tester + Curriculum | L | The core missing piece. See detail below. Done = a numeric, repeatable accuracy report runs on every deploy. |

### CR-021 detail — layered verification (the proof, not the vibe)
Principle: **independence over consistency.** No verdict may depend only on Claude judging Claude.

- **Layer 1 — deterministic code (runs on 100%, free).** Compute engine (post-CR-015), schema validity, exactly-one-correct, no duplicate options, answer absent from diagram label whitelist. Maximise what lives here.
- **Layer 2 — golden set (anchor of truth).** A teacher curates a frozen, human-verified question+answer bank, one set per sub-strand. Pipeline runs against it every deploy → `% answer-correct on golden set`. Built once, reused forever.
- **Layer 3 — model-as-judge (triage, not proof).** Separate adversarial Claude call ("find the error"), graded to a rubric. Trusted only as far as its measured precision/recall **against the golden set**, tracked for drift.
- **Layer 4 — human sample (targeted).** Stratified random sample across topic × depth, teacher-reviewed. Yields a population error rate with a confidence interval. Used where Layers 1–3 disagree — never as a blanket pass.

CI job (Tester-owned, every deploy) emits: % deterministically verified, % matching golden, judge-flag count, judge-vs-golden calibration trend, sampled error rate + CI.

**The launch number is the sampled error rate with its confidence interval.** That is the defensible claim.

Note: CR-021 reuses the **same sub-strand × depth taxonomy** as CR-022. One taxonomy, two uses (test targeting + parent mastery).

---

## Phase 1 — Legal / compliance track (BLOCKER, runs parallel from day 1)
Non-code. Has external lead time — start now or it sets the launch date by default. Not a five-agent item; this is founder + external review.

- [ ] UK GDPR + Children's Code (Age Appropriate Design Code) assessment for an under-18 product
- [ ] Privacy policy + Terms of Service
- [ ] Verifiable parental consent flow (consent is a product feature, not just a document — Orchestrator owns the flow once requirements are set)
- [ ] Data retention policy + right-to-deletion mechanism
- [ ] Safeguarding review of every free-text surface (parent rejection notes; any child-facing free text)

---

## Phase 2 — Sellable + honest product (gated behind Phase 0)

| ID | Item | Owner agent | Size | Done means |
|---|---|---|---|---|
| **CR-023** | Billing / subscription | Orchestrator | L | Plan selection, payment, entitlement gating on tutorial generation. Tester: unpaid account cannot generate. |
| **CR-022** | Depth/width coverage + mastery model | Curriculum + Designer + Orchestrator | L | See detail below. Replaces single-score mastery with a coverage grid + parent recommendation. |

### CR-022 detail — mastery = coverage × performance × depth
- **Curriculum**: on demand, enumerate sub-strands of a topic at a year group (principle-based — **not** a hardcoded list per the existing design rule). Tag each question to a (sub-strand, depth) cell. Depth bands: recall → procedure → application → reasoning.
- **Designer**: generation prompt spreads questions across sub-strands and returns `subStrand` + `depth` per question. Paired audit-validation review (prompt-change rule).
- **Orchestrator**: accumulate per-child coverage matrix; drive the parent recommendation ("volume + compound measures untested; 2 more tutorials before mastery — difficulty alone won't close these").
- Bank questions carry the same tags → top-up can fill a **width** gap, not just a count shortfall.
- **Drive, not just measure (width adaptivity).** The existing engine already adapts *depth* (easy→hard on past performance); there is no equivalent driver for *width*. Feed the child's current coverage matrix back into the generation prompt as a constraint — "these cells are untested/weak, target them" — so the next tutorial steers toward uncovered cells the way difficulty already adapts to performance. Without this, a parent can keep setting tutorials and the generator can keep re-covering the same few sub-strands harder. Same matrix that *reports* coverage also *steers* generation.
- Tester: a child with one 100% tutorial shows untested cells, not "mastered." Tester: given a matrix with known gaps, the next generated set targets the gap cells.

---

## Phase 3 — Polish (gated behind Phase 2)

| ID | Item | Owner | Size |
|---|---|---|---|
| DEF-040 | Diagram visual QA close (Opus deploy already live) | Designer | M |
| DEF-035 | Audit agent diagram-aware (sees diagramPrompt) | Reviewer | M |
| DEF-038 | Nutrition/Cells examples decorative — rewrite with derivable data | Designer | S |
| **CR-024** | Production observability — alert when a wrong answer or failed verdict ships | Orchestrator | M |
| **CR-025** | Accessibility — contrast, screen reader, dyslexia-friendly option | Designer | M |
| DEF-037 / CR-016 / CR-018 | Cost + latency: honour `DIAGRAM_MAX_TOKENS`; merge audit+child call; clean-dividing inputs | Orchestrator / Designer | M |

---

## Trust flywheel — Claude Code CRs (the IXL defense)
The defense against "why trust generated questions over a verified bank" is not one feature — it is an asset that compounds. These are all Claude-Code-buildable. Overlap with CR-015 / CR-021 / CR-024 / CR-019 / CR-020 is intentional; pick per appetite. The one piece Claude Code **cannot** supply is the human golden set + curriculum sign-off (B-list) — without it CR-021 is model grading model, not proof.

| ID | Item | Owner agent | Size | Done means | Overlaps |
|---|---|---|---|---|---|
| **CR-026** | Deterministic floor expansion | Curriculum | M | `compute.js` covers every calculable type — divide, equation balance, percentage/ratio, area/volume, unit conversion, speed/density. Target: maximise % of served questions verified by code, not model. Report that % as the headline trust metric. Tester: a regression case per type. | CR-015 |
| **CR-027** | Verified-corpus freeze pipeline + few-shot loop | Curriculum + Designer | L | Every question clearing all layers + audit is frozen into a verified corpus with its full verdict trail and (sub-strand, depth) tags. Verified examples retrieved back into the generator as few-shot seeds. Closes the loop: better seeds → higher pass rate → bigger corpus. The endgame asset = a verified bank, but self-growing and child-tuned. Tester: a frozen question carries complete provenance; retrieval returns tag-matched verified examples. | CR-021, DEF-036 |
| **CR-028** | Per-question provenance ("receipts") | Orchestrator | M | Every served question records which layers verified it, both model strings, and all verdicts. A "why we trust this" view exposes the trail. Doubles as half the compliance/safeguarding story. Tester: every served question has a non-empty verdict trail; missing trail blocks serving. | CR-024 |
| **CR-029** | Drift alarm | Tester | S | Battery runs every deploy; alert on accuracy drop vs last green. Catches the DEF-041 class before it ships, not after a child sees it. Tester: a seeded accuracy regression trips the alarm. | CR-021, CR-024 |
| **CR-030** | Rejection feedback loop | Orchestrator + Designer | M | Parent rejections (CR-019/020 `note` data) surface on the QA dashboard as a real-world error sample; rejection-rate trend tracked as a trust metric; verbatim notes fed back as generator constraints. Every real child becomes a continuous, no-cost QA panel. Tester: a logged rejection appears in the dashboard sample and its reason reaches the next `buildPrompt` FEEDBACK block. | CR-019, CR-020 |

Compounding effect: CR-021's error number falls as CR-027's corpus grows; CR-030 keeps it honest against real children; CR-026 raises the deterministic share that needs no model trust at all. Trust becomes a measured, rising line — the thing IXL's static bank cannot show changing.

---

## Explicitly deferred (real, premature)
CR-010 (question ratio), CR-012 (empty dashboard sections), DEF-036 (bank topic tagging), the SVG fine-tuning vision, diagram perfection past "a 13-year-old understands it immediately."

---

## Narrow the launch, not the vision
Do not prove correctness and compliance across the whole curriculum at once.

- **Launch surface:** pick 1–2 year groups and a handful of topics. The golden set (CR-021 L2) and the legal review only need to cover what ships first.
- The engine already scales. Trust and compliance do not have to start broad — widen after the narrow surface is proven correct and cleared.

## What to do solo vs. hand off
- **You:** all engineering phases.
- **Hand off (not coding, will stall you):** golden-set curation → a curriculum specialist; Phase 1 → a privacy review. Being your own teacher and lawyer is the solo-founder failure mode, not the architecture.
