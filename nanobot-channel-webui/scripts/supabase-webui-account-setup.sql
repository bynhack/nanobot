-- Supabase WebUI account and permission profile setup.
--
-- How to use:
-- 1. In Supabase Dashboard -> Authentication -> Users, create the login user first.
--    Use the email/password you want the WebUI user to sign in with.
-- 2. Open Supabase SQL Editor.
-- 3. Run the schema section once.
-- 4. Copy one of the profile template sections, replace email/company values, then run it.
--
-- Note:
-- Supabase Auth password users should be created by Supabase Auth UI/API, not by
-- direct SQL inserts into auth.users. This SQL manages the WebUI permission
-- profile linked to an existing auth.users row.

begin;

create table if not exists public.webui_user_profiles (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('admin', 'user')),
  business_role text not null default '',
  tenant_id text not null default '',
  scopes jsonb,
  resources jsonb,
  skills jsonb,
  tenant_policy jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists webui_user_profiles_email_idx
  on public.webui_user_profiles (email);

alter table public.webui_user_profiles enable row level security;

drop policy if exists "webui service role can manage profiles"
  on public.webui_user_profiles;

create policy "webui service role can manage profiles"
  on public.webui_user_profiles
  for all
  to service_role
  using (true)
  with check (true);

grant select, insert, update, delete on public.webui_user_profiles to service_role;

commit;

-- ---------------------------------------------------------------------------
-- Admin profile template
-- ---------------------------------------------------------------------------
-- Before running:
-- 1. Create admin@example.com in Supabase Auth first.
-- 2. Replace admin@example.com and tenant-root if needed.

/*
insert into public.webui_user_profiles (
  auth_user_id,
  email,
  role,
  business_role,
  tenant_id,
  scopes,
  resources,
  skills,
  tenant_policy,
  updated_at
)
select
  u.id,
  u.email,
  'admin',
  'admin',
  'tenant-root',
  null,
  null,
  '["*"]'::jsonb,
  null,
  now()
from auth.users u
where lower(u.email) = lower('admin@example.com')
on conflict (auth_user_id) do update set
  email = excluded.email,
  role = excluded.role,
  business_role = excluded.business_role,
  tenant_id = excluded.tenant_id,
  scopes = excluded.scopes,
  resources = excluded.resources,
  skills = excluded.skills,
  tenant_policy = excluded.tenant_policy,
  updated_at = now();
*/

-- ---------------------------------------------------------------------------
-- HR scoped user profile template
-- ---------------------------------------------------------------------------
-- Before running:
-- 1. Create hr@example.com in Supabase Auth first.
-- 2. Replace email, tenant_id, and company values.
-- 3. Add or remove company values in the companies CTE.

/*
with companies(company) as (
  values
    ('乐潮里科技有限公司'),
    ('武汉赢城文化传媒有限公司')
),
company_scope as (
  select jsonb_agg(company order by company) as values
  from companies
),
profile_payload as (
  select
    u.id as auth_user_id,
    u.email,
    'user'::text as role,
    'hr_specialist'::text as business_role,
    'tenant-hr'::text as tenant_id,
    jsonb_build_object('company', company_scope.values) as scopes,
    jsonb_build_array(
      jsonb_build_object(
        'resource', 'hr.company',
        'actions', jsonb_build_array('read', 'query'),
        'scopes', jsonb_build_array(jsonb_build_object('key', 'company', 'values', company_scope.values))
      ),
      jsonb_build_object(
        'resource', 'hr.organization',
        'actions', jsonb_build_array('read', 'query'),
        'scopes', jsonb_build_array(jsonb_build_object('key', 'company', 'values', company_scope.values))
      ),
      jsonb_build_object(
        'resource', 'hr.department',
        'actions', jsonb_build_array('read', 'query'),
        'scopes', jsonb_build_array(jsonb_build_object('key', 'company', 'values', company_scope.values))
      ),
      jsonb_build_object(
        'resource', 'hr.employee',
        'actions', jsonb_build_array('read', 'query', 'analyze'),
        'scopes', jsonb_build_array(jsonb_build_object('key', 'company', 'values', company_scope.values))
      ),
      jsonb_build_object(
        'resource', 'hr.contract',
        'actions', jsonb_build_array('read', 'query', 'analyze'),
        'scopes', jsonb_build_array(jsonb_build_object('key', 'company', 'values', company_scope.values))
      ),
      jsonb_build_object(
        'resource', 'hr.performance',
        'actions', jsonb_build_array('read', 'query', 'analyze'),
        'scopes', jsonb_build_array(jsonb_build_object('key', 'company', 'values', company_scope.values))
      ),
      jsonb_build_object(
        'resource', 'hr.insurance',
        'actions', jsonb_build_array('read', 'query', 'analyze'),
        'scopes', jsonb_build_array(jsonb_build_object('key', 'company', 'values', company_scope.values))
      ),
      jsonb_build_object(
        'resource', 'hr.personnel_change',
        'actions', jsonb_build_array('read', 'query', 'analyze'),
        'scopes', jsonb_build_array(jsonb_build_object('key', 'company', 'values', company_scope.values))
      ),
      jsonb_build_object(
        'resource', 'hr.disciplinary',
        'actions', jsonb_build_array('read', 'query', 'analyze'),
        'scopes', jsonb_build_array(jsonb_build_object('key', 'company', 'values', company_scope.values))
      ),
      jsonb_build_object(
        'resource', 'hr.seal_usage',
        'actions', jsonb_build_array('read', 'query', 'analyze'),
        'scopes', jsonb_build_array(jsonb_build_object('key', 'company', 'values', company_scope.values))
      )
    ) as resources,
    jsonb_build_array(
      'hr-query-analysis-router',
      'hr-db-ops',
      'hr-policy',
      'hr-schema'
    ) as skills,
    null::jsonb as tenant_policy
  from auth.users u
  cross join company_scope
  where lower(u.email) = lower('hr@example.com')
)
insert into public.webui_user_profiles (
  auth_user_id,
  email,
  role,
  business_role,
  tenant_id,
  scopes,
  resources,
  skills,
  tenant_policy,
  updated_at
)
select
  auth_user_id,
  email,
  role,
  business_role,
  tenant_id,
  scopes,
  resources,
  skills,
  tenant_policy,
  now()
from profile_payload
on conflict (auth_user_id) do update set
  email = excluded.email,
  role = excluded.role,
  business_role = excluded.business_role,
  tenant_id = excluded.tenant_id,
  scopes = excluded.scopes,
  resources = excluded.resources,
  skills = excluded.skills,
  tenant_policy = excluded.tenant_policy,
  updated_at = now();
*/

-- ---------------------------------------------------------------------------
-- Check profiles
-- ---------------------------------------------------------------------------

select
  email,
  role,
  business_role,
  tenant_id,
  scopes,
  skills,
  updated_at
from public.webui_user_profiles
order by updated_at desc;
