-- Admin backend — CR-033: sweep run log (coverage dashboard).
-- Applied to Supabase project rtyvomkhajyinlycgjzm via MCP apply_migration.
-- Idempotent: CREATE ... IF NOT EXISTS, DROP POLICY IF EXISTS.
-- Reuses public.is_admin() (Slice-1 admin gate). The run-sweep Edge Function writes
-- here with the service role (bypasses RLS) on EVERY terminal path; the admin SPA
-- reads it (admin-only) to show which topics were never swept / errored / succeeded.
--
-- Why a log and not a status column: errors used to vanish (run-sweep returned them in
-- the HTTP response and the browser logged them to a transient div). An append-only run
-- log makes "ended in error" reconstructable after the fact and keeps full sweep history.

create table if not exists public.sweep_runs (
  id          uuid primary key default gen_random_uuid(),
  subject     text not null,
  topic       text not null,
  year_group  int  not null,
  scheme      text not null default 'NC',
  outcome     text not null,            -- created | skipped | error
  detail      text,                     -- error message, or sub-strand count on success
  model       text,                     -- the model the sweep resolved (provenance)
  run_by      text,                     -- admin email/id that triggered the sweep
  created_at  timestamptz not null default now()
);

-- Latest-run-per-topic lookups for the dashboard.
create index if not exists idx_sweep_runs_lookup
  on public.sweep_runs (subject, year_group, topic, created_at desc);

-- RLS: admins read; no client writes (the service role inserts and bypasses RLS),
-- mirroring curation_proposals.
alter table public.sweep_runs enable row level security;

drop policy if exists sweep_runs_admin_read on public.sweep_runs;
create policy sweep_runs_admin_read on public.sweep_runs
  for select using (public.is_admin());
