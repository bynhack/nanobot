# HR Python Runtime 迁移说明

本文记录 HR 业务 runtime 从 Node/JS 迁移到 Python 后的当前机制、命令面和权限边界。

## 背景

插件主体是 Python 技术栈，旧 HR runtime 却由 Python CLI 包装 Node 脚本：

```text
nanobot-webui-business hr
  -> Python wrapper
  -> node runtime/hr_cli.mjs
  -> runtime/access_policy.mjs
  -> runtime/hr_repository.mjs
  -> @supabase/supabase-js + node_modules
```

这导致发布脚本需要额外安装并打包 `node_modules`，同时权限、命令解析和 repository 逻辑分散在 Python 与 JS 两套运行时里。迁移后的目标是让 `nanobot-webui-business` 直接进入 Python runtime，并让技能包只保留模型可见说明和 `tenant-runtime.json` 契约。

## 当前结构

```text
src/nanobot_channel_webui/business_modules/hr/
  cli.py                         # nanobot-webui-business 入口
  runtime/
    commands.py                  # 标准 business CLI、legacy alias 和命令分发
    policy.py                    # resource/action/scope 权限判断
    repository.py                # HR 查询、分析、写入、删除、验证
    supabase_client.py           # Python Supabase/PostgREST 访问层
    scan_org_sources.py          # 维护脚本
  skills/
    hr-db-ops/
      SKILL.md
      tenant-runtime.json
```

已删除：

- `runtime/*.mjs`
- `supabase_connector.mjs`
- `package.json`
- `package-lock.json`
- `node_modules/`
- `skills/hr-db-ops/scripts/`

## 命令面

默认帮助只展示标准业务命令：

```bash
nanobot-webui-business hr business <query|get|analyze|preview|create|delete> <resource|topic> [options]
```

常用快路径：

```bash
nanobot-webui-business hr business query organization-tree
nanobot-webui-business hr business analyze headcount
nanobot-webui-business hr business get employee --name <name> [--company <company>]
nanobot-webui-business hr business query employee [--company <company>] [--status <status>]
```

旧命令仍作为内部兼容 alias 保留，例如 `analyze-headcount`、`list-employees`、`employee-detail`，但不再作为模型优先入口展示。

## 权限机制

`runtime/policy.py` 负责命令级授权：

- 缺少 `NANOBOT_WEBUI_POLICY_FILE` 时 fail closed。
- 非 admin 必须有 company scope。
- 使用 `resource + action + scope` 三元组判断能力。
- `count-all`、`data-quality-check`、`analyze-hr-risk-dashboard` 等全局命令对 scoped 用户拒绝。
- `business create/update/delete` 自动补内部确认短语，但仍要通过 command policy 和 repository scope 校验。

`runtime/repository.py` 负责数据层兜底：

- 查询、分析、详情会把 company scope 下推到 company/employee 过滤条件。
- 写入、删除、验证入口调用 `assert_plan_company_scope()`，对 plan 内公司字段再次校验。
- 身份证号、手机号等 PII 查询也必须带入当前账号授权公司范围。

## Supabase 访问层

`runtime/supabase_client.py` 优先复用环境中可用的 Supabase Python SDK。如果当前环境没有安装或未来不兼容，则使用 Python HTTP/PostgREST adapter 访问：

```text
~/.nanobot/config.json
  channels.webui_plugin.supabaseUrl
  channels.webui_plugin.supabaseServiceRoleKey
```

没有把 `supabase-py` 加入项目硬依赖，是因为当前 `nanobot-ai>=0.2.0` 依赖 `websockets>=16`，而 `supabase-py 2.x` 的 realtime 依赖要求 `websockets<16`。直接依赖会破坏 Nanobot SDK 运行时。当前实现仍是 Python-only，不再依赖 Node。

## 发布与验证

发布脚本现在不再执行 HR Node runtime 依赖安装：

```bash
./scripts/publish-local.sh
```

验收证据：

- Python 测试：`123 passed`
- 前端测试：`78 passed`
- wheel 审计：HR 目录无 `.mjs`、`package*.json`、`node_modules`
- 控制面健康检查：`{"status":"ok","mode":"control_plane"}`
- 普通实例业务探针：

```json
{
  "ok": true,
  "total": 25,
  "active": 21,
  "resigned": 4,
  "companies": 2
}
```
