# CLAUDE.md — BrightMind Worker

Auto-loaded every session. This is the standing rulebook. Detailed orientation and
the current job live in `Project Files/` — read `CLAUDE_CODE_HANDOVER.md` first; it
maps the other docs and the active work.

Each rule below is **RULE / WHEN / CHECK**. Follow them every session.

---

## Orientation

**RULE: Read the project files before doing anything in a new session.**
WHEN: At the start of every conversation, before writing code or making a suggestion.
CHECK: Have I read `Project Files/CLAUDE_CODE_HANDOVER.md` and the latest
`Project Files/SESSION_HANDOVER_<YYYYMMDD>.md` this session? Memory drifts between
sessions — the files are the truth. If I'm recalling code from memory, I'm guessing;
read the actual file instead.

---

## Architecture (five-agent framework)

**RULE: Every feature belongs to one agent. No code outside the five-agent framework.**
WHEN: Any new feature, fix, or change.
CHECK: Which agent owns this? **Orchestrator** (screen flow, data), **Designer** (UI,
prompt construction), **Curriculum** (topic index, question validation, diagram
logging), **Reviewer** (spec compliance), **Tester** (automated tests). If ownership
is unclear, resolve it before writing code — drift must be caught here, not after.

**RULE: Agent logging and Tester coverage are part of "done", not extras.**
WHEN: A feature is considered complete.
CHECK: Does it have agent log calls, and Tester tests for both the happy path and the
unhappy path (missing data, invalid input, network failure)? If either is missing, it
is not done.

**RULE: The five-agent ownership applies to diagrams too.**
WHEN: Any diagram work.
CHECK: Designer owns prompt construction (incl. diagram instructions); Curriculum owns
diagram logging and topic-to-diagram-type mapping. Don't work on diagrams outside this.

---

## Files and code

**RULE: Read the actual file before editing it.**
WHEN: Before any change to any file.
CHECK: Have I viewed the current state of this file this session? Exact-match edits
fail against a remembered version — read it first, every time.

**RULE: `node --check` before shipping any HTML or JS change.**
WHEN: Any JS file or HTML script block is modified.
CHECK: Run `node --check` (for HTML, extract the inline `<script>` and check that).
TypeScript annotations (`: any`, `: string`) leaking into browser JS have broken the
app before. `npm test` must also stay green (compute + review + prompts + config).

**RULE: Never narrow-fix. Fix the class of problem.**
WHEN: Any bug, defect, or quality issue.
CHECK: What general pattern does this belong to, and who else is affected? Fixing one
instance when the same fault exists across many (e.g. a renderer fix applied to one of
sixteen) is wrong — identify the class, fix the class.

---

## Defects

**RULE: Log the defect before fixing it.**
WHEN: Any defect found, whether reported or discovered during work.
CHECK: Is there a `DEF-XXX` entry in `Project Files/DEFECT_LOG.md` with description and
severity? Fixing without logging lets the same defect recur silently.

**RULE: A defect is not closed until a Tester test covers it.**
WHEN: Marking any defect resolved.
CHECK: Is there a new/updated Tester test that would catch this defect if it regressed?
If not, it isn't closed — it's hidden.

---

## Prompts

**RULE: Any prompt change requires a paired validation review.**
WHEN: A generation/review prompt in `prompts/` is modified.
CHECK: Does the validation that consumes the model output still match what the new
prompt returns — schema, field names, data types? Generation runs in the **worker**:
prompts live in `prompts/` (`question_gen.txt`, `diagram_system.txt`, `review.txt`),
and the matching validation lives in `index.js` (`generate()` filter), `compute.js`
(Stage 2), and `review.js` (Stage 4). Prompt and validation are reviewed together —
never one without the other. Prompts stay in git, never in the runtime_config table.

**RULE: Teach prompts with examples, not descriptions.**
WHEN: Writing any prompt that asks for structured output (questions, SVG, JSON).
CHECK: Does the prompt contain a complete, working example of exactly what's expected?
Descriptions of "good output" do not work reliably; a complete worked example does.

---

## Generation inputs

**RULE: Every input that shapes a generation request must be scoped to the request's topic; fallbacks narrow scope, never widen it.**
WHEN: Adding or changing anything fed into the question-generation prompt — curriculum
steering, coverage targets (`{{coverage_target}}`), bank reads, exclusions, rejections.
CHECK: Is each fragment filtered by the requested topic(s) at the point it is computed —
not just by child, subject or year? When the authoritative source is empty, does the code
fail to "no steering" rather than to another scope's data? (DEF-053: child-scoped coverage
sub-strands leaked across topics — an "Angles Introduction" job generated tally-chart
questions because the no-curriculum-object fallback used the child's observed sub-strands
from every topic.) The topic line and any injected sub-strand block both answer "what to
generate about" — they must agree: make one a subset of the other, or assert it. A soft
"prioritise these" hint is a HARD instruction to the model; test the case where it conflicts
with the topic.

---

## Diagrams

**RULE: Claude draws SVG directly — no intermediate engine or reviewer layer.**
WHEN: Any diagram feature or fix.
CHECK: Diagrams are generated as Claude SVG via `prompts/diagram_system.txt`. When a
diagram is wrong, fix the **draw prompt**, not an engine/agent wrapped around it.
CR-021/CR-021a (a rasterizer + vision-reviewer layer) were reverted for exactly this
reason — they compensated for engineered blindness instead of fixing the prompt
(see DEF-045). Do not re-introduce an intermediate diagram layer.

**RULE: Teach diagram prompts with complete worked SVG examples.**
WHEN: Writing or updating the diagram section of a prompt.
CHECK: Does the guidance show a real, complete SVG for the pattern being taught (e.g.
the quarter-circle worked example for geometry), not a text description? A rule plus a
worked SVG covers the class of topic — show, don't describe.

**RULE: Judge diagram quality by a real child's comprehension, not technical correctness.**
WHEN: Reviewing any diagram before it ships.
CHECK: Would a 13-year-old understand it immediately, without reading the question
first? Labels readable, key elements distinguishable? Anything less than yes doesn't ship.

---

## Documentation

**RULE: Keep documentation current as part of every change — proactively, without being asked.**
WHEN: Any change to the system.
CHECK: Update whatever the change touches:
- `Project Files/CR_LOG.md` — change requests / features (one row per item).
- `Project Files/DEFECT_LOG.md` — defects (log before fixing; close only with a Tester test).
- `Project Files/SESSION_HANDOVER_<YYYYMMDD>.md` — write/refresh at session end; it is
  the only memory between sessions.
- READMEs, inline comments, and any spec the change makes stale.
When it's ambiguous which doc applies, update the obvious ones and **flag the judgement
call** in your reply rather than staying silent.

---

## Communication

**RULE: Work from the project files, not from memory; say so when you haven't read one.**
WHEN: Asked about the state of any file or feature.
CHECK: Is this in a file I've read this session? If not, say "I haven't read that yet",
read it, then answer. Don't reconstruct from memory.

**RULE: Architectural decisions are judged against the actual requirements, not one output.**
WHEN: A comparison with another tool/approach suggests changing direction.
CHECK: Is the comparison fair — same scale, same pipeline, same reliability bar (an
autonomous pipeline serving children)? One good one-off result is not evidence against
a decision that holds at scale, and vice versa. Evaluate against requirements.

**RULE: Communicate outcomes, not process.**
WHEN: Everything.
CHECK: Don't narrate every step of thinking, building, debugging — the owner wants the
result, short and direct, unless they explicitly ask for the detail.
