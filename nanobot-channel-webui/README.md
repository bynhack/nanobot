# nanobot-channel-webui

`nanobot-channel-webui` 是 `nanobot-ai` 的 WebUI 插件项目。它不是 Nanobot 上游核心仓库，而是在保持上游安装、启动和演进方式不变的前提下，通过插件机制把 Nanobot 扩展成面向企业业务场景的多用户、多租户 Agent Runtime。

当前最重要的定位是：在个人工作区式 Agent Runtime 之上，提供登录、会话管理、业务权限、工具治理、技能沙盒、记忆隔离、审计和可配置 WebUI，让智能体可以安全地接入真实业务数据和业务操作。

## 项目定位

Nanobot 原本更接近个人使用的智能体框架：用户、工作区、记忆、技能和工具边界相对开放。企业业务场景需要更强的边界：不同账号只能查询和操作自己被授权的数据，不同业务技能不能把底层数据库脚本、密钥和实现细节暴露给普通用户，普通办公技能又不能因为业务权限控制而被整体禁用。

本插件解决的正是这个中间层问题：

- 不 fork、不侵入 Nanobot 上游核心。
- 通过插件注入运行时增强能力。
- 把「业务受控能力」和「普通辅助技能」分开治理。
- 让业务权限不依赖提示词，而是落实到工具调用、命令入口、数据查询、写入验证和审计链路。
- 将 HR 作为第一个业务域验证通用机制，后续可扩展到财务、合同、客户、项目等其他业务域。

## 核心能力

### WebUI 对话入口

- React/TypeScript 前端对话界面。
- WebSocket 流式响应。
- 多会话列表、会话切换和历史恢复。
- 文件上传、媒体预览和签名访问。
- 设置页、主题、工具调用消息显示开关。
- 欢迎语、输入框占位、conversation starters 可通过配置调整。

### 登录与用户隔离

- 支持 Supabase Auth 账号体系。
- 普通用户只能看到自己的会话、上传和运行时数据。
- 管理员可以访问完整插件数据面。
- 每个账号对应独立 Nanobot gateway 实例；会话列表来自用户实例内的上游 websocket channel。

### Tenant Runtime 权限层

插件提供一套通用 Tenant Runtime，用于表达和执行：

```text
subject + resource + action + scope
```

例如：

```json
{
  "resource": "hr.contract",
  "actions": ["read", "query", "analyze"],
  "scopes": [{ "key": "company", "values": ["乐潮里科技有限公司"] }]
}
```

这表示当前账号只能在指定公司范围内读取、查询和分析合同数据。

权限层的职责是控制「能不能调用」：

- 受控业务技能必须走声明过的标准命令入口。
- 敏感工具、敏感文件、底层数据库脚本和权限文件默认不可见。
- 缺少身份、缺少 policy、缺少 policy file 或运行时注入失败时默认拒绝。
- scoped 用户看到的是动态技能视图，而不是完整技能实现。
- 允许和拒绝都会进入审计链路。

### 业务技能沙盒

受控业务技能不是普通开放技能。它们需要通过 `tenant-runtime.json` 声明：

- 技能名称和类型。
- 可执行命令入口。
- 资源、动作和 scope 要求。
- capability 列表。
- 触发词、任务聚焦词和关联能力。
- 需要用户确认的写入或删除能力。
- 面向智能体的执行 recipe。

scoped 用户读取受控技能时，插件会基于当前账号权限和当前任务生成动态技能视图。模型只会看到当前账号能使用的能力、命令和执行规则，不会看到隐藏实现、底层脚本和全量命令面。

### 普通技能自由组合

权限控制不是把智能体锁死。普通技能仍应自由组合使用，例如：

- Word/文档导出。
- Excel/表格处理。
- 浏览器访问。
- 图表和报告生成。
- 基于授权数据生成业务分析材料。

边界是：普通技能可以消费受控业务技能产出的授权 artifacts，但不能读取业务沙盒内部、权限文件、数据库密钥、会话历史或其他敏感运行时文件。

### HR 业务集成

HR 是当前第一个完整业务域，用于验证通用机制。当前标准资源包括：

- `hr.company`
- `hr.organization`
- `hr.department`
- `hr.employee`
- `hr.contract`
- `hr.performance`
- `hr.insurance`
- `hr.personnel_change`
- `hr.disciplinary`
- `hr.seal_usage`

HR 能力覆盖：

- 公司、组织、部门查询。
- 员工花名册、员工详情、员工履历。
- 合同查询、合同覆盖率、合同到期分析。
- 绩效记录查询和分析。
- 社医保异动查询和分析。
- 人事异动查询。
- 奖惩记录查询和分析。
- 用章记录查询。
- 员工、合同、绩效、社医保、人事异动、奖惩、用章、组织部门等数据录入。
- 删除类操作需要明确用户确认。

HR 业务命令统一收敛到：

```bash
nanobot-webui-business hr business query <resource>
nanobot-webui-business hr business get <resource>
nanobot-webui-business hr business analyze <topic>
nanobot-webui-business hr business preview <resource>
nanobot-webui-business hr business create <resource>
nanobot-webui-business hr business delete <resource>
```

业务脚本层的职责是控制「调用后能看到什么」：

- 不传公司参数时，自动按当前账号授权公司范围过滤。
- 显式传入未授权公司时拒绝。
- 查询、详情、分析、预览、写入、删除、验证都走同一份 policy。
- repository 写入层还有最终 scope 兜底，避免只靠 CLI 入口扫描 JSON plan。

## 设计理念

### 1. 不修改上游核心

Nanobot 是本项目使用的 SDK/agent runtime。产品控制面由本插件自己的命令启动：

```bash
nanobot-webui gateway --config ~/.nanobot/config.json
```

控制面负责登录、静态资源、设置页、实例调度和 upstream websocket 代理；每个登录用户的
Nanobot runtime 由控制面通过 SDK 程序化启动。本项目不把企业业务逻辑塞进上游核心，
这样上游继续演进时，本插件可以独立适配。

### 2. 权限不是提示词

提示词可以指导模型，但不能作为安全边界。真正的权限边界必须落到：

- 工具定义和工具调用。
- 命令白名单。
- 文件读写边界。
- 业务 CLI 授权。
- 数据查询条件。
- 写入验证。
- 审计日志。

### 3. 双层防线

插件运行时控制「入口」，业务脚本和 repository 控制「数据」。

```text
用户身份
  -> PolicyResolver
  -> Tool/Command/Skill Gateway
  -> Dynamic Skill View
  -> Business CLI
  -> Repository Scope Guard
  -> Database
```

任何一层缺失都不应该导致越权放行。

### 4. 受控业务技能和普通技能解耦

HR 业务技能是受控沙盒；Word、Excel、浏览器等是普通辅助技能。普通技能不需要知道 HR 沙盒内部结构，只需要读取授权 artifacts 即可继续完成导出、整理和分析。

### 5. 通用机制，业务契约化

HR 不应该污染通用运行时。业务词、任务聚焦词、能力组合和 recipe 都应放在业务自己的 `tenant-runtime.json` 中。通用运行时只读取契约，不硬编码某个业务域。

## 本地开发与发布

### 安装到本地 Nanobot 环境

开发时从本地 checkout 安装：

```bash
uv tool install nanobot-ai \
  --with /absolute/path/to/nanobot-channel-webui \
  --force
```

发布后从包安装：

```bash
uv tool install nanobot-ai \
  --with nanobot-channel-webui \
  --force
```

如果使用已经构建好的 wheel：

```bash
uv tool install nanobot-ai \
  --with ./dist/nanobot_channel_webui-0.1.1-py3-none-any.whl \
  --force
```

这样只维护一个 `nanobot-ai` tool env，Nanobot 用户实例能 import 插件。较新的 uv
支持 `--with-executables-from <plugin>` 时，可以同时暴露插件命令；当前兼容脚本会在 uv
不支持该参数时，把 `nanobot-ai` env 内生成的 `nanobot-webui` 和
`nanobot-webui-business` 链接到 uv tool bin 目录。

### 本地验证

```bash
./scripts/verify-local.sh
```

该脚本会运行：

- Python 测试。
- 前端测试。
- 前端构建。
- Python 源码编译检查。

### 本地发布

```bash
./scripts/publish-local.sh
```

该脚本会依次完成：

1. 本地验证。
2. 同步前端静态资源到 Python 包。
3. 构建 wheel。
4. 使用 `uv tool install nanobot-ai --with <wheel> --force` 将插件安装到同一个
   `nanobot-ai` tool env；如果当前 uv 不支持 `--with-executables-from`，脚本会创建
   `nanobot-webui` / `nanobot-webui-business` 的 PATH shim。

如果修改涉及 Python 后端、插件运行时、权限注入、会话服务、API 或其他服务端逻辑，发布后需要重启 WebUI 控制面：

```bash
nanobot-webui gateway --config ~/.nanobot/config.json
```

本项目协作规则要求由 Agent 使用 `tmux` 完成重启，不让用户手动重启。

## 最小配置示例

```json
{
  "channels": {
    "webui_plugin": {
      "enabled": true,
      "host": "127.0.0.1",
      "port": 8081,
      "mediaSigningSecret": "replace-with-a-stable-random-secret",
      "streaming": true
    }
  }
}
```

### UI 文案配置

```json
{
  "channels": {
    "webui_plugin": {
      "enabled": true,
      "title": "业务助手",
      "ui": {
        "welcomeTitle": "从一个问题开始。",
        "welcomeSubtitle": "选择一个常用任务，或直接输入你想处理的内容。",
        "composerPlaceholder": "输入问题、任务或 / 选择技能…",
        "compactComposerPlaceholder": "发消息…",
        "conversationStarters": [
          {
            "title": "查询员工信息",
            "label": "按姓名、公司或部门查询员工档案",
            "prompt": "帮我查询乐潮里科技有限公司的员工花名册"
          }
        ]
      }
    }
  }
}
```

### Supabase 登录配置

浏览器使用 Supabase JS SDK 登录。后端只校验 Supabase Auth JWT，并用 service role key 从权限画像表读取当前账号的角色、租户、资源 scope 和技能列表。

```json
{
  "channels": {
    "webui_plugin": {
      "enabled": true,
      "host": "127.0.0.1",
      "port": 8081,
      "mediaSigningSecret": "replace-with-a-stable-random-secret",
      "streaming": true,
      "supabaseUrl": "https://example.supabase.co",
      "supabaseAnonKey": "replace-with-supabase-anon-key",
      "supabaseServiceRoleKey": "replace-with-service-role-key",
      "supabaseProfilesTable": "webui_user_profiles"
    }
  }
}
```

权限画像表需要能表达：

- `auth_user_id`：Supabase Auth 用户 ID。
- `email`：登录邮箱。
- `role`：`admin` 或 `user`。
- `tenant_id`：租户 ID。
- `business_role`：业务角色。
- `resources`：资源、动作和 scope 权限配置。
- `scopes`：通用 scope 配置。
- `skills`：可使用技能列表。
- `tenant_policy`：可选的完整租户策略 JSON。

账号创建分两步：

1. 在 Supabase Dashboard 的 Authentication / Users 里手动创建登录账号和密码。
2. 打开 [`scripts/supabase-webui-account-setup.sql`](scripts/supabase-webui-account-setup.sql)，复制其中的 SQL 到 Supabase SQL Editor 执行，创建权限画像表并为对应邮箱写入权限画像。

SQL 文件里包含管理员账号和 HR scoped 普通账号两种模板；执行前替换邮箱、租户 ID 和公司范围。

## 代码结构

```text
nanobot-channel-webui/
  frontend/                         # React WebUI
  src/nanobot_channel_webui/
    channel.py                       # WebUI channel 和 HTTP/WebSocket 后端
    permissions/                     # 当前权限实现和兼容导入层
    tenant_runtime/                  # 通用 Tenant Runtime 公共命名层
    business_modules/hr/             # 打包进插件的 HR 业务模块
    static/                          # 构建后的前端静态资源
  docs/                              # 当前架构文档、需求清单、修复清单
  scripts/                           # 本地验证、发布和安装脚本
  tests/                             # Python 测试
```

## 关键文档

- [`docs/README.md`](docs/README.md)：文档索引。
- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md)：产品能力、架构目标和明确需求清单。
- [`docs/FIXME.md`](docs/FIXME.md)：Bug、安全风险和技术债修复清单。
- [`docs/2026-05-29-tenant-runtime-permission-hardening.md`](docs/2026-05-29-tenant-runtime-permission-hardening.md)：当前权限硬化基线。
- [`docs/2026-06-05-supabase-auth-permission-profile.md`](docs/2026-06-05-supabase-auth-permission-profile.md)：Supabase Auth 与 WebUI 权限画像接入约定。
- [`docs/2026-05-28-tenant-runtime-plugin-design.md`](docs/2026-05-28-tenant-runtime-plugin-design.md)：Tenant Runtime Plugin 设计。
- [`docs/2026-05-28-tenant-runtime-skill-integration.md`](docs/2026-05-28-tenant-runtime-skill-integration.md)：业务技能接入规范。

## 当前状态

当前插件已经具备：

- 独立 WebUI channel 插件包。
- 前后端本地发布链路。
- 登录与会话隔离。
- Tenant Runtime 权限模型。
- 受控业务技能动态视图。
- HR 业务模块打包和标准 business CLI。
- 数据查询、分析、录入、删除的权限边界。
- 工具调用、敏感文件、业务沙盒和普通技能组合的边界治理。

后续新增业务域时，应优先复用 Tenant Runtime、`tenant-runtime.json` 契约、Guard SDK、标准 business CLI 和 artifacts 协作空间，而不是把业务逻辑硬编码进通用运行时。
