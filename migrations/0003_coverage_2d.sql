-- BrightMind — CR-022 (cont.): 2D coverage tags on the question bank.
-- Idempotent (ADD COLUMN / CREATE INDEX IF NOT EXISTS). Applied via Supabase MCP to
-- project rtyvomkhajyinlycgjzm; this file is the in-repo mirror.
--
-- The 5 Jun slice added a single 1D `subtopic` column. This adds the depth axis so a
-- question can be placed on the sub_strand × depth grid:
--   sub_strand — the width tag (the human-approved sub-strand name, or the generator's
--                self-enumerated sub-skill in fallback). Backfilled from `subtopic`.
--   depth      — one of recall|procedure|application|reasoning. Left NULL on legacy rows.
--                NULL depth = UNKNOWN, never "all bands covered" — a legacy/untagged row is
--                counted width-only by the coverage matrix and can never falsely read as
--                mastered (DEF-049 invariant).

alter table public.question_bank add column if not exists sub_strand text;
alter table public.question_bank add column if not exists depth      text;

-- Backfill width from the existing 1D label; depth stays NULL (unknown) until the bank
-- re-populates with 2D-tagged rows. So depth-targeted top-up activates gradually; width
-- gap-fill works immediately (Slice E caveat).
update public.question_bank
   set sub_strand = subtopic
 where sub_strand is null and subtopic is not null;

-- Supports the Slice E gap-cell bank tier and coverage lookups.
create index if not exists idx_question_bank_coverage
  on public.question_bank (subject, year_group, topic, sub_strand, depth);

-- CR-022 (cont.) weak/strong threshold dial (admin-tunable; worker falls back to 0.6 when
-- absent, so this changes nothing until edited). A cell is "weak" below this correct ratio.
insert into public.runtime_config (key, value, value_type, description, updated_by)
values ('COVERAGE_WEAK_PCT', '0.6'::jsonb, 'number',
        'CR-022 coverage matrix: correct-ratio below which a (sub-strand, depth) cell is weak (0–1).',
        'migration:0003')
on conflict (key) do nothing;
