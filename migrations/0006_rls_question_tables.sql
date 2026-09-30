-- BrightMind — DEF-054: RLS was DISABLED on three public tables.
-- question_bank, child_question_history and question_rejections_backup_20260614 pre-date
-- migrations/, so nothing ever enabled RLS on them. With RLS off, the public anon key
-- (shipped in the frontend) could read/insert/update/delete via PostgREST — the whole
-- question bank, every child's served-question history (child_id: children's personal
-- data), and the archived parent rejections.
--
-- Only the worker (index.js) and scripts/depth_tag_check.js use these tables, both with
-- the service role, which bypasses RLS — so enabling RLS changes nothing for them.
-- The frontend never touches them. Policy: admins may READ (admin app / diagnostics);
-- no client write policy at all — writes are service-role only.
--
-- question_rejections_backup_20260614 is the ONLY copy of pre-14-Jun parent rejections
-- (live question_rejections is empty) — kept, locked down, not dropped.
--
-- Idempotent: ENABLE RLS is a no-op if already enabled; policies drop-then-create.

alter table public.question_bank                        enable row level security;
alter table public.child_question_history               enable row level security;
alter table public.question_rejections_backup_20260614  enable row level security;

drop policy if exists question_bank_admin_select on public.question_bank;
create policy question_bank_admin_select on public.question_bank
  for select using (public.is_admin());

drop policy if exists child_question_history_admin_select on public.child_question_history;
create policy child_question_history_admin_select on public.child_question_history
  for select using (public.is_admin());

drop policy if exists question_rejections_backup_admin_select on public.question_rejections_backup_20260614;
create policy question_rejections_backup_admin_select on public.question_rejections_backup_20260614
  for select using (public.is_admin());
