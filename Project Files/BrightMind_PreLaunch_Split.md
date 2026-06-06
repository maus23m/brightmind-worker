# BrightMind — Pre-Launch, Split by Executor

Same work as the phased spec, re-cut by **who does it**. Phase gating still holds (Phase 0 + Legal block launch). Where an item needs both, it appears in both lists with the dependency named.

---

## A. Claude Code can do (agentic, in-repo)
Code, migrations, prompts, tests, CI. All shippable without leaving the repo.

| ID | Item | Notes / dependency |
|---|---|---|
| DEF-034 | Route top-up through audit + child agent | Pure code + Tester. No human input. |
| DEF-033 | Confirm diagram-fail → drop + top-up closed | Code + Tester regression. |
| CR-015 | `divide` op + `equation_balance` verifier | Code + Tester. Feeds CR-021 Layer 1. |
| CR-017 | Bank cleanup migration (recompute-verify, delete/correct) | Code + Supabase MCP. **Needs human confirm:** nothing writes to `question_bank` outside the pipeline (decides one-off vs ongoing). |
| CR-021 L1 | Deterministic checks: schema, one-correct, no dupes, answer-not-in-label | Pure code, runs on 100%. |
| CR-021 L3 | Model-as-judge harness (adversarial, rubric-graded) | Code. **Calibrated against** the human golden set (B). |
| CR-021 CI | Battery wiring + accuracy dashboard | Tester-owned CI job. Consumes B + L4 inputs. |
| CR-022 | Mastery model: tagging, prompt spread, coverage matrix, recommendation logic | Code + paired prompt/audit review. **Needs human sign-off** on the sub-strand taxonomy (B). |
| CR-023 | Billing integration | Code. **Blocked on human:** payment provider account, pricing, ToS. |
| CR-024 | Production observability + wrong-answer alerting | Code. |
| CR-025 | Accessibility: contrast, screen reader, dyslexia option | Code. |
| DEF-035 | Audit agent sees `diagramPrompt` | Code. |
| DEF-038 | Rewrite Nutrition/Cells examples with derivable data | Prompt. |
| DEF-037 / CR-016 / CR-018 | Honour `DIAGRAM_MAX_TOKENS`; merge audit+child call; clean-dividing inputs | Code + prompt. |

Claude Code can also **draft** the human-track artifacts (privacy policy, consent copy, golden-set candidate questions) — but those are drafts for human verification, not done items.

---

## B. Human must do (judgement, authority, external)
Cannot be delegated to the model. These are the real launch gates.

| Item | Who | Why it can't be Claude Code |
|---|---|---|
| **Golden set curation** (CR-021 L2) | Curriculum specialist | Someone with authority must declare "this question + answer is correct and on-curriculum." That's the anchor of truth the whole battery calibrates against. Claude can generate candidates; a human must verify them. |
| **Sub-strand taxonomy sign-off** (CR-021 / CR-022) | Curriculum specialist | Claude enumerates sub-strands principle-based; a human confirms the breakdown of each topic is actually right for the year group. |
| **Layer-4 sample review** (CR-021) | Teacher | The error-rate-with-confidence-interval — your launch number — requires human-judged samples. |
| **Diagram visual QA** (DEF-040) | Human, ideally real children | "Would a 13-year-old understand this without the question?" is human judgement. The model fix is deployed; the sign-off is not code. |
| **UK GDPR + Children's Code assessment** (Phase 1) | Privacy/legal | Legal authority. Has external lead time — start now. |
| **Privacy policy + ToS** | Legal | Claude drafts; a human owns the legal text. |
| **Parental consent requirements** | Legal → then Orchestrator builds | Legal defines what valid consent is; Claude Code builds the flow to spec. |
| **Data retention + deletion policy** | Legal → then code | Same: policy is human, mechanism is code. |
| **Safeguarding review** of free-text surfaces | Human | Risk judgement. |
| **Payment provider + pricing** (CR-023) | Founder | Business account, pricing model, merchant setup. Claude builds against the decision. |
| **Launch surface decision** | Founder | Which 1–2 year groups + topics ship first. Scopes B's golden set and legal review. |

---

## The handoffs that matter
1. **Launch surface (B) → everything.** Decide it first; it scopes the golden set and the legal review so neither starts broad.
2. **Golden set (B) → CR-021 (A).** The battery is built by Claude Code but is worthless until the human anchor exists. Build the harness in parallel; it goes live when the golden set lands.
3. **Legal (B) → consent/retention code (A).** Code waits on the policy definition.
4. **Pricing (B) → billing (A).** Same pattern.

Get the curriculum specialist and privacy review moving now (B). Claude Code can clear most of Phase 0 (A) in the meantime.
