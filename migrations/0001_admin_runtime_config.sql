-- Admin backend — first slice: runtime config dials + audit trail + admin gate.
-- Applied to Supabase project rtyvomkhajyinlycgjzm via MCP apply_migration.
-- Idempotent: safe to re-run (CREATE ... IF NOT EXISTS, OR REPLACE, DROP ... IF EXISTS,
-- ON CONFLICT DO NOTHING). The worker reads runtime_config with the service role (which
-- bypasses RLS); all client access is admin-gated by RLS.

-- 1. Admin gate — who counts as an operator. Keyed by auth.users uid, kept separate
--    from the child-facing `users` table. First admin is bootstrapped manually (below).
create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

-- 2. Runtime config — the adjustable dials the worker reads live.
create table if not exists public.runtime_config (
  key         text primary key,
  value       jsonb,
  value_type  text,                         -- string | number | bool | json
  description text,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

-- 3. Append-only audit — every runtime_config change, who and when.
create table if not exists public.config_audit (
  id         uuid primary key default gen_random_uuid(),
  key        text,
  old_value  jsonb,
  new_value  jsonb,
  changed_by text,
  changed_at timestamptz not null default now()
);

-- Audit trigger: every INSERT/UPDATE on runtime_config logs to config_audit. SECURITY
-- DEFINER so the insert succeeds regardless of the caller's RLS (config_audit has no
-- client INSERT policy — the trigger is the only writer).
create or replace function public.log_runtime_config_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.config_audit (key, old_value, new_value, changed_by)
  values (
    new.key,
    case when tg_op = 'UPDATE' then old.value else null end,
    new.value,
    new.updated_by
  );
  return new;
end;
$$;

drop trigger if exists trg_runtime_config_audit on public.runtime_config;
create trigger trg_runtime_config_audit
  after insert or update on public.runtime_config
  for each row execute function public.log_runtime_config_change();

-- The trigger fires regardless of EXECUTE grants, so revoke direct RPC access to stop a
-- client forging config_audit rows via /rest/v1/rpc/log_runtime_config_change.
revoke execute on function public.log_runtime_config_change() from public, anon, authenticated;

-- Admin check helper. SECURITY DEFINER so it can read admin_users without tripping
-- that table's own RLS (avoids recursive-policy errors).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

-- RLS: no anon access; admins only. Worker uses the service role (bypasses RLS).
alter table public.admin_users    enable row level security;
alter table public.runtime_config enable row level security;
alter table public.config_audit   enable row level security;

drop policy if exists admin_users_select on public.admin_users;
create policy admin_users_select on public.admin_users
  for select using (public.is_admin());

drop policy if exists runtime_config_select on public.runtime_config;
create policy runtime_config_select on public.runtime_config
  for select using (public.is_admin());

drop policy if exists runtime_config_insert on public.runtime_config;
create policy runtime_config_insert on public.runtime_config
  for insert with check (public.is_admin());

drop policy if exists runtime_config_update on public.runtime_config;
create policy runtime_config_update on public.runtime_config
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists config_audit_select on public.config_audit;
create policy config_audit_select on public.config_audit
  for select using (public.is_admin());

-- Seed the four migrated dials at their current code defaults. ON CONFLICT DO NOTHING
-- so a re-run never clobbers a live admin edit. (These inserts fire the audit trigger,
-- creating the initial config_audit provenance rows.)
insert into public.runtime_config (key, value, value_type, description, updated_by) values
  ('CLAUDE_MODEL',       '"claude-sonnet-4-6"'::jsonb,        'string', 'Text generation + review model (Stage 1/4).',                  'migration'),
  ('DIAGRAM_MODEL',      '"claude-opus-4-7"'::jsonb,          'string', 'Diagram SVG model (Stage 3) — stronger model for diagrams.',   'migration'),
  ('MAX_TOKENS',         '8000'::jsonb,                       'number', 'Max output tokens for text generation calls.',                 'migration'),
  ('DIAGRAM_MAX_TOKENS', '16000'::jsonb,                      'number', 'Max output tokens for diagram generation calls.',              'migration')
on conflict (key) do nothing;

-- Bootstrap the first admin manually (cannot be self-served — RLS blocks self-promotion):
--   insert into public.admin_users (user_id, email)
--   select id, email from auth.users where email = 'maus23@gmail.com'
--   on conflict (user_id) do nothing;
