# BrightMind V2 Session Handover — 5 June 2026

Branch: `claude/brave-cori-Bk2rj` (worker repo `maus23m/brightmind-worker`).
Worked the 5 Jun 2026 review handover (4 tasks). All on the worker side; no frontend change.

## What Was Done This Session

### 1. CR-021 / CR-021a REVERTED — Stage 3.5 diagram reviewer pulled in full
- The vision-based diagram evaluator never worked in prod: every diagram logged
  `[DiagramReview] Error (keeping original): Claude 400 … image.source.base64: invalid base64 data`.
  It failed OPEN, so it corrected nothing — just added a failing Opus call + latency per diagram.
- Wrong design anyway: it existed to compensate for Stage 3 being deliberately blind to the
  question/answer. The real fix is the draw prompt (see task 3 / DEF-045), not a second agent.
- Removed: `diagram_review.js`, `diagram_review.test.js`, `scripts/render_check.js`,
  `prompts/diagram_review_{system,user}.txt`, vendored `assets/DejaVuSans*.ttf`, the
  `@resvg/resvg-wasm` dependency, the Dockerfile `render_check` line, and all Stage 3.5 wiring
  (`evaluateDiagram(s)` / `ensureRasterizer` / `renderSvgToPng` / `DIAGRAM_REVIEW_ENABLED`) in
  `index.js` on BOTH the main and top-up paths. `diagram_review.test.js` dropped from `npm test`.
- `callClaude` kept its generic multi-turn message-array support (provider-general, harmless); only
  the image/CR-021 wording was removed. CR-016 (audit+child merge) untouched.
- `DIAGRAM_REVIEW_ENABLED` may remain set to `false` in Cloud Run harmlessly — code no longer reads it.

### 2. De-hardcoded model token caps (closes DEF-037)
- `index.js`: `MAX_TOKENS = Number(process.env.MAX_TOKENS) || 8000` and
  `DIAGRAM_MAX_TOKENS = Number(process.env.DIAGRAM_MAX_TOKENS) || 16000`.
- `callClaude` defaults to `MAX_TOKENS`; the diagram stage passes `DIAGRAM_MAX_TOKENS` (the old
  hardcoded `16000` literal is gone). Job-start log now prints `maxTok=… diagMaxTok=…` alongside
  the models (DEF-040 discipline: log every resolved variable).
- Fallbacks equal the previous values, so nothing changes on deploy unless a var is set to override.
- Text-model env key stays `CLAUDE_MODEL` (NOT `TEXT_MODEL`) — unchanged, avoids the DEF-040 trap.

### 3. Diagram draw-prompt class fix (DEF-045) — the real diagram-quality work
- Root cause of the wrong quarter-circle: the generated `diagramPrompt` said "Show the radius line
  from the corner to the curved edge" — a singular "radius line" that reads as a DIAGONAL.
- `prompts/question_gen.txt`: new CRITICAL rule #10 (GEOMETRY LINES — describe each line by ROLE +
  the two points it joins; name each of a shape's same-type lines separately; mark right angles),
  a correct quarter-circle GOOD diagramPrompt example (two radii along the straight edges meeting at
  a right angle, arc joining their far ends, right-angle square), and the failing prompt recorded as
  a BAD example.
- `prompts/diagram_system.txt`: GEOMETRY rule + a complete WORKED SVG EXAMPLE of a quarter circle
  (two perpendicular radii, arc, right-angle marker, one label per radius) — "show, don't describe".
- Class fix, not a one-off: the rule + worked SVG cover all geometry topics (Angles & Lines,
  Shapes & Area, Circles, Pythagoras & Trig, 3D Shapes).

### 4. Tests + logs
- New `prompts.test.js` (15 structural assertions on the geometry guidance + worked SVG shape),
  wired into `npm test`. `npm test` = compute (70) + review (28) + prompts (15), all green.
  `node --check index.js` clean.
- `CR_LOG.md`: CR-021 + CR-021a marked REVERTED with the base64-failure + wrong-design reasons.
- `DEFECT_LOG.md`: DEF-037 marked RESOLVED; new DEF-045 logged (RESOLVED) for the draw-prompt fault.

## Files Touched This Session

| File | Change |
|---|---|
| `index.js` | Stage 3.5 removed (main + top-up); MAX_TOKENS / DIAGRAM_MAX_TOKENS env-driven; job-start log extended; callClaude comment cleaned |
| `package.json` | dropped `@resvg/resvg-wasm`; test script now compute + review + prompts |
| `Dockerfile` | removed `RUN node scripts/render_check.js` (+ comment) |
| `prompts/question_gen.txt` | GEOMETRY LINES rule #10, quarter-circle GOOD + BAD examples |
| `prompts/diagram_system.txt` | GEOMETRY rule + worked quarter-circle SVG example |
| `prompts.test.js` | NEW — structural assertions for the draw-prompt fix |
| deleted | `diagram_review.js`, `diagram_review.test.js`, `scripts/render_check.js`, `prompts/diagram_review_{system,user}.txt`, `assets/DejaVuSans*.ttf` |
| `Project Files/CR_LOG.md`, `DEFECT_LOG.md` | logs updated as above |

## Deploy Notes
- Nothing new must be set to deploy — the four model/token vars all have fallbacks equal to current
  values. Set a var only to OVERRIDE (e.g. raise diagram tokens without a code change).
- To version-control overrides, prefer a deploy flag that MERGES (does not wipe secrets):
  `gcloud run deploy brightmind-worker --region europe-west1 --update-env-vars DIAGRAM_MAX_TOKENS=16000,MAX_TOKENS=8000`
  Use `--update-env-vars` (merge), NOT `--set-env-vars` (replaces the whole set → would wipe
  ANTHROPIC_API_KEY etc.). Leave the secrets as secrets.
- Cloud Run env keys after this: `CLAUDE_MODEL`, `DIAGRAM_MODEL`, `MAX_TOKENS`, `DIAGRAM_MAX_TOKENS`
  (+ existing `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GCP_PROJECT`).

## Still Open (carried forward)
- DEF-033 (IN-TEST), DEF-034 (top-up skips audit/child), DEF-035 (audit has no diagram awareness),
  DEF-036 (bank rows tagged with first topic only), DEF-038 (decorative Nutrition diagram),
  DEF-043 (coordinate answer-leak, IN-TEST), DEF-044 (empty-pipeline terminal branch, IN-TEST).
- CR-010, CR-012, CR-017 (bank cleanup migration), CR-018.

## Key Principles (carry forward)
1. Fix the class, not the instance — geometry rule + worked SVG cover all geometry topics.
2. Show, don't describe — worked SVG examples in prompts, not text descriptions.
3. Log every resolved variable (model AND token caps) at job start — never an invisible variable (DEF-040).
4. Read the file, don't remember it — re-grep before editing; `node --check` every JS file.
