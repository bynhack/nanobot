# Supabase Auth 与权限画像接入

本文记录 WebUI 插件从 PocketBase 账号体系切换到 Supabase Auth 的当前实现约定。

## 结论

- 浏览器使用 Supabase JS SDK 登录、持久化 session 和刷新 token。
- WebUI 后端不接收密码，不实现 `/api/auth/login` 或 `/api/auth/logout`。
- 浏览器请求 WebUI API 时通过 `Authorization: Bearer <access_token>` 传递 Supabase Auth token。
- 后端通过 Supabase Auth `/auth/v1/user` 校验 token，并使用 service role key 查询权限画像表。
- 会话列表、历史和删除仍来自用户实例内的上游 websocket channel，不需要外层 `chat_sessions` 表。

## 配置

```json
{
  "channels": {
    "webui_plugin": {
      "supabaseUrl": "https://example.supabase.co",
      "supabaseAnonKey": "replace-with-anon-key",
      "supabaseServiceRoleKey": "replace-with-service-role-key",
      "supabaseProfilesTable": "webui_user_profiles"
    }
  }
}
```

框架账号和 HR 业务数据使用同一个 Supabase 项目，因此配置只保留这一套
`supabase*` 字段。

## 权限画像表

默认表名为 `public.webui_user_profiles`。推荐字段：

```sql
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

alter table public.webui_user_profiles enable row level security;

grant select on public.webui_user_profiles to service_role;
```

普通 `user` 必须至少具备 `resources`、`scopes` 或 `tenant_policy` 之一；缺失权限画像时后端默认拒绝。`admin` 可不配置资源列表，`PolicyResolver` 会将其解析为全局管理员。

## SQL 设置文件

本仓库提供手动复制执行的 SQL 文件：

[`scripts/supabase-webui-account-setup.sql`](../scripts/supabase-webui-account-setup.sql)

使用方式：

1. 在 Supabase Authentication / Users 中手动创建登录账号和密码。
2. 打开 SQL 文件，复制建表语句到 Supabase SQL Editor 执行。
3. 复制管理员或 HR scoped 用户模板，替换邮箱、租户 ID 和公司范围后执行。

## 为什么后端不用 supabase-py 硬依赖

本插件后端只需要 Auth token 校验和一张权限画像表查询。当前 Python 环境里的
Nanobot 依赖 `websockets>=16.0,<17.0`，而最新 `supabase-py` 的 realtime 依赖仍要求
`websockets<16,>=11`。为避免破坏 Nanobot gateway / websocket channel 主链路，后端使用
`aiohttp` 调 Supabase REST API。
