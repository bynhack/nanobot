-- Create or update one WebUI admin permission profile.
--
-- Before running this SQL:
-- 1. Go to Supabase Dashboard -> Authentication -> Users.
-- 2. Create the admin login user with email and password.
-- 3. Admin email is set to admin@lechaoli.com.
-- 4. Run this file in Supabase SQL Editor.

do $$
declare
  admin_email text := 'admin@lechaoli.com';
begin
  if admin_email = '' then
    raise exception 'Admin email is empty.';
  end if;

  if not exists (
    select 1
    from auth.users
    where lower(email) = lower(admin_email)
  ) then
    raise exception 'Auth user with email % does not exist. Create it in Authentication / Users first.', admin_email;
  end if;

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
  where lower(u.email) = lower(admin_email)
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
end $$;

select
  email,
  role,
  business_role,
  tenant_id,
  skills,
  updated_at
from public.webui_user_profiles
where role = 'admin'
order by updated_at desc;
