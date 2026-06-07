-- Admin backend — Slice 2: curriculum curation & approval.
-- Applied to Supabase project rtyvomkhajyinlycgjzm via MCP apply_migration.
-- Idempotent: CREATE ... IF NOT EXISTS, OR REPLACE, DROP ... IF EXISTS, ON CONFLICT.
-- Reuses Slice-1 infrastructure: public.is_admin() (admin gate) and public.config_audit
-- (single change log). The worker reads approved curriculum_objects with the service
-- role (bypasses RLS); all client access is admin-gated.

-- 1. Frozen, versioned teacher knowledge. One approved row per (subject, topic,
--    year_group, scheme); the worker reads the latest approved version.
create table if not exists public.curriculum_objects (
  id          uuid primary key default gen_random_uuid(),
  subject     text not null,
  topic       text not null,
  year_group  int  not null,
  scheme      text not null default 'NC',
  version     int  not null,
  status      text not null default 'approved',   -- draft | approved | archived
  payload     jsonb not null,                     -- { sub_strands, prerequisites, misconceptions }
  approved_by text,
  approved_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_curriculum_objects_lookup
  on public.curriculum_objects (subject, year_group, topic, status, version desc);

-- 2. Sweep output awaiting human review (maximum-recall union, each item with
--    provenance + year-disagreement flag).
create table if not exists public.curation_proposals (
  id               uuid primary key default gen_random_uuid(),
  subject          text not null,
  topic            text not null,
  year_group       int  not null,
  scheme           text not null default 'NC',
  proposed_payload jsonb not null,
  source_run       jsonb,
  status           text not null default 'pending_review',  -- pending_review | approved | rejected
  created_at       timestamptz not null default now()
);

-- 3. Audit: every curriculum_objects change lands in the shared config_audit log
--    (the spec keeps one audit for config + curriculum). SECURITY DEFINER so the
--    insert succeeds regardless of caller RLS; direct RPC EXECUTE revoked.
create or replace function public.log_curriculum_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.config_audit (key, old_value, new_value, changed_by)
  values (
    format('curriculum:%s/%s/Y%s v%s', new.subject, new.topic, new.year_group, new.version),
    case when tg_op = 'UPDATE' then to_jsonb(old.status) else null end,
    to_jsonb(new.status),
    new.approved_by
  );
  return new;
end;
$$;
revoke execute on function public.log_curriculum_change() from public, anon, authenticated;

drop trigger if exists trg_curriculum_audit on public.curriculum_objects;
create trigger trg_curriculum_audit
  after insert or update on public.curriculum_objects
  for each row execute function public.log_curriculum_change();

-- 4. RLS: admins only on both tables; worker uses the service role (bypasses RLS).
alter table public.curriculum_objects enable row level security;
alter table public.curation_proposals enable row level security;

drop policy if exists curriculum_objects_admin on public.curriculum_objects;
create policy curriculum_objects_admin on public.curriculum_objects
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists curation_proposals_admin on public.curation_proposals;
create policy curation_proposals_admin on public.curation_proposals
  for all using (public.is_admin()) with check (public.is_admin());

-- 5. Atomic approval. Computes the next version, archives the prior approved row,
--    inserts the new approved (stamped) row, marks the proposal approved — one
--    race-safe call. SECURITY DEFINER with an internal admin assert so it is safe to
--    expose to authenticated; the service role / an admin JWT both satisfy the guard.
create or replace function public.approve_curation_proposal(
  proposal_id uuid, edited_payload jsonb, approver text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  p           public.curation_proposals%rowtype;
  next_ver    int;
  new_id      uuid;
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    raise exception 'not authorized';
  end if;

  select * into p from public.curation_proposals where id = proposal_id;
  if not found then raise exception 'proposal % not found', proposal_id; end if;

  select coalesce(max(version), 0) + 1 into next_ver
    from public.curriculum_objects
    where subject = p.subject and topic = p.topic
      and year_group = p.year_group and scheme = p.scheme;

  update public.curriculum_objects set status = 'archived'
    where subject = p.subject and topic = p.topic
      and year_group = p.year_group and scheme = p.scheme and status = 'approved';

  insert into public.curriculum_objects
    (subject, topic, year_group, scheme, version, status, payload, approved_by, approved_at)
  values
    (p.subject, p.topic, p.year_group, p.scheme, next_ver, 'approved', edited_payload, approver, now())
  returning id into new_id;

  update public.curation_proposals set status = 'approved' where id = proposal_id;
  return new_id;
end;
$$;
revoke execute on function public.approve_curation_proposal(uuid, jsonb, text) from public, anon;
grant  execute on function public.approve_curation_proposal(uuid, jsonb, text) to authenticated;

-- 6. Seed one real proposal from the Y7 Expressions & Equations demo doc, so the
--    approval UI and worker read are demoable before the sweep is run. Keyed to the
--    exact frontend topic chip ('Expressions & Equations', subject 'maths', year 7).
--    Two sub-strands are flagged year_flag='disputed' to exercise max-recall pruning.
insert into public.curation_proposals (subject, topic, year_group, scheme, proposed_payload, source_run, status)
select 'maths', 'Expressions & Equations', 7, 'NC',
$payload${
  "sub_strands": [
    {"id":"notation","name":"Algebraic notation & conventions","depth_bands":["recall","procedure","application","reasoning"],"provenance":["NC-KS3","NCETM"],"year_flag":"agreed"},
    {"id":"forming","name":"Forming expressions from context","depth_bands":["recall","procedure","application","reasoning"],"provenance":["NC-KS3","NCETM"],"year_flag":"agreed"},
    {"id":"substitution","name":"Substitution","depth_bands":["recall","procedure","application","reasoning"],"provenance":["NC-KS3","NCETM"],"year_flag":"agreed"},
    {"id":"simplifying","name":"Simplifying (collecting like terms)","depth_bands":["recall","procedure","application","reasoning"],"provenance":["NC-KS3","NCETM"],"year_flag":"agreed"},
    {"id":"expanding_single","name":"Expanding a single bracket","depth_bands":["recall","procedure","application","reasoning"],"provenance":["NC-KS3","NCETM"],"year_flag":"agreed"},
    {"id":"solving_linear","name":"Solving linear equations","depth_bands":["recall","procedure","application","reasoning"],"provenance":["NC-KS3","NCETM"],"year_flag":"agreed"},
    {"id":"expanding_double","name":"Expanding double brackets","depth_bands":["procedure","application"],"provenance":["AQA","Edexcel"],"year_flag":"disputed"},
    {"id":"factorising","name":"Factorising (single bracket)","depth_bands":["procedure","application"],"provenance":["AQA","WhiteRose"],"year_flag":"disputed"}
  ],
  "prerequisites": [
    {"sub_strand":"solving_linear","requires":["substitution","simplifying"]},
    {"sub_strand":"expanding_single","requires":["notation"]},
    {"sub_strand":"simplifying","requires":["notation"]}
  ],
  "misconceptions": [
    {"sub_strand":"simplifying","wrong":"5x + 3 = 8x","why":"treats unlike terms as like","correct":"5x + 3 (cannot be combined)"},
    {"sub_strand":"substitution","wrong":"2x^2 evaluates to 64 when x=4","why":"squares 2x as a whole instead of squaring only x","correct":"2 * 4^2 = 32"},
    {"sub_strand":"notation","wrong":"writes 'double a then add 3' as a3 + 2","why":"a3 is invalid notation for double a (that is 2a) and the number precedes the letter","correct":"2a + 3"}
  ]
}$payload$::jsonb,
$src${"sources":["Project Files/Coverage_Taxonomy_Demo_Y7_Expressions_Equations.md"],"note":"manual seed from demo doc","at":"2026-06-07"}$src$::jsonb,
'pending_review'
where not exists (
  select 1 from public.curation_proposals
  where subject='maths' and topic='Expressions & Equations' and year_group=7 and scheme='NC'
);
