-- BrightMind — DEF-051: bank writes silently failing (HTTP 400).
-- The legacy `question` jsonb column on question_bank was NOT NULL with no default.
-- The current bankWrite (index.js) writes the flat columns (q, o, c, e, svg, depth,
-- sub_strand, …) and never sets `question`, so every INSERT violated the NOT NULL
-- constraint and PostgREST returned 400. fetch() doesn't throw on HTTP errors, so the
-- failure was swallowed — the bank stayed empty, adaptBank (Stage 0) had nothing to
-- serve, and no depth-tagged rows ever landed for the CR-022 coverage check.
-- Make the dead legacy column nullable so the modern inserts go through.
-- Idempotent: DROP NOT NULL is a no-op if already nullable.
alter table public.question_bank alter column question drop not null;
