---
name: "hr-policy"
description: "HR 写入、导入、删除、匹配歧义、附件处理、确认摘要和用户措辞规则。Use when changing data, preparing confirmations, or resolving ambiguous employee matches; not the default entry for ordinary HR information requests."
---

# HR Policy

本技能定义 HR 数据操作的业务安全规则。权限边界由 WebUI business runtime、结构化 `hr_business` 工具
和数据查询层共同执行；模型不要读取 policy 文件、runtime 文件或数据库配置来判断权限。

## Read vs Write

- 只读请求可以直接使用 `hr_business` 的 `list|get|analyze` 动作。
- 默认不要传 `--company`，让当前账号 policy 自动限定授权公司范围；只有用户明确指定公司时
  才传 `--company "公司全称"`。
- 新增、修改、导入、作废、清理和删除必须先 preview，并在用户明确确认后执行。
- 写入信息不完整、有歧义或有风险时，只追问继续处理必需的业务信息。
- 不要猜测 HR 事实，不要绕过 `hr_business` 直接访问数据库或通过 `exec` 调 HR business CLI。

## Matching Rules

- 写入 plan 匹配既有记录的优先级：
  1. `match_id`（首选）—— 通过 business list/get 拿到的 id；精确匹配，无歧义。
  2. 身份证号。
  3. 手机号。
  4. 姓名 + 公司 + 部门（最弱）。
- 如果智能体已经从 list/get 拿到 id，必须用 `match_id`，不要降级到业务键。
- 只在 id 不可用时使用业务键 fallback。
- If multiple records can match, stop and present candidates for user
  confirmation.
- 读取场景下，先 list 拿候选和 id，再用 `business get <resource> --id <id>` 精确读取最可靠。

## Update Rules

- Read the existing record before updating.
- Compare incoming values field by field.
- If there is no effective change, do not write.
- Do not manually set audit timestamps maintained by the database.
- Prefer reversible status changes over hard deletion unless the user is very
  explicit.

## Import Workflow

导入类任务：

1. Parse the source data.
2. Use `hr-schema` to map columns to business objects and fields.
3. 使用 `hr_business(action="schema", resource="<resource>", workflow="create|update")` 获取字段契约和示例。
4. 使用标准 `hr_business` read/preview 动作完成匹配和预览。
5. 输出简洁的确认摘要。
6. 用户确认后再执行 create、delete 或其他写入命令，最后 verify。

确认摘要需要说明：

- Goal.
- Records to create.
- Records to update.
- Records checked with no changes.
- Records that cannot be matched or require a decision.

## Access Boundaries

- 不读取 `runtime/`、`scripts/`、policy 文件、数据库配置、会话历史、audit 日志或 private 文件。
- scoped 用户的公司范围由业务 CLI 和查询层过滤，不靠提示词、memory 或模型推断。
- 越权或不确定的请求，应让 CLI/网关拒绝或要求用户补充授权范围，不要自行补全。

## Attachments

If a user indicates that an attachment is the source of truth for import or
structured entry, parse it before asking for missing fields that may already be
inside it. If the attachment is only context, treat it as reference material.

## User-Facing Style

面向 HR 员工和管理者：

- Start with a short conclusion.
- Use business language by default.
- Do not expose database IDs, raw JSON, SQL, or internal field names unless the
  user asks for technical detail.
