-- BrightMind — CR-032: parent-selected subtopics in the tutorial wizard.
-- Idempotent; safe to re-run.
--
-- 1. generation_jobs.subtopics — the parent's per-topic sub-strand selection,
--    shape { "<topic>": ["<sub-strand name>", ...] }. NULL on jobs from older clients
--    or topics without an approved curriculum object; the worker fails open (full
--    approved list) on NULL/empty/zero-match selections.
alter table public.generation_jobs add column if not exists subtopics jsonb;

-- 2. Parents must be able to expand a topic into its approved sub-strands in the
--    wizard. curriculum_objects was admin-only (migration 0002); add a read-only
--    policy for any authenticated user, restricted to APPROVED rows (the live,
--    human-signed-off taxonomy — not sensitive; proposals stay admin-only).
--    Permissive policies OR together, so the existing admin policy is unaffected.
drop policy if exists curriculum_objects_read_approved on public.curriculum_objects;
create policy curriculum_objects_read_approved on public.curriculum_objects
  for select to authenticated
  using (status = 'approved');
