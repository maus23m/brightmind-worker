# Session Handover — 26 Jun 2026

## What was done — DEF-054: wrong correct-answer on money "which coins make Xp" questions

**Symptom (owner screenshot, Year-2 money tutorial):**
- **Q7** "Five 2p coins make 10p. Which other coins make 10p?" — child answered **"5p + 5p"**
  (= 10p, correct) and was marked **WRONG**; the app's stated correct answer was **"10p + 10p"**
  (= 20p). The explanation ("5 + 5 = 10p, the same amount made a different way") justified the
  child's option while `c` pointed at a different, wrong one.
- **Q6** "Which set of coins also makes 50p?" — marked answer "Only one 50p coin can make 50p"
  (false), contradicted by its own explanation "20 + 20 + 10 = 50p". Same class.

**Root cause.** Coin/money "which coins make / total / also make Xp" questions are deterministically
calculable, but each **option is a sum of several coins**, not a single number — `compute.js`
`optionValue` reads only the first number in an option, so the existing `equal_to` op can't be used.
The generator therefore tagged these `verify:"none"`, which **skips the deterministic Compute
Engine** and leaves answer correctness to the probabilistic audit/child agents, which never
recompute. The mis-indexed `c` reached the child. This is the **DEF-041/DEF-042 class** (computed /
select-among-options MCQs bypassing the engine) extended to multi-coin money options — exactly the
"more prompting won't fix it; make it deterministic" pattern the owner flagged.

**Fix — new deterministic op `coin_match` (mirrors DEF-041/042):**
- `compute.js` — `verifyCoinMatch(q, cb)` + branch in `computeVerify`. Block shape
  `{"op":"coin_match","target":<amount in pence>}` (NO inputs array). New helper `optionPenceTotal`
  parses the money tokens of **each displayed option** (`£X`→×100p, `Np`→Np, summed) and the op
  finds the single option whose total equals `target`, then confirms / corrects / rejects `c`. It
  verifies the option text the child actually sees — never the model's `c`/`e`. **Fail-closed:** an
  option with no parseable money token, zero matches, or ≥2 matches → reject (dropped + topped up);
  this also blocks the Q6 prose-option trap. `optionPenceTotal` exported for testing.
- `index.js` — **no change.** The generate-filter already routes `verify:"arithmetic"`+`compute` to
  the engine; `coin_match` sets `_computeVerified`/`_computeCorrected`, so `review.js` surfaces
  `computeVerified:true` and the auditor (criteria 4 & 7) does not re-judge it.
- `prompts/question_gen.txt` — `coin_match` op doc in the single-op list + a **GOOD** worked example
  (the corrected Q7) and a **BAD** example (the exact live failure) per "teach with examples".
- `prompts/review.txt` — **no change needed** (criteria 4 & 7 are generic over `computeVerified`).

**Tester:** `compute.test.js` DEF-054 block — money-parser unit cases (incl. mixed `£`/`p`,
`£1.50`, prose "a 5p, a 2p and a 1p", and the no-token→null case); the exact Q7 c-correction; the
happy path (already-correct `c` verified, unchanged); and four reject paths (two-match ambiguous,
no-match, no-token fail-closed, missing-target). `node --check` clean on `compute.js`/`index.js`;
full `npm test` green (87 compute assertions + all other suites).

## Notes
- This is a **defect fix**, allowed despite the admin-backend CR pause (CRITICAL — a child was
  penalised for a correct answer).
- **Not deployed from here.** Pure code + prompts, no DB migration. Branch
  `claude/answer-incorrectness-defect-3clf9l`, pushed. Worker change reaches production only on the
  owner's Cloud Run deploy.
- Out of scope (logged, not built): the same parse-options-and-match-target pattern could extend to
  other equivalence MCQs (equivalent fractions, equivalent expressions) — separate parser, deferred.
