-- Create or update the WebUI permission profile for wenming.jiao@lechaoli.com.
--
-- Before running this SQL:
-- 1. Go to Supabase Dashboard -> Authentication -> Users.
-- 2. Create the login user with email and password.
-- 3. User email is set to wenming.jiao@lechaoli.com.
-- 4. Run this file in Supabase SQL Editor.

do $$
declare
  user_email text := 'wenming.jiao@lechaoli.com';
begin
  if user_email = '' then
    raise exception 'User email is empty.';
  end if;

  if not exists (
    select 1
    from auth.users
    where lower(email) = lower(user_email)
  ) then
    raise exception 'Auth user with email % does not exist. Create it in Authentication / Users first.', user_email;
  end if;
end $$;

with companies(company) as (
  values
    ('乐潮里科技有限公司')
),
company_scope as (
  select jsonb_agg(company order by company) as values
  from companies
),
resource_names(resource) as (
  values
    ('hr.company'),
    ('hr.organization'),
    ('hr.department'),
    ('hr.employee'),
    ('hr.contract'),
    ('hr.performance'),
    ('hr.insurance'),
    ('hr.personnel_change'),
    ('hr.disciplinary'),
    ('hr.seal_usage')
),
profile_payload as (
  select
    u.id as auth_user_id,
    u.email,
    'user'::text as role,
    'hr_specialist'::text as business_role,
    'tenant-hr'::text as tenant_id,
    jsonb_build_object('company', company_scope.values) as scopes,
    (
      select jsonb_agg(
        jsonb_build_object(
          'resource', resource_names.resource,
          'actions', jsonb_build_array('read', 'query', 'analyze', 'write', 'delete'),
          'scopes', jsonb_build_array(
            jsonb_build_object('key', 'company', 'values', company_scope.values)
          )
        )
        order by resource_names.resource
      )
      from resource_names
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
  where lower(u.email) = lower('wenming.jiao@lechaoli.com')
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

select
  email,
  role,
  business_role,
  tenant_id,
  scopes,
  resources,
  skills,
  updated_at
from public.webui_user_profiles
where lower(email) = lower('wenming.jiao@lechaoli.com');
