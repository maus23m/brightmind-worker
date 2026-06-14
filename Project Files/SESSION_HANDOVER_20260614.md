# Session Handover — 14 June 2026

## What was done

### DEF-052 — Angle-diagram quality regression (MAJOR, Designer)

Owner reported "diagram generation has deteriorated" with two live "Set a Tutorial"
screenshots, both on the **Angles on a straight line** sub-strand:

- Q1 "Two angles on a straight line are 117° and x°" — ray inclination matched neither
  value; the given `117°` arc looked acute while the `x` (=63°) arc looped larger
  (relative sizes inverted).
- Q4 "One angle is 65° and the other is x°" — the `65°` arc sat detached far from the
  vertex, a second arc hugged the vertex, the ray was ~45°. A child couldn't tell which
  arc was which.

**Root cause:** the **DEF-045 class generalised to angles.** Both prompts teach geometry
by worked example, but the examples only covered sectors/quarter-circles and
right-angled triangles — there was no rule and no worked example for the most common
case (two rays at a vertex with an arc marking the angle). The drawing agent invented
the degree→geometry mapping, producing detached arcs, mismatched arc sizes, arbitrary
ray angles. The generator's only angle example (bookshelf/72°) described a scenario but
never required the ray be drawn at the known angle's true inclination, the arc be
centred on the vertex, or the unknown be shown as `x`.

**Fix (prompt-only — `drawDiagram` passes the system prompt through unchanged):**

1. `prompts/diagram_system.txt` — new **ANGLES rule** (arc centred EXACTLY on the
   vertex, ~40-55px; rays drawn to TRUE inclination via cos/sin so the drawn opening
   matches its label; each shared-vertex angle its own distinct-colour arc of comparable
   radius; label on the bisector just outside the arc; KNOWN angle labelled with its
   value, UNKNOWN labelled exactly as given e.g. `x`, never computed/revealed) + a
   complete **WORKED SVG EXAMPLE** (angles on a straight line: horizontal line through a
   vertex dot, ray at a true 130° inclination, obtuse arc `130°` + acute arc `x`, both
   centred on the vertex). Coordinates derived with trig; both arc centres verified to
   land exactly on the vertex via the W3C endpoint-arc algorithm; rendered to PNG and
   eyeballed (clean obtuse/acute contrast, no leak).

2. `prompts/question_gen.txt` — rule #10 (GEOMETRY LINES) extended with an **ANGLES
   clause** + a GOOD "angles on a straight line" diagramPrompt example (the exact live
   failing topic; unknown shown as `x`, value never stated → answer-leak guard,
   DEF-026/028 class).

3. `prompts.test.js` — block 13, **15 structural assertions** (gen ANGLES clause + GOOD
   example + unknown-as-x; draw ANGLES rule + true-inclination + worked SVG with ≥2 arc
   commands, vertex dot, 800×600 viewBox, `130°` label, and a no-leak guard that the SVG
   shows `x` and never the computed 50°).

**Tests:** full `npm test` green (compute 33 + review + prompts 72 + config 16 +
curriculum 45 + sweep 37 + coverage 36). `node --check` clean. (Note: this fresh
container had no `node_modules`; ran `npm install` once so config/curriculum/sweep/
coverage suites — which load `index.js` — could run.)

**Status:** FIXED — **awaiting visual QA**. Live end-to-end generation is not runnable
here (no `ANTHROPIC_API_KEY` in the container). Before final close, a real
Angles-on-a-straight-line tutorial should be generated and eyeballed post-deploy, same
discipline as DEF-040.

## Files touched

- `prompts/diagram_system.txt` — ANGLES rule + worked angle SVG
- `prompts/question_gen.txt` — rule #10 ANGLES clause + GOOD angle example
- `prompts.test.js` — DEF-052 assertion block (block 13)
- `Project Files/DEFECT_LOG.md` — DEF-052 entry
- `Project Files/SESSION_HANDOVER_20260614.md` — this file

## Branch

`claude/diagram-generation-issue-24nozf` — committed and pushed. No PR (not requested).

## Next session

- Eyeball a live Angles tutorial after deploy; if good, flip DEF-052 to RESOLVED.
- DEF-040 is in the same awaiting-visual-QA state — both can be confirmed together.
