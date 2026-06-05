# 文档索引

本目录只保留当前仍有指导价值的设计文档。历史阶段计划、迁移过程文档和已完成发布说明已归档到 `docs/archive/`。

## 长期跟踪

- `FIXME.md`
  - 问题、风险、安全缺口和技术债修复清单。

- `REQUIREMENTS.md`
  - 产品能力、架构目标和明确需求清单。

## 当前架构文档

- `2026-06-05-managed-instance-websocket-channel-mechanism.md`
  - 当前多实例 WebUI 机制说明和旧 channel 逻辑清理方案：解释外层插件控制面、用户独立实例、上游 `websocket` channel、实例 workspace、policy 文件、业务 CLI 以及后续清理边界。

- `2026-06-05-python-hr-runtime-migration.md`
  - HR 业务 runtime 从 Node/JS 迁移到 Python 后的当前机制：说明 CLI 命令面、权限判断、repository scope 兜底、Supabase/PostgREST 访问层和发布验证证据。

- `2026-06-05-supabase-auth-permission-profile.md`
  - Supabase Auth 与 WebUI 权限画像接入约定：说明前端 SDK 登录、后端 JWT 校验、权限画像表结构和不引入 `supabase-py` 硬依赖的原因。

- `superpowers/plans/2026-06-05-programmatic-instance-gateway-runtime.md`
  - 新多实例主线实施计划：通过程序化 runtime 启动独立 Nanobot gateway，每个实例保留默认 websocket channel，并显式接入 hooks。

- `2026-05-29-tenant-runtime-permission-hardening.md`
  - 当前权限硬化基线：记录标准资源拆分、动态技能视图、标准 business CLI、业务数据层 scope 过滤、Guard SDK 定位和回归测试边界。

- `2026-05-28-tenant-runtime-plugin-design.md`
  - 历史主线和实例内治理参考：将 WebUI 插件抽象为支持业务权限控制、工具治理、技能治理和审计的 Tenant Runtime Plugin；多租户硬隔离已转向多实例 runtime。

- `2026-05-28-tenant-runtime-skill-integration.md`
  - 业务技能接入规范：说明技能如何声明 `tenant-runtime.json`、读取策略文件，并通过 Guard SDK 落实数据范围权限。

- `2026-05-27-runtime-permission-injection-design.md`
  - HR 权限 MVP 的运行时注入设计，记录插件如何在不修改 Nanobot 上游核心的前提下注入工具权限、技能权限、命令权限和审计能力。

## 历史归档

- `archive/2026-05/`
  - 插件迁移、早期 PocketBase 登录、运行稳定性、预览工作区、会话工作空间、上图工作台等历史设计和计划。

## 文档维护原则

- 新的长期架构设计放在 `docs/` 顶层。
- 阶段性计划和已经完成的发布说明完成后移入 `docs/archive/`。
- 新需求、产品原则或架构目标更新 `REQUIREMENTS.md`；bug、安全风险、评审意见或技术债更新 `FIXME.md`。
- 如果文档已经不符合当前产品定位，应更新或归档，不要让过期文档停留在顶层。
