-- BrightMind — DEF-056: a child's year change did not flow into year-dependent views.
-- `results` carried no year, so every aggregate (dashboard %, topic badges, adaptive
-- difficulty, progress screen, worker coverage matrix) mixed last year's work into this
-- year's numbers. Each result now records the year it was earned in — taken from its
-- tutorial, NOT the child's current year, so history stays correct after a year change.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; backfill only touches NULLs; trigger is replaced.

alter table public.results add column if not exists year_group integer;

-- Backfill from the tutorial (results.tutorial_id → tutorials ON DELETE CASCADE, so every
-- result has one).
update public.results r
   set year_group = t.year_group
  from public.tutorials t
 where t.id = r.tutorial_id
   and r.year_group is null;

-- Stamp every new result from its tutorial, so no client can forget or mis-set it.
create or replace function public.results_set_year_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.year_group is null then
    select t.year_group into new.year_group from public.tutorials t where t.id = new.tutorial_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.results_set_year_group() from public, anon, authenticated;

drop trigger if exists results_set_year_group on public.results;
create trigger results_set_year_group
  before insert on public.results
  for each row execute function public.results_set_year_group();

create index if not exists idx_results_child_year on public.results (child_id, year_group);
