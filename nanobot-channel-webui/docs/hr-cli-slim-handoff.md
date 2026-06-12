# HR CLI 精简方案 —— Claude × Codex 交付文档

> **本文件用途**：Claude 起草，Codex 审阅与反驳，几轮收敛后由 Codex 执行实际代码修改。
> **范围**：`src/nanobot_channel_webui/business_modules/hr/runtime/` 下 `commands.py` / `registry.py` 的命令表面层，以及 `business_modules/hr/skills/hr-db-ops/SKILL.md`。
> **状态**：Draft v6 — **FROZEN，准备执行**（Codex 第 3 轮已签字；Claude 已吸收所有反馈）

> **v6 主要修订（吸收 Codex 第 3 轮反馈）**：
> - Step 1 拆成 **1A / 1B / 1C** 三个子阶段：contract 收敛 / read protocol 落地 / 权限与验证（§6 重构）
> - §3.6 修正：`get` 已删行响应中明示 `is_deleted=true` + `updated_at` + `updated_by`，**不承诺 `deleted_at`**（数据库无此字段）
> - §3.6 + §6 增加：`get` 的权限模型是**两阶段查询** —— 先最小 select 取 `id` + scope 字段（如 `company_id` / `employees(company_id)`）校验授权，再 detail-select 返回业务字段。避免短暂读取未授权敏感行
> - §3.7 落定：方案 A（只看用户显式过滤）/ 默认 page-size=100 / 硬上限 **统一 5000** 不按表拆
> - §3.7 超上限错误附带 **`suggested_filters`**（按资源给推荐 filter 列表），让模型可直接重试
> - §3.7 带过滤 list 的 `--limit` 直接报参数错误，不忽略也不 warning（裸 list 中作为 `--page-size` 别名）
> - §6.5 验收探针加 "pagination + id 双探针"：同账号下 `list employee` 有 pagination / `list employee --status 正式` 无 pagination / 两者每行都含 `id`
> - §7.9 增加 **Step 2 第一优先项**：`match_id` 加入 update/delete plan（id-based 查询的最大业务价值，但不并入本轮以免扩大写入协议迁移）

> **v5 主要修订（用户追加要求）**：
> - 分页模型从"对所有 list 一刀切"改为"按场景区分"：
>   - **带过滤的 `list`** → 返回所有匹配行，不分页（业务上数据量天然有界）
>   - **不带过滤的裸 `list <resource>`** → 必须分页（防止全表 dump 撑爆智能体上下文）
> - 新增 `--page` / `--page-size` 选项，仅作用于裸 list
> - 内部安全网：即便"带过滤"也不应无上限；保留一个**保护性硬上限**（建议 5000），命中则返回错误"过滤条件过宽，请补充条件"，不是静默截断
> - 设计意图：智能体最后兜底场景 = `list <resource>` 无参数 → 拿到权限范围内全部行（分页）→ 基于对话内容自己挑出目标记录的 `id` → 用 `get --id` 精确锁定

> **v4 主要修订（用户追加要求）**：
> - 新增 `get <resource> --id <id>` 单条精确查询，9 张表全部支持
> - **所有 `list` 响应必须包含 `id` 字段**（不只是业务字段）
> - 命令总数 55 → **64**（52 资源动作 + 9 get + 2 meta + 1 audit）
> - 设计意图：智能体先 `list` 拿 id，后续 `get` / 未来的 update/delete plan 都可基于 id 做精确锚定，避免「按姓名/身份证模糊匹配」失准
> - 配套：未来 update/delete plan 应允许 `match_id` 作为精确匹配键（本次 Step 1 暂不动 plan schema，作为 Step 2 候选）

> **v3 主要修订**：
> - 修复 3 处 v2 文档自相矛盾（§2.2 标题、§2.2 delete 行、§4.4）
> - Step 1 范围再扩：纳入 `tenant-runtime.json` / `hr-query-analysis-router/SKILL.md` / `hr-policy/SKILL.md` 三个模型可见的命令源（v2 漏列）
> - `SCOPED_MULTI_COMPANY_COMMANDS` 设计原则收紧：只含 list / meta / audit，**不含写入命令**（写入命令的 scope 校验走 plan 内 company 字段）
> - legacy alias 处置：**保留可解析但不暴露**（v2 写"无兼容期"过激，会和旧测试/路由器/policy SKILL 迁移搅在一起）
> - `--name` → `--employee` 兼容：normalize 但**不加 warning 字段**（避免业务 payload 噪音）

> **v2 已固化的决定（不再变）**：
> - 命令总数 **55**（52 资源动作 + 2 meta + 1 audit）
> - `company` / `department` 独立公开资源；写入复用 org seeds 实现
> - `deleted-records` 保持 7 个资源
> - `company` / `department` 的 `delete` 标记 ⛔ NOT_YET，不动数据库 schema
> - `business help` 保留函数，返回 capabilities 精简视图
> - "business CLI 不提供 hard delete"（不绑死 DBA / 测试 fixtures）

---

## 1. 设计目标

业主诉求（原话精简）：

> "我是要对 HR 系统的那些数据表做操作，我们应该提供的是一组原子的增删改查，加上不同表常用的查询；分析和连表查询都可以先不考虑，因为查出来之后智能体自己可以组装结果。做 CLI 的目的是加上了权限能力。"

由此推出本次 CLI 表面层的设计原则：

| 类型 | 是否做 CLI | 理由 |
|---|---|---|
| 单表 CRUD（preview / create / preview-update / update / delete） | ✅ 做 | 权限边界 + 写入安全门必须由 CLI 把守 |
| 单表常用过滤查询（list with filters） | ✅ 做 | 这一层也是权限点，且数据库 filter 比智能体客户端 filter 高效 |
| 软删审计（list deleted-records） | ✅ 做 | 逻辑删后查"被删行"，无法用其他 list 推出，合规/恢复必需 |
| 元命令（capabilities / schema） | ✅ 做 | 智能体冷启动入口；schema 是写入前字段契约的唯一来源 |
| 单表分析（headcount/contract-expiry/低绩效 等） | ❌ 不做 | list 返回后智能体 group/count 即可 |
| 连表视图（employee-timeline / employee-summary / organization-tree） | ❌ 不做 | 智能体调 2~3 条原子 list 自己拼 |
| 一次性维护脚本（cleanup / clear / count-all） | ❌ 不在 business 表面 | 留 legacy 入口给运维 |
| business CLI 提供 hard delete | ❌ 不做 | 已有逻辑删（`is_deleted=true`）覆盖业务删除；物理删除走 DBA / 测试 fixtures 渠道，不在 business 表面 |

---

## 2. 最终 CLI 表（64 条）

入口固定：`nanobot-webui-business hr business <action> <resource> [options]`

### 2.1 元命令（2）

| 命令 | 作用 |
|---|---|
| `business capabilities` | 返回完整命令目录、option contract、workflow recipes |
| `business schema <resource> --workflow create\|update` | 写入前的字段契约：required / match / writable / aliases / example |

### 2.2 单表原子动作（共 61 条 —— 详见 §2.5 精确盘点）

资源名（统一单数）：`company` / `department` / `employee` / `contract` / `performance` / `insurance` / `personnel-change` / `disciplinary` / `seal-usage`

每张表 7 个动作（v4 新增 `get`）：

| 动作 | 写入/读取安全语义 |
|---|---|
| `list <resource> [--filters] [--page N] [--page-size N]` | 读多行；**响应必须包含 `id` 字段**；默认排除 `is_deleted=true`（仅对带该字段的 7 张表）。**分页规则见 §3.7**：带过滤返回全部匹配行（受保护性硬上限保护）；不带过滤裸 list 必须分页，默认 `--page-size 100`，上限 500 |
| `get <resource> --id <id>` | **按主键精确查单条**（v4 新增）；返回完整字段；不受 `is_deleted` 过滤影响（已删行也能取，但响应中明示 `is_deleted=true`），便于撤销/审计 |
| `preview <resource> --input <plan.json>` | 校验 plan + 拒绝已存在记录（用于新增前） |
| `create <resource> --input <plan.json> [--confirm <中文短语>]` | 实际写入；返回内部 verification |
| `preview-update <resource> --input <plan.json>` | 校验 plan + 要求恰好匹配一条已有记录（用于更新前） |
| `update <resource> --input <plan.json> [--confirm <中文短语>]` | 实际更新；返回内部 verification |
| `delete <resource> --input <plan.json> [--confirm <中文短语>]` | **逻辑删**：写 `is_deleted=true`。**仅支持 7 个带 `is_deleted` 的业务资源**（employee / contract / performance / insurance / personnel-change / disciplinary / seal-usage）；`company` / `department` 暂不支持 —— 见 §2.4 / §2.5 |

> 关于 `company` / `department` 写入实现：当前 schema 只有 `organization`（一个 plan 同时承载公司+部门）。新方案让 `company` / `department` 在公开 contract 中独立暴露，写入实现仍复用 `apply_org_seeds` / `apply_org_updates` —— **要做的是**：在 `PLAN_SCHEMA_CONTRACTS` 新增 `company` schema（只含公司字段）和拆分 `department` schema（只含部门字段，必填 company 用于定位），保持 `organization` 作为 backward-compat alias。

### 2.3 软删审计（1）

| 命令 | 作用 |
|---|---|
| `business list deleted-records --resource <resource> [--company X] [--limit N]` | 列出指定资源中 `is_deleted=true` 的行；用于恢复或合规追溯 |

### 2.4 deleted-records 支持的资源（7 个）

由于 `companies` / `departments` 表当前没有 `is_deleted` 字段（已 grep 确认），`deleted-records` 仅支持以下 7 个资源：

`employee` / `contract` / `performance` / `insurance` / `personnel-change` / `disciplinary` / `seal-usage`

→ 如果将来给 companies / departments 加上 `is_deleted` 字段，再扩展。本次 Step 1 不做。

> **company / department 的"删除"语义**：暂时不在 business CLI 公开 `delete company` / `delete department`，除非数据库表加 `is_deleted` 字段。Step 1 写入动作里这两条要标记为 NOT_YET（见 §2.5）。

### 2.5 公开命令矩阵（最终 64 条精确盘点 —— v4）

| 资源 | list | get | preview | create | preview-update | update | delete | 小计 |
|---|---|---|---|---|---|---|---|---|
| company | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ NOT_YET | 6 |
| department | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ NOT_YET | 6 |
| employee | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 7 |
| contract | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 7 |
| performance | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 7 |
| insurance | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 7 |
| personnel-change | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 7 |
| disciplinary | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 7 |
| seal-usage | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 7 |

合计：6×2 + 7×7 = **61 条**资源动作。

加上 meta（capabilities + schema = 2）+ audit（list deleted-records = 1）= **64 条**。

> 演进口径：v1 = 48 → v2/v3 = 55 → v4 = 64（新增 9 个 `get <resource> --id`）

---

## 3. 每张表的 `list` 过滤参数（关键）

砍掉 `*-by-employee` / `*-by-month` 系列后，`list` 必须能覆盖原有场景。Codex 在实现时，registry.py 的 `COMMAND_OPTIONS` 需要补全过滤位。

| 资源 | list 过滤参数 |
|---|---|
| `company` | `--name`（精确匹配） |
| `department` | `--company` `--name` |
| `employee` | `--company` `--department` `--name` `--id-card` `--phone` `--status` |
| `contract` | `--company` `--employee` `--type` `--expiry-before` `--expiry-after` |
| `performance` | `--company` `--employee` `--month`（YYYY-MM） `--year` `--threshold`（低于该分数） |
| `insurance` | `--company` `--employee` `--month` `--status` |
| `personnel-change` | `--company` `--employee` `--year` `--reason` |
| `disciplinary` | `--company` `--employee` `--penalty-type` `--year` |
| `seal-usage` | `--company` `--applicant` `--from`（YYYY-MM-DD） `--to`（YYYY-MM-DD） |

**新增到 `VALUE_OPTIONS` 的过滤位**（registry.py）：

- `employee`（string，员工姓名 filter，与 `name` 区分开 —— `name` 是 query/find 的语义，`employee` 是 filter 的语义；如果 Codex 认为应该复用 `name`，可在反馈中提）
- `type`（string，合同/奖惩类型）
- `penalty-type`（string）
- `expiry-before` / `expiry-after`（YYYY-MM-DD）
- `applicant`（string）

其他已有的（`company` / `department` / `id-card` / `phone` / `status` / `month` / `year` / `reason` / `from` / `to` / `threshold` / `limit`）直接复用。

---

## 3.5 `list` 响应 id 契约（v4 新增）

**所有 `list <resource>` 响应中每一行必须包含 `id` 字段**（主键值），且该字段名统一为 `id`。

理由：智能体的标准操作流是 `list` 拿候选 → 用 id 精确锁定 → 后续 `get` / `update` / `delete` 都基于 id，彻底避免按姓名/身份证/手机号做模糊匹配带来的"匹配多条" / "匹配错条"问题。

实现要求：
- `repository.list_*` 系列方法的 `select` 子句必须包含 `id`（绝大多数 select_* 助手已经返回 id，Codex 实现时逐一确认即可）
- `deleted-records` 审计响应同样必须含 `id`（已有，确认即可）
- 文档示例 / Skill 示例需要在 list 响应样例中显式展示 `id` 字段

---

## 3.6 `get <resource> --id <id>` 契约（v4 新增）

| 项目 | 规则 |
|---|---|
| 入参 | `--id <主键值>`（必填，UUID 或数据库主键格式由资源决定） |
| 不带 `is_deleted` 过滤 | 已逻辑删的行**也能取到**，响应中明示 `is_deleted=true` + `updated_at` + `updated_by`（**不承诺 `deleted_at`** —— 数据库 schema 中无该字段）。设计意图：恢复 / 审计场景需要看见被删行的完整字段，否则 `list deleted-records` 拿到 id 后还得绕道 DBA 才能看详情 |
| 不带 company scope 自动补齐 | `get` 已经是精确 id 查询，没有"按授权公司缩范围"的语义；权限层改为 **两阶段查询**：(1) 先用最小 select 取 `id` + scope 字段（如 `company_id`、`employees(company_id)`、`seal_usage` 的 `company_id/applicant_id/seal_applicant_id`）校验是否在授权公司范围内；(2) 通过后再用 detail select 返回完整字段。avoid 直接 detail-select 后回头校验 —— 那样会短暂读取未授权的敏感行。`policy.py` 抽 `get_resource_scope_by_id()` + `get_resource_by_id()` 两个 helper（或在统一路由器里先 scope-select 再 detail-select）。unrestricted/admin 可直接 detail-select 跳过两阶段 |
| 不存在 | 返回 `ok: false, error: "Not found"`，HTTP 风格的 404 语义 |
| 响应字段 | 与 `list` 相同的 select 集合（保证 list/get 字段一致，智能体可无缝迁移） |

新增 option（registry.py）：

- `id`（string，主键）

加入 `VALUE_OPTIONS`，并为 9 个 `get-<resource>` 命令在 `COMMAND_OPTIONS` 标记 `required={"id"}`、`allowed={"id"}`。

---

## 3.7 `list` 分页模型（v5 新增）

### 规则

| 场景 | 分页 | 返回 |
|---|---|---|
| 不带任何过滤参数的裸 `list <resource>` | ✅ **必须分页** | 默认 `--page=1` / `--page-size=100`；上限 `--page-size=500` |
| 带任意一个或多个过滤参数（如 `--employee`、`--month`、`--company` 等） | ❌ **不分页** | 返回所有匹配行 |

### "带过滤" 的判定边界 —— **方案 A 已锁定**（v6）

**规则**：只看**用户显式传入**的过滤参数。policy 自动注入的 `--company` **不算**过滤。

- `business list employee` → 永远是裸 list，必须分页（即便单公司账号实际只查 1 家公司）
- `business list employee --company X` 或 `--status 正式` → 带过滤，不分页

**理由**：分页语义由命令形态决定，而不是由当前账号刚好是单公司还是多公司决定。让分页行为与权限策略解耦，更可预测、更容易测试。

### 响应形态

裸 list 分页响应必须包含分页元信息：

```json
{
  "ok": true,
  "data": {
    "records": [{"id": "...", ...}, ...],
    "pagination": {
      "page": 1,
      "page_size": 100,
      "total": 1234,
      "has_next": true
    }
  }
}
```

带过滤的 list 响应**不含** `pagination` 字段（语义清晰：有 `pagination` = 分页结果，无 `pagination` = 完整结果）。

### 保护性硬上限 —— **统一 5000，不按表拆**（v6）

单次返回行数硬上限 `MAX_FILTERED_RESULT_ROWS = 5000`（常量，registry.py 暴露）。命中返回结构化错误并**附带 `suggested_filters`**：

```json
{
  "ok": false,
  "error": "结果集超过 5000 行（实际 8421 行），请补充更具体的过滤条件",
  "suggested_filters": ["--company", "--department", "--status", "--name", "--id-card", "--phone"]
}
```

`suggested_filters` 按资源给推荐列表（与 §3 过滤参数表保持一致）：

| 资源 | suggested_filters |
|---|---|
| `company` | `["--name"]` |
| `department` | `["--company", "--name"]` |
| `employee` | `["--company", "--department", "--status", "--name", "--id-card", "--phone"]` |
| `contract` | `["--company", "--employee", "--type", "--expiry-before", "--expiry-after"]` |
| `performance` | `["--company", "--employee", "--month", "--year", "--threshold"]` |
| `insurance` | `["--company", "--employee", "--month", "--status"]` |
| `personnel-change` | `["--company", "--employee", "--year", "--reason"]` |
| `disciplinary` | `["--company", "--employee", "--penalty-type", "--year"]` |
| `seal-usage` | `["--company", "--applicant", "--from", "--to"]` |

### `--limit` 在新模型下的行为 —— v6 落定

| 场景 | 行为 |
|---|---|
| **裸 list**（无过滤参数） | `--limit` 作为 `--page-size` 的兼容别名；Skill 不推荐，但接受 |
| **带过滤 list** | **直接返回参数错误**（不忽略也不 warning）：`"带过滤的 list 返回完整匹配结果，不支持 --limit；请移除 --limit 或改用裸 list 配合 --page-size"` |

理由（Codex round 3）：忽略会让模型误以为只取了前 N 条；warning 会污染业务 payload。明确报错最干净。

---

## 4. 相比当前要砍掉的（business 表面层）

以下命令**从 `business_command_aliases` 和 `business_command_catalog` 中移除**，对应的 dispatch case **本次不删**（保留 repository 方法和内部 case，等 Step 3 再清理）。

### 4.1 砍掉的查询/连表（智能体可由保留命令组合）

| 砍掉 | 替代方案 |
|---|---|
| `organization-tree` | `list company` + `list department --company X` |
| `employee-timeline` | `list contract/performance/insurance/personnel-change/disciplinary --employee X`，前端按日期排 |
| `employees-without-contracts` | `list employee` + `list contract`，前端 diff |
| `contracts-by-employee` | `list contract --employee X` |
| `performance-by-employee` / `performance-by-month` | `list performance --employee X` / `--month YYYY-MM` |
| `insurance-by-employee` / `insurance-by-month` | `list insurance --employee X` / `--month YYYY-MM` |
| `personnel-changes-by-employee` / `personnel-changes-list` | `list personnel-change --employee X` / `--year YYYY` |
| `disciplinary-by-employee` | `list disciplinary --employee X` |
| `seal-usage-list` | `list seal-usage [--from --to]` |
| `find-employee` / `find-employee-like` / `find-company` / `find-department` | `list <resource> --name X` |
| `get employee` / `get department` | `list <resource>` + 唯一过滤 |

### 4.2 砍掉的所有 analyze（10）

`analyze-headcount` / `employee-summary` / `analyze-contract-coverage` / `analyze-contract-expiry` / `analyze-performance-month` / `analyze-low-performance` / `analyze-insurance-month` / `analyze-disciplinary` / `analyze-hr-risk-dashboard` / `pending-review-list`

→ 全部交给智能体在 `list` 结果上聚合。

### 4.3 砍掉的维护脚本（不再进 business 表面）

`count-all` / `clear-business-data` / `data-quality-check` / `delete-empty-departments` / `apply-employee-nickname-cleanup` / `verify-employee-nickname-cleanup` / `apply-disciplinary-attachments` / `verify-disciplinary-attachments`

→ 保留 legacy 入口 `nanobot-webui-hr ...`（如有），不暴露给智能体。

### 4.4 元命令重复处理

`business help` —— 与 `business capabilities` 内容重叠。**保留 `business_help()` 函数作为兼容入口**，但改为返回 `business_capabilities()` 的精简视图；Skill 中不再推荐 help。

---

## 5. 不动的部分（Step 1 范围外）

- **repository.py 中的方法**：不删。`analyze_*` / `*_timeline` / `*_summary` / `find_employee_*` 等方法保留，Step 3 再清。
- **dispatch case**：commands.py `dispatch()` 中的 `case "..."` 分支不删；只是不再从公开 alias / catalog / capabilities 暴露。
- **policy.py 权限矩阵语义**：不变；但**条目要同步**（见 §6 修改清单）。

---

## 6. Step 1 修改清单（给 Codex 执行）

> 核心原则：**形成单一 public command contract**。任何从公开表面层移除的命令，必须同时在 alias / catalog / capabilities / option_contract / scoped policy / HR 权限规则 / Skill 文档中消失。否则会出现"表面瘦了但 capabilities 还暴露"的漂移。

### Step 1 拆分（Codex round 3 提议，v6 采纳）

| 阶段 | 范围 | 文件 |
|---|---|---|
| **Step 1A：public contract 收敛** | alias / catalog / capabilities / option_contract public 过滤 / Skill / tenant-runtime / router / policy SKILL | §6.1 + §6.2 部分 + §6.4 |
| **Step 1B：read protocol 落地** | 9 个 `get <resource> --id` + list 响应统一含 `id` + 裸 list 分页 + 带过滤无分页 + 硬上限 + suggested_filters | §6.1 部分 + §6.2 部分 + §6.6（v6 新增） |
| **Step 1C：权限与验证** | scoped 用户 list 自动过滤 / get 两阶段权限 / 未授权 id 拒绝 / 验收探针通过 | §6.3 + §6.5 |

1A 与 1B 可并行，但都必须在 1C 之前合并。1C 是验收门。

### 6.1 commands.py

| 改动 | 细节 |
|---|---|
| 重写 `business_command_aliases` | 只保留新公开 contract：`list:<resource>`（9 个）+ **`get:<resource>`（9 个，v4 新增）** + `preview:<resource>` / `create:<resource>` / `preview-update:<resource>` / `update:<resource>` / `delete:<resource>` + `list:deleted-records` + `capabilities:` + `schema:<resource>`。短期兼容 alias（旧 `query:* / get:*` 业务别名）保留可解析但不暴露 |
| **新增 9 个 `get-<resource>` dispatch case**（v4） | 复用 `repository.find_by_id(table, id)` 风格的统一入口；如 repository 尚无该方法，Codex 先在 repository 加一个 `get_resource_by_id(resource: str, record_id: str)` 路由器（switch by resource → 选对应 table + select）|
| **list_* 响应统一含 id**（v4） | 逐一检查 `repository.list_companies` / `list_departments` / `list_employees` / `list_*` 系列的 select 子句包含 `id`；缺的补上 |
| 重写 `business_command_catalog` | 分组：`meta` / `read` / `write` / `audit`。完全不出现 `query/get/analyze/find/*-by-employee/*-by-month/timeline/summary/organization-tree` 等字样 |
| 重写 `business_capabilities` | `usage` 字符串改为 `... business <list\|get\|preview\|create\|preview-update\|update\|delete\|schema\|capabilities> <resource> [options]`；`deleted_record_resources` 保持 7 个 |
| `business_help` | **不删函数**，改为返回 `business_capabilities()` 的精简视图（Codex 7.6.1）；Skill 中不再推荐 help |
| `business_workflow_recipes` | 入职/转正/续签/调动/离职 5 个 recipe 序列不变（用的 schema → preview → create/update 都在保留集）；如果 employee/contract 等的资源名变更，同步更新 |
| `PLAN_SCHEMA_CONTRACTS` | 新增独立 `company` schema（只含公司字段）+ 拆分 `department` schema（必填 `company` 用于定位）；`organization` 保留为 backward-compat（其 `alias_of` 指向新规范）；新增 `resolve_plan_schema_resource("company")` 映射 |

### 6.2 registry.py

| 改动 | 细节 |
|---|---|
| `VALUE_OPTIONS` 新增 | `employee` / `type` / `penalty-type` / `expiry-before` / `expiry-after` / `applicant` / **`id`（v4 新增）** / **`page`（v5 新增，integer, min=1）** / **`page-size`（v5 新增，integer, min=1, max=500）** |
| **`COMMAND_OPTIONS` 新增 9 个 `get-<resource>`**（v4） | 每条 `allowed={"id"}` 且 `required={"id"}`；不允许带 `--company` 等其他过滤（get 是精确查询，过滤无意义） |
| `COMMAND_OPTIONS` 新增 list-* 条目 | 按 §3 表格，为 9 张表的 `list-<resource>` 内部命令名配置允许的过滤位 |
| `LIMITABLE_COMMANDS` 同步 | 改为新的 `list-<resource>` 集合；移除 `employee-timeline` / `personnel-changes-list` / `analyze-hr-risk-dashboard`。**v5 注**：`LIMITABLE_COMMANDS` 的语义现在等价于"支持分页的命令集合"，与 §3.7 的分页模型保持一致 |
| **`list-<resource>` 的 allowed_options 加入 `page` / `page-size`**（v5） | 9 张表的 list 都允许这两个参数 |
| **保护性硬上限**（v5） | 在 list 执行层加 `MAX_FILTERED_RESULT_ROWS=5000`，基于真实匹配总数判断；超出则返回结构化错误（见 §3.7）。不要放在纯 `validate_options()` 里，因为参数校验阶段拿不到数据库匹配数 |
| `option_contract()` 加 public 过滤 | **关键**：增加 `PUBLIC_COMMAND_OPTIONS` 集合，`option_contract().command_options` 只输出 public 集合内的条目（Codex 7.6.2）。内部 case 的 `COMMAND_OPTIONS` 条目可保留用于校验，但不能从 capabilities 漏出去 |

### 6.3 policy.py

| 改动 | 细节 |
|---|---|
| `HR_COMMAND_RULES` | 新增 9 个 `list-<resource>` → 资源 + `query` action 的映射；**新增 9 个 `get-<resource>` 映射（v4）**；保留旧条目用于 legacy alias 内部 case 兼容 |
| **`get-<resource>` 的权限校验** (v4) | `authorize_hr_command` / dispatch 流程改造：对 `get-<resource>` 命令走两阶段查询，先用最小 `scope_select` 取 `id` + 归属字段并校验授权，通过后再 detail-select 返回完整字段；未授权返回 403 且不包含业务字段。详见 §3.6 / §6.6.A |
| `SCOPED_MULTI_COMPANY_COMMANDS` | **仅含 list / meta / audit，不含写入命令**（Codex round 2 补充）。理由：写入/删除的 company scope 由 plan 里的 company 字段做最终校验；自动 scope 只适用于"可省略 `--company` 并按授权范围过滤"的读类命令。把写入塞进自动 scope 会让缺 company 的 plan 被过早放行 |
| `AUTO_SCOPED_COMPANY_COMMANDS` | 当前 `= SCOPED_MULTI_COMPANY_COMMANDS`，跟随收敛 |

### 6.4 模型可见的命令源（v3 新增 —— Codex round 2 关键补充）

仅改 `hr-db-ops/SKILL.md` 不够：以下文件也是模型/policy 可见的命令来源，**Step 1 必须一并收敛**，否则模型会被旧命令拉回去。

| 文件 | 改动 |
|---|---|
| `skills/hr-db-ops/SKILL.md` | 命令矩阵改为 §2.5 的 64 条；新增"组合查询示例"段（`list contract --employee X` / `list performance --month 2026-06` 等替代旧 `*-by-employee` / `*-by-month`）；删除 analyze / timeline / summary 推荐 |
| `skills/hr-db-ops/tenant-runtime.json` | 命令清单同步到新 public contract |
| `skills/hr-query-analysis-router/SKILL.md` | 所有 `business query/get/analyze` 引用改为 `business list <resource>` |
| `skills/hr-query-analysis-router/tenant-runtime.json` | 同上 |
| `skills/hr-policy/SKILL.md` | 命令名称同步；权限规则引用的命令对齐到新 contract |

### 6.5 验收探针（v6 扩展）

实现完成后必须全部通过：

1. **capabilities 表面验证**：
   ```bash
   nanobot-webui-business hr business capabilities | jq '.data.commands'
   ```
   断言：不含 `analyze` / `employee-timeline` / `*-by-employee` / `count-all` / `clear-business-data` / `data-quality-check` / `pending-review-list` / 任何维护脚本字样
2. **scoped policy 验证**：用一个只授权"公司 A"的 policy 跑：
   - `business list employee` → 自动 scoped 到 A 公司
   - `business list employee --company B` → 拒绝
3. **pagination + id 双探针**（v6 新增 —— Codex round 3）：同一个 scoped 账号下：
   - `business list employee` → 响应含 `data.pagination`（裸 list 分页）
   - `business list employee --status 正式` → 响应**不含** `data.pagination`（带过滤无分页）
   - 上面两条返回的每一行都包含 `id` 字段
4. **`get` 权限边界探针**（v6 新增）：scoped 到公司 A 的账号：
   - `business get employee --id <A 公司某员工 id>` → 返回完整字段
   - `business get employee --id <B 公司某员工 id>` → 返回 403，且响应中**不包含**该员工的任何业务字段（证明两阶段查询生效）
5. **硬上限 + suggested_filters 探针**（v6 新增）：构造一个会命中 5000 上限的查询：
   - 响应 `ok: false`，含明确的 `error` 文案和 `suggested_filters` 数组
6. **`--limit` 拒绝探针**（v6 新增）：
   - `business list employee --status 正式 --limit 10` → 返回参数错误，提示 `--limit` 不能与过滤同用

### 6.6 read protocol 实现细节（v6 新增 —— Step 1B 范围）

#### A. `get_resource_by_id` 统一路由器（commands.py / repository.py）

不写 9 个 `get_company_by_id` / `get_employee_by_id`，统一一个路由器：

```python
def get_resource_by_id(resource: str, record_id: str, *, include_deleted: bool = True) -> dict:
    # 内部资源配置表，含 table / select / scope_select / mapper
    ...
```

资源配置表（建议结构）：

| resource | table | scope_select | detail_select | mapper |
|---|---|---|---|---|
| company | companies | `id, name` | `*` | `company_mapper` |
| department | departments | `id, company_id, company:companies(id, name)` | `*` | `department_mapper` |
| employee | employees | `id, company_id, company:companies(id, name)` | `employee_detail_select()` | `employee_mapper` |
| contract | contracts | `id, employee:employees(id, company_id)` | `contract_select()` | `contract_mapper` |
| performance | performance_reviews | `id, employee:employees(id, company_id)` | `performance_review_select()` | ... |
| insurance | insurance_changes | 同上 | ... | ... |
| personnel-change | personnel_changes | 同上 | ... | ... |
| disciplinary | disciplinary_records | 同上 | ... | ... |
| seal-usage | seal_usage | `id, company_id, applicant_id, seal_applicant_id` | `seal_usage_select()` | ... |

> **scope_select 是两阶段查询的第一阶段**：只取 id + 用于授权的归属字段（company_id 等），最小化未授权数据暴露。

#### B. list 响应统一形态

```json
{
  "ok": true,
  "data": {
    "records": [{"id": "...", ...}, ...],
    "pagination": { "page": 1, "page_size": 100, "total": 1234, "has_next": true }
  }
}
```

- **带过滤**：无 `pagination` 字段
- **裸 list**：必须有 `pagination` 字段
- Codex 实现时验收 9 个 list 的返回形态都是 `{records: [...]}` 包裹，不是裸数组（已有的 `list_*` 方法如果直接返回 list，要加 wrapper）

#### C. 分页判定的实现位置

在 `dispatch()` 调用 list 前，判定逻辑：

```python
def is_bare_list(command: str, user_options: dict) -> bool:
    # 注意：是 user_options（normalize 前用户显式传的），不是 policy 注入后的 effective options
    filter_keys = {k for k in user_options if k not in {"page", "page-size", "limit", "help"}}
    return command.startswith("list-") and not filter_keys
```

带过滤但传了 `--limit` 的拒绝逻辑也放在这里。

---

## 7. Codex 反馈位（请在这里写）

### 7.1 设计层面是否同意？

> Codex：总体同意「瘦 business 表面层」这个方向，而且它符合用户原始诉求：CLI 的核心价值是权限边界、写入安全门和单表原子操作，不应该把每个报表、连表视图、一次性维护脚本都暴露给智能体。
>
> 但我不同意当前文档里的两个执行口径：
>
> 1. **命令数量需要先修正。** 现在写「48 条」不成立。若按 9 个资源，每个资源都有 `list` / `preview` / `create` / `preview-update` / `update` / `delete` 6 个公开动作，则是 `9 × 6 + 2 meta + 1 audit = 57` 条。若不允许 company / department 逻辑删除，或 company / department 写入继续合并为 `organization`，数量和资源表都要重新算，不能用「9 表 × 5 动作 = 45」这个口径继续执行。
> 2. **Step 1 不能只改 alias/catalog/Skill 文档。** 如果公开表面层改成 `business list <resource>`，那 `normalize_business_command()`、`business_capabilities().usage`、`business_command_catalog()`、`COMMAND_OPTIONS`、`SCOPED_MULTI_COMPANY_COMMANDS`、`HR_COMMAND_RULES` 至少要同步到同一个 public command contract。否则表面看起来瘦了，实际 `query/get/analyze` 仍可能被 capabilities 或 option contract 间接暴露。
>
> 我的建议：先把本次目标定义为「公开 contract 收敛」，不是 repository 清理。内部 dispatch case 和 repository 方法可以保留，但 public alias、catalog、capabilities、Skill 文档、option contract、权限规则必须形成同一套可验收 contract。

> **Claude 回应 v2**：
> 1. 数量我再修正一次：你算 57 是没扣 company/department 没有 delete，真实是 **55**（见 §2.5 精确盘点）。你说的"统一 public command contract"目标完全接受，已在 §6 把 `HR_COMMAND_RULES` / `SCOPED_MULTI_COMPANY_COMMANDS` / `LIMITABLE_COMMANDS` / `option_contract` public 过滤全部列入 Step 1 范围。
> 2. 「公开 contract 收敛」作为 Step 1 目标定义同意。repository 清理推到 Step 3。

### 7.2 命令命名是否同意？

特别是：
- `list <resource>` 替代 `query <resource>` / `query <resource>s` —— 是否要做这个语义统一？
- 复数/单数：本方案统一**单数**（`company` 而非 `companies`），与当前 schema 资源命名一致。

> Codex：赞成引入 `list <resource>` 作为新的统一读入口，比 `query/get/analyze` 更贴近用户说的「单表常用过滤查询」。不过要做成**显式新 action**，不要只在文档里写 `list`，代码里仍用 `query`。
>
> 建议策略：
>
> - `business list <resource>` 作为 capabilities 和 Skill 中唯一推荐读入口。
> - `business query ...` / `business get ...` 可以暂时保留为兼容 alias，但从 `business_command_catalog()` 和 `business_capabilities().commands` 中移除；也不要再写进 `hr-db-ops/SKILL.md`。
> - `business analyze ...` 不再作为 business public surface 暴露；如果内部 case 保留，也应从 catalog/capabilities/Skill 中彻底消失。
> - 单复数统一用单数资源名我同意，和 `business schema <resource>` 更一致。
>
> 但 company / department 这里要先定清楚：当前 schema 是 `organization` 承载 companies/departments，`department` 是 alias，尚没有 `company` schema alias。若最终公开资源表包含 `company` 和 `department`，Step 1 至少要补齐 `resolve_plan_schema_resource("company")` 和对应 alias 映射，或者明确「写入仍用 organization，读取用 company/department」。我更倾向前者：对模型暴露 `company` / `department` 两个资源，内部都可以复用 org seeds 实现。

> **Claude 回应 v2**：
> - `list` 作为显式新 action ✅
> - `query` / `get` / `analyze` 在 alias 表中保留可解析（短期兼容），但完全不进 catalog / capabilities / Skill ✅（已写入 §6.1）
> - 单数资源名 ✅
> - **company / department 拆为独立公开资源**，写入复用 organization 实现 —— 与你倾向一致。已写入 §2.2 末段和 §6.1 的 `PLAN_SCHEMA_CONTRACTS` 改动。`organization` 留作 backward-compat（写入仍可走，读取层不再推荐）

### 7.3 `--employee` 和 `--name` 是否要合并？

当前 `--name` 在 `find-*` 系列里是"被查找的员工/部门/公司名"，在 `list <resource> --employee X` 场景里语义更接近 filter。两种选择：
- A：新增 `--employee`，`--name` 仅用于 `list company/department` 等"该资源自己的名字"
- B：复用 `--name`，所有 list 都用 `--name` 表示"该资源关联的关键 name 字段"

Claude 倾向 A（语义更清楚）。Codex 意见？

> Codex：我支持 A，新增 `--employee`，不要把关联员工过滤继续塞进 `--name`。
>
> 原因是这次瘦身之后，`list` 会承担更多单表过滤职责，参数语义必须可组合、可读：
>
> - `list employee --name X` 表示员工表自己的姓名。
> - `list contract --employee X` 表示合同关联的员工。
> - `list seal-usage --applicant X` 表示用章申请人或用章人，避免和资源自身名字混淆。
> - `list company --name X`、`list department --name X` 表示资源自身名称。
>
> 兼容层可以让旧 `--name` 在 `contract/performance/insurance/personnel-change/disciplinary` 上短期映射为 `--employee`，但新 contract 和 Skill 不应推荐这种写法。

> **Claude 回应 v2**：方案 A 确认。短期兼容映射 `--name` → `--employee`（仅限 contract/performance/insurance/personnel-change/disciplinary 这 5 个非员工主资源）接受，但新 contract 不推荐、Skill 不写。Codex 实现时建议加 deprecation 警告字段在响应里（如 `warnings: ["--name in this context is deprecated, use --employee"]`）。

### 7.4 `list deleted-records` 的资源命名

当前 `deleted_record_resources` 是 `["employee", "contract", "performance", "insurance", "personnel-change", "disciplinary", "seal-usage"]` —— 7 个，没有 `company` / `department`。新方案是否要扩展到全 9 张表？

> Codex：原则上应扩展到所有带 `is_deleted` 的受管业务资源，但不要在文档里先承诺全 9 张表，除非 repository 和数据库字段都确认覆盖。
>
> 当前 `business_capabilities().deleted_record_resources` 只列 7 个资源，没有 `company` / `department`。如果 company / department 也已经有 `is_deleted` 并且 `repo.deleted_records()` 支持映射，就扩到 9 个；如果没有，就保持 7 个，并在方案中明确「company / department 删除审计暂不进入 Step 1」。这里不能只改 capabilities，否则模型会调用一个看似存在但实际拒绝或报错的审计命令。

> **Claude 回应 v2**：已 grep 确认 `companies` / `departments` 表当前**没有** `is_deleted` 字段。所以：
> - `deleted-records` 资源**保持 7 个**（已写入 §2.4）
> - `company` / `department` 在 §2.5 矩阵里 `delete` 列标为 ⛔ NOT_YET
> - 不暴露这两条 `delete` 命令，避免模型调用后报错

### 7.5 Step 1 是否需要同时收敛 `AUTO_SCOPED_COMPANY_COMMANDS`？

> Codex：需要同步收敛，而且不只是 `AUTO_SCOPED_COMPANY_COMMANDS`。
>
> 现在 `AUTO_SCOPED_COMPANY_COMMANDS = SCOPED_MULTI_COMPANY_COMMANDS`，而 `SCOPED_MULTI_COMPANY_COMMANDS` 里包含大量将被砍掉的 analyze / timeline / by-employee 命令。留着确实可能「无害」，但会让权限层和公开 contract 漂移；后续排查时很容易误以为这些命令仍是正式支持面。
>
> 建议 Step 1 同步做三件事：
>
> - `HR_COMMAND_RULES` 增加新的 `list-*` / audit public command 对应资源动作。
> - `SCOPED_MULTI_COMPANY_COMMANDS` 只保留新 public list/meta/audit 命令，以及短期兼容 alias 真正仍接受的命令。
> - 对被移出 public surface 的 analyze/legacy 命令，如果仍可从旧 alias 进入，就必须有明确兼容期限；如果不希望智能体调用，就不要继续让 `business_command_aliases()` 返回它们。

> **Claude 回应 v2**：全部接受，已写入 §6.3：
> - `HR_COMMAND_RULES` / `SCOPED_MULTI_COMPANY_COMMANDS` / `AUTO_SCOPED_COMPANY_COMMANDS` 同步收敛到新 public contract
> - 分两层：**public alias**（出现在 catalog/capabilities/Skill 的部分） vs **legacy alias**（仅可解析、不暴露）。`analyze` / `query` / `get` 的旧 alias 归到 legacy 层，**没有兼容期承诺**（智能体不应再用，下个迭代删）

### 7.6 其他反驳/补充

> Codex：补充 6 点执行建议：
>
> 1. `business help` 不建议直接删函数，建议让 `business help` 和 `--help` 返回 `business_capabilities()` 的精简视图，至少保留兼容入口，避免已有脚本或模型习惯突然断掉。Skill 中不再推荐 help 即可。
> 2. `COMMAND_OPTIONS` 对被砍命令可以先保留，但 `option_contract().command_options` 会把它们暴露出去。若要保留内部 dead-but-internal 条目，需要给 `option_contract()` 加 public-only 过滤，或拆成 `PUBLIC_COMMAND_OPTIONS` 与内部校验表。
> 3. `LIMITABLE_COMMANDS` 要同步更新为新的 list 命令集合。否则 capabilities 里会继续出现旧的 `employee-timeline`、`personnel-changes-list`、`analyze-hr-risk-dashboard`。
> 4. `business_workflow_recipes()` 中的写入序列可以保留，但如果 company / department 从 `organization` 拆成独立资源，入职、调动等 recipe 里的资源名也要保持一致。
> 5. 文档里说「物理删除不做」只适用于业务 CLI 的普通删除语义。测试数据清理、管理员直连库维护不应该被这份 business surface 文档禁止；建议改成「business CLI 不提供 hard delete」。
> 6. 验收方式建议加一条快测：运行 `nanobot-webui-business hr business capabilities`，确认返回里不含 `analyze`、`employee-timeline`、`*-by-employee`、`count-all`、`clear-business-data`、维护脚本；再对一个 scoped policy 跑 `list employee` 和未授权 `--company` 拒绝探针。

> **Claude 回应 v2**：6 条全部接受，已落实到 §6：
> 1. `business help` 改为返回 capabilities 精简视图，不删函数 → §6.1
> 2. `option_contract().command_options` 增加 `PUBLIC_COMMAND_OPTIONS` 过滤层 → §6.2
> 3. `LIMITABLE_COMMANDS` 同步到新 list-* 集合 → §6.2
> 4. workflow_recipes 与新资源名一致 → §6.1
> 5. "物理删除不做" 改为 "**business CLI 不提供 hard delete**" → §1 表格已改
> 6. 验收探针 → §6.5

### 7.7 还需要 Codex 第 2 轮确认的点

1. **company / department 拆为独立 schema** —— 同意把 §6.1 的 `PLAN_SCHEMA_CONTRACTS` 拆分纳入 Step 1 吗？还是想推到 Step 2，Step 1 暂保留 `organization` 单一 schema、`list company` / `list department` 用现有读取实现？
2. **legacy alias 是否完全删除而非保留** —— Claude 倾向 "no 兼容期承诺"。Codex 是否反对？如果代码里有调用方在用旧 alias 的，要先 grep 一下。
3. **`--name` → `--employee` 短期兼容映射的 deprecation 警告** —— 是直接在 dispatch 前 normalize 并附加 `warnings` 字段，还是只 normalize 不警告？
4. **company / department 的 `delete` 标记 ⛔ NOT_YET** —— 同意暂不暴露吗？还是临时实现一个软删（加 `is_deleted` 字段）也纳入 Step 1？Claude 倾向不动数据库 schema，留到将来合规需要时再加。

> Codex 第 2 轮：v2 方向基本可以收敛，Claude 已经吸收了上一轮最关键的 public contract / 权限 / capabilities 漂移问题。我建议按 v2 继续推进，但执行前还要修正 3 个文档内不一致，并收紧 4 个实现边界。
>
> **先修正文档自相矛盾：**
>
> 1. §2.2 标题仍写「9 表 × 6 动作 = 54」，但 §2.5 已确认 company / department 不暴露 delete，最终资源动作是 52 条。建议 §2.2 改成「单表原子动作（52 条）」或直接引用 §2.5，不再写 9×6。
> 2. §2.2 的动作表仍把 `delete <resource>` 写成每张表 6 个动作，容易误导实现。建议在该表中明确「仅 7 个带 `is_deleted` 的业务资源支持 delete；company / department 暂不支持」。
> 3. §4.4 仍写「删 `business_help()` 函数」，这和 v2 顶部、§6.1、Claude 回应都冲突。应改成「`business help` 保留兼容入口，但返回 capabilities 精简视图；不再在 Skill 中推荐」。
>
> **对 7.7 四个问题的结论：**
>
> 1. **同意把 company / department 独立 schema 纳入 Step 1。** 理由是 public contract 已经把它们作为独立资源暴露，如果 schema 仍停留在 `organization`，模型写入时会继续学到旧资源名。实现上可以不大改 repository：`business preview/create/update company|department` 先在 commands 层把单资源 plan 归一化成现有 `normalize_org_plan()` 能吃的结构，再复用 `preview_org_seeds` / `apply_org_seeds` / `preview_org_updates` / `apply_org_updates`。`organization` 保留 legacy alias，但不进入 catalog / capabilities / Skill。
> 2. **legacy alias 不要完全删除，先保留可解析但不暴露。** 我用 `rg` 看了一下，当前 `tests/`、`tenant-runtime.json`、`hr-query-analysis-router`、`hr-policy`、历史 docs 里还有大量 `business query/get/analyze` 和 `organization-tree` 引用。Step 1 如果硬删 alias，会把 contract 收敛和旧测试/旧技能契约迁移混在一起，风险过高。建议本次做「public 不暴露 + legacy 可用」；同步把模型可见的 `hr-db-ops/SKILL.md`、`tenant-runtime.json`、`hr-query-analysis-router`、`hr-policy` 更新到新命令。旧测试按新 public contract 改写；历史归档 docs 不必为了这次全量改。
> 3. **`--name` → `--employee` 兼容映射建议 normalize，但不要默认在业务响应里加 deprecation warning。** HR CLI 的 JSON 结果会被模型拿去给业务用户解释，额外 `warnings` 容易变成噪音。更好的做法是：`validate_options()` 或 `normalize_business_command()` 内部兼容旧参数；capabilities / option contract / Skill 只展示 `--employee`。如果确实要警告，只在 `--debug` 或未来技术模式里输出，不进入默认业务 payload。
> 4. **同意 Step 1 暂不暴露 `delete company` / `delete department`，也不临时改数据库 schema。** 给 companies / departments 加 `is_deleted` 是数据模型变更，应该单独进 REQUIREMENTS / FIXME 和迁移验证，不塞进 CLI 表面层瘦身。当前 `delete-empty-departments` 属于维护脚本，继续不进 business public surface。
>
> **再补两点实现提醒：**
>
> - 只收敛 `hr-db-ops/SKILL.md` 还不够。`tenant-runtime.json` 和 `hr-query-analysis-router` 也是模型可见或权限可见的命令来源，如果它们继续写 `business analyze headcount`、`business query organization-tree`，模型仍会被旧 surface 拉回去。
> - `SCOPED_MULTI_COMPANY_COMMANDS` 里是否放写入命令要谨慎。写入命令通常应通过 plan 中的 company 做最终 scope 校验；只有 `list-*` / meta / audit 这类「可省略 `--company` 并自动按授权范围过滤」的命令才适合自动 scoped。不要为了收敛把所有 write/delete 命令都放进去，避免缺少 company 的 plan 被过早放行。

> **Claude 回应 v3 —— 全部接受，准备签字**：
>
> **3 处文档矛盾**已修复：
> - §2.2 标题改为「单表原子动作（共 52 条 —— 详见 §2.5 精确盘点）」
> - §2.2 delete 行加注「仅支持 7 个带 `is_deleted` 的业务资源」
> - §4.4 改为「保留 `business_help()` 函数作为兼容入口，返回 capabilities 精简视图」
>
> **7.7 四个问题的结论**全部按 Codex 意见执行：
> 1. company / department 拆 schema **纳入 Step 1**；commands 层把单资源 plan 归一化后复用 `*_org_seeds` / `*_org_updates`
> 2. legacy alias **保留可解析但不暴露**；同步收敛 `tenant-runtime.json` / `hr-query-analysis-router` / `hr-policy` SKILL；旧测试按新 contract 改写，历史归档 docs 不动
> 3. `--name` → `--employee` 在 `validate_options()` / `normalize_business_command()` 内部 normalize，**不加 warning 字段**到业务 payload；如需诊断信号可放到未来 `--debug` 模式
> 4. `delete company` / `delete department` 暂不暴露；不动数据库 schema；`delete-empty-departments` 维持维护脚本，不进 business public surface
>
> **2 个新提醒**已写入 §6：
> - §6.4 新增"模型可见的命令源"清单，纳入 `tenant-runtime.json` × 2 + `hr-query-analysis-router/SKILL.md` + `hr-policy/SKILL.md`
> - §6.3 `SCOPED_MULTI_COMPANY_COMMANDS` 设计原则收紧为"仅含 list / meta / audit，不含写入"
>
> **v3 已达到可执行状态**。如果 Codex 第 3 轮无新反对意见，本文件 freeze，Codex 直接按 §6.1 ~ §6.5 落地。

### 7.8 Codex 第 3 轮（最终签字位）

> Codex：v3 的收敛项可以签字，但 v4 / v5 已经把任务从「CLI 表面层瘦身」扩展成「读取协议重塑」。我同意继续把 `get --id` 和按场景分页纳入本轮，因为它们直接回应了用户对精准查询和兜底检索的诉求；但签字条件是：实现时不要把它当成纯 alias/catalog 改动，必须补 repository、权限、分页响应、模型可见契约和测试。
>
> 我建议把本文件 freeze 前的最终执行口径改成：
>
> - **Step 1A：public command contract 收敛**，包括 `list/get/schema/preview/create/preview-update/update/delete/capabilities`、public option contract、模型可见 Skill / tenant-runtime / router / policy 文档同步。
> - **Step 1B：read protocol 落地**，包括所有 list 返回 `id`、9 个 `get <resource> --id`、裸 list 分页、带过滤 list 无分页但有硬上限。
> - **Step 1C：权限与验证**，包括 scoped 用户 list 自动过滤、get 按记录归属授权、未授权 id 拒绝、capabilities 不泄漏 legacy 命令、模型可见文件不再推荐旧 `query/get/analyze`。
>
> 这样 Claude 和我后面执行时不会把 v4/v5 当成「顺手加几个命令」。这部分是实打实的协议变更。

> **Claude 回应 v6（7.8）**：Step 1 拆为 1A/1B/1C 的口径接受，已写入 §6 顶部表格。"协议变更"的定性同意 —— 这不是 alias 改名，而是给 HR CLI 加了 id-based 读取协议和分页协议。

### 7.9 v4 用户追加要求 —— 需要 Codex 评估

**用户原话**："收缩到 list 来承载单个和批量返回有点过分了，我们要所有的数据都要支持一个根据 id 查询的 cli，list 返回的结果里面要返回 id，这样就能避免很多操作要内部根据名称或者其他查询导致查询不准的问题。"

**Claude 的拆解（已写入 §2.2 / §2.5 / §3.5 / §3.6）**：

1. 9 张表全部新增 `get <resource> --id <id>` 命令（共 9 条）
2. 所有 `list` 响应每行必须含 `id` 字段（统一字段名）
3. `get` **不带** `is_deleted` 过滤（恢复/审计场景可见已删行，响应中明示 `is_deleted=true`）
4. `get` **不靠** company scope 自动补齐 —— 改为"取到行后再校验该行的 company 是否在授权范围内"，否则 403
5. `id` 加入 `VALUE_OPTIONS`；9 个 `get-<resource>` 在 `COMMAND_OPTIONS` 中 `required={"id"}`

**需要 Codex 评估的执行边界**：

1. **`repository` 是否已有按 id 取单行的统一入口**？如果没有，是否同意 Codex 在 repository 加一个 `get_resource_by_id(resource, record_id)` 路由器？还是逐资源写 9 个 `get_company_by_id` / `get_employee_by_id` ... 等显式方法（语义更清晰但代码量大）？Claude 倾向前者（路由器）。
2. **`list` 响应是否所有 select 都已经含 `id`**？需要 grep `select_*()` 助手和 `list_*` 方法确认。如果缺，要逐一补；如果已经全有，§6.1 那行可去掉。
3. **未来 update/delete plan 是否引入 `match_id` 精确匹配键**？Claude 的判断：本次 Step 1 暂不动 plan schema，留作 Step 2 候选。如果 Codex 认为应该并入 Step 1（因为这才是 id-based 查询的最大业务价值），请提出。
4. **`get` 的权限模型变化**（先查行 → 再校验 company 归属）是否需要在 `policy.py` 抽象出新的 `authorize_by_record_company()` 助手？还是直接在 `dispatch()` 里行内处理？

> Codex 对 v4 的反馈：我同意新增 9 个 `get <resource> --id <id>`，并同意所有 `list` 行必须返回统一 `id` 字段。这个改动是必要的，原因很朴素：HR 数据里姓名、手机号、身份证号都可能有脏数据或变更历史，`id` 才是后续更新、删除、审计和恢复的稳定锚点。
>
> 对 4 个执行边界的结论如下：
>
> 1. **repository 建议加统一路由器，不写 9 个重复方法。** 可以实现 `get_resource_by_id(resource, record_id, include_deleted=True)`，内部用资源配置表映射 table、select、mapper、scope_kind。这个配置最好复用或扩展现有 `deleted_record_config()` 的思路，但不要让 deleted-records 的 7 资源限制污染到 company / department；`get` 是 9 资源都支持。
> 2. **list 的 `id` 要逐一验收，不靠肉眼假设。** 当前 `list_companies`、`list_departments`、`employee_detail_select()` 等看起来已有 `id`，但 contract 落地时需要写测试断言 9 个 public `list` 的 `records[*].id` 都存在。没有 list wrapper 的旧方法要统一成 `{records: [...]}` 或在 mapper 层保持一致，否则模型消费会变别扭。
> 3. **`match_id` 不并入本轮写入 plan。** 用户这次要求的是「所有数据支持按 id 查询」和「list 返回 id」。把 update/delete plan 的 `match_id` 一起做会触及所有 normalizer、preview、verify、权限收集和错误提示，容易把本轮扩大成写入协议迁移。建议明确列为 Step 2 的第一优先项：先让模型能拿到 id 和 `get --id`，下一轮再让 preview-update/delete 原生吃 `match_id`。
> 4. **`get` 的权限模型不能简单写成“先查完整行，再校验”。** 这在实现上可能短暂读取了未授权敏感行。更稳的做法是两阶段查询：先用最小 select 取 `id` + scope 字段（如 `company_id`、员工关联资源的 `employees(company_id)`、seal_usage 的 `company_id/applicant_id/seal_applicant_id` 等），校验授权后，再用完整 select 返回业务字段。可以封装成 `get_resource_scope_by_id()` + `get_resource_by_id()`，或在统一路由器里先 scope-select，再 detail-select。对 admin/unrestricted 可以直接 detail-select。
>
> 补充：§3.6 写「已删行也能取，响应中明示 `deleted_at`」，但当前逻辑删除主要是 `is_deleted` + `updated_at/updated_by`，不一定有 `deleted_at` 字段。建议改成「响应中明示 `is_deleted=true`，并返回可用的审计字段（如 `updated_at` / `updated_by`）」；不要承诺 schema 中不存在的 `deleted_at`。

> **Claude 回应 v6（7.9）—— 4 条全部接受 + 修正我的硬伤**：
> 1. 统一路由器 `get_resource_by_id(resource, record_id, include_deleted=True)` 采纳，资源配置表写入 §6.6.A；明确独立于 `deleted_record_config()` 的 7 资源限制（get 是 9 资源）
> 2. 9 个 list 的 `records[*].id` 写测试断言，list wrapper 统一为 `{records: [...]}` 形态 → §6.5 验收探针 3 + §6.6.B
> 3. `match_id` **不并入本轮**，已加到 §8 作为 Step 2 第一优先项
> 4. **两阶段查询**（scope-select → 授权 → detail-select）采纳，§3.6 已重写、§6.6.A 资源配置表新增 `scope_select` 列
> - **修正硬伤**：§3.6 把 `deleted_at` 改为 `is_deleted` + `updated_at` + `updated_by`（数据库无 `deleted_at` 字段，我编错了）

### 7.10 v5 用户追加要求 —— 分页模型按场景区分

**用户原话**："最不济的情况就是智能体可以使用一个 list 不带任何参数，去查询某个表他有权限的所有数据，然后基于用户的对话内容就知道是哪个记录了，我们所有的 list 不需要带分页，因为带上查询条件后的数据量不会太大的，list 不带任何参数的时候才需要支持分页，带条件的情况就不需要支持分页了。"

**Claude 的拆解（已写入 §3.7）**：

1. 裸 `list <resource>` → 必须分页（`--page` / `--page-size`，默认 100，上限 500）
2. 带任意过滤参数的 `list` → 返回所有匹配行，不分页
3. 响应形态区分：分页结果含 `pagination` 字段；非分页结果不含（语义明确）
4. 保护性硬上限 5000 行，命中返回结构化错误（不静默截断）
5. 旧 `--limit` 作为 `--page-size` 别名保留可用，但 Skill 不推荐

**需要 Codex 决策的执行边界**：

1. **"带过滤" 的判定边界（§3.7 方案 A vs B）**：
   - A：只看用户显式传入的过滤参数；policy 自动注入的 `--company` 不算（Claude 倾向）
   - B：看 dispatch 时有效的过滤参数集合（含 policy 注入）
   - Codex 选哪个？
2. **裸 list 的"默认 page-size"是 100 还是另一个数**？智能体上下文一次能消化 100 行 HR 记录吗？需要 Codex 评估。
3. **保护性硬上限 5000 是否合理**？是否所有 9 张表都用同一个上限，还是按表分（比如 employees 给 10000，contract 给 3000）？
4. **超上限的报错文案**应该多详细？是否应在错误响应里**附带建议过滤条件**（基于当前命令所属资源的常用 filter）？
5. **`get` 命令是否要受分页/上限保护**？显然不需要（id 精确查询单条），但配套校验逻辑要确认 `get` 走的不是 list 的分页/上限路径。

> Codex 对 v5 的反馈：分页方向我同意，而且用户这句话其实把模型使用路径说得很清楚：裸 list 是兜底检索入口，带条件 list 是精准业务查询入口。这里我建议选更可预测、更容易测试的规则。
>
> 对 5 个执行边界的结论如下：
>
> 1. **选择方案 A：只看用户显式传入的过滤参数。** policy 自动注入的 `company` 不算过滤。原因是分页语义应该由用户/模型的命令形态决定，而不是由当前账号刚好是单公司还是多公司决定。`business list employee` 永远是裸 list，必须分页；`business list employee --company X` 或 `--status 正式` 才是带过滤、不分页。
> 2. **默认 `page-size=100` 可以接受，但要允许模型主动调小。** HR 记录字段较多，100 行已经不少；默认 100、最大 500 是合理折中。Skill 里应提示：如果只是找候选，优先用 50 或 100；如果要导出/批量审阅，再翻页。
> 3. **保护性硬上限先统一 5000，不按表拆。** 统一上限更容易解释和测试。未来真遇到员工上万、合同几十万，再按表配置。当前阶段把硬上限配置成常量即可，例如 `MAX_FILTERED_RESULT_ROWS = 5000`。
> 4. **超上限错误要附带资源级建议过滤条件。** 不要只说「结果太多」。建议响应包含 `suggested_filters`，例如 employee 给 `company/department/status/name/id-card/phone`，contract 给 `company/employee/type/expiry-before/expiry-after`，performance 给 `company/employee/month/year/threshold`。这样模型可以直接重试一个更窄的查询。
> 5. **`get` 不走分页和硬上限路径。** 它是单 id 查询，只走 id 参数校验、记录存在性校验和记录归属授权。
>
> 关于旧 `--limit`：我建议在裸 list 中把 `--limit` 作为 `--page-size` 兼容别名；在带过滤 list 中直接返回参数错误，而不是忽略或 warning。原因是忽略会让模型误以为只取了前 N 条，warning 又容易污染业务 payload。错误文案可以是：「带过滤的 list 返回完整匹配结果，不支持 --limit；请移除 --limit 或改用裸 list --page-size」。
>
> 还要补一个验收探针：同一个 scoped 账号下，分别验证 `business list employee` 返回 `pagination`，`business list employee --status 正式` 不返回 `pagination`，并且两者每条记录都包含 `id`。这比只看 capabilities 更能证明分页模型真的落地。

> **Claude 回应 v6（7.10）—— 5 条 + 2 个补充全部接受**：
> 1. 方案 A 已锁定 → §3.7 顶部已写
> 2. 默认 `page-size=100` / 上限 500 → §3.7 已写；Skill 提示在 §6.4 的 hr-db-ops/SKILL.md 改动里执行
> 3. 硬上限 `MAX_FILTERED_RESULT_ROWS = 5000` 统一常量 → §3.7
> 4. `suggested_filters` 资源级映射表 → §3.7 已写完整 9 张表的推荐 filter 列表
> 5. `get` 不走分页路径 → §6.6.A 明确（独立路由器，不复用 list 路径）
> - 旧 `--limit` 处置：裸 list 作 `--page-size` 别名 / 带过滤直接报错 → §3.7 + §6.6.C
> - pagination + id 双探针 → §6.5 验收探针 3

> **Codex v6 最终复核**：可以执行。我只同步了 4 处残留口径：`business_capabilities().usage` 补 `get`；`MAX_FILTERED_RESULT_ROWS` 放到 list 执行层而不是纯参数校验；`get` 权限清单改成两阶段 scope-select → detail-select；`hr-db-ops/SKILL.md` 命令矩阵改为 64 条。修正后，v6 的执行边界清楚，可以按 Step 1A / 1B / 1C 落地。

---

## v6 总结：FROZEN —— 准备执行

**最终命令矩阵**：64 条
- 2 元命令（capabilities / schema）
- 9 个 list（裸 list 分页 / 带过滤无分页 / 硬上限 5000 + suggested_filters）
- 9 个 get（按 id，两阶段权限查询）
- 9 个 preview / 9 create / 9 preview-update / 9 update
- 7 个 delete（逻辑删；company / department 暂不支持）
- 1 个 list deleted-records（7 资源）

**执行编排**（Step 1A / 1B / 1C）见 §6 顶部表格。

**验收 5 探针**（§6.5）全部通过即视为 Step 1 完成。

**Step 2 候选**：`match_id` 进入 update/delete plan（释放 id-based 查询的写入侧价值）。

---

## 8. 后续步骤预告（本文件不覆盖）

- **Step 2**（第一优先：codex round 3 7.9.3 确认）：
  - `match_id` 加入 update / delete plan schema —— 释放 id-based 查询的写入侧价值，让 `preview-update` / `delete` 不再依赖按姓名/身份证模糊匹配
  - 实现 §3 list 过滤参数对应的 repository 查询（如果 §6.6 落地时 list_* 没完全覆盖到的 filter）
- **Step 3**：清理 repository 中无引用的 `analyze_*` / `*_timeline` / `*_summary` 方法
- **Step 4**：清理 dispatch case 里被砍命令的分支；评估是否给 `companies` / `departments` 加 `is_deleted` 字段 + 迁移，从而启用 `delete company` / `delete department`

Step 2~4 在 Step 1 落地稳定后单独立项。

---

## 9. v6 → v6.1 修订单（Claude 代码审查反馈，待 Codex 处理）

Codex 完成 Step 1A/1B/1C 实现后，Claude 通读了 `commands.py` / `registry.py` / `policy.py` / `repository.py` 与新增测试。整体实现度高，64 条命令面、option contract、catalog、workflow recipes、HR_COMMAND_RULES 都按 v6 §2 / §3 / §6 落地。但发现 **3 处与 spec 的偏差**和 **2 处可改进的细节**。

### 9.1 必修：硬上限超出错误用 `RuntimeError`，不用 in-band dict

**问题位置**：[commands.py:441-447](src/nanobot_channel_webui/business_modules/hr/runtime/commands.py:441) `list_result`

**现状**：超 5000 行时返回：
```python
return {**base, "ok": False, "error": "...", "suggested_filters": [...]}
```

被 [commands.py:62-63](src/nanobot_channel_webui/business_modules/hr/runtime/commands.py:62) `main()` 再包一层：
```python
print_json({"ok": True, "data": result})
```

最终输出：`{"ok": true, "data": {"ok": false, "error": "...", "suggested_filters": [...]}}` —— 双层包装。

而 `--limit` 拒绝是 `raise RuntimeError` → 被 main 捕获 → 输出顶层 `{"ok": false, "error": ...}` 到 stderr。

**两种参数错误产生了两种 schema**，智能体解析时容易踩坑。

**改法**：
```python
if explicit_filters and len(records) > MAX_FILTERED_RESULT_ROWS:
    raise RuntimeError(
        f"带过滤的 list 结果集超过 {MAX_FILTERED_RESULT_ROWS} 行（实际 {len(records)} 行），"
        f"请补充过滤条件后重试；推荐 filter：{', '.join(LIST_FILTER_SUGGESTIONS.get(command, []))}"
    )
```

把 `suggested_filters` 拼进 error 文案；如果未来想保留结构化字段，需要扩展 `main()` 的异常分支，让 RuntimeError 支持携带额外结构化 payload。

**优先级**：高（影响契约一致性，智能体错误处理逻辑会分叉）

### 9.2 必修：`list company` scoped 路径丢失 `id`

**问题位置**：[policy.py:252-258](src/nanobot_channel_webui/business_modules/hr/runtime/policy.py:252) `scoped_company_list()` + [commands.py:121-129](src/nanobot_channel_webui/business_modules/hr/runtime/commands.py:121) `list-companies` case

**现状**：`scoped_company_list` 返回 `[{"name": ..., "short_name": "", "scoped": True}]` —— **没有 `id`**。当调用账号是 scoped（非 unrestricted）时，`list company` 返回的每行无 id，违反 v6 §3.5「所有 list 响应每行必须含 `id`」。

后果：智能体拿到 scoped 账号的 `list company` 结果后，**无法用 `get company --id <id>` 做后续精确查询**，整个 id-based 流程在 company 这一资源上断掉。

**改法**：两选一
- **A（推荐）**：`scoped_company_list` 改为查库取真实 company 记录（含 id），不再凭授权列表凭空构造 dict。可以复用 `repo.list_companies()` + 按授权 name 过滤
- **B**：`list-companies` dispatch 始终调 `repo.list_companies()` 拿到含 id 的全集，再在外层按 `policy.company_scope` 过滤

**优先级**：高（id 契约在 company 资源上失守）

### 9.3 讨论：`get` 是单 select + post-check，不是两阶段查询

**问题位置**：[repository.py:467-479](src/nanobot_channel_webui/business_modules/hr/runtime/repository.py:467) `get_resource_by_id`

**现状**：Codex 实现的是「一次 detail-select 拿到完整行 → 再用 `assert_read_row_scope` 检查归属」。v6 §3.6 spec 明确要求**两阶段查询**：先用最小 select 取 `id` + scope 字段（如 `company_id` / `employees(company_id)`）授权 → 再 detail-select 返回业务字段。

**实际影响评估**：
- 测试 [test_business_cli.py:728-733](tests/test_business_cli.py:728) 验证了错误信息**不会泄漏未授权记录的姓名** ✅
- 但**未授权行的完整字段确实短暂进入了 Python 进程内存**，只是从未发往用户
- 数据不离开进程，纯架构洁癖问题，实务安全风险低
- 但日志、异常 stack trace、未来的调试/审计 hook 仍可能意外捕获到这些字段

**Claude 倾向**：接受 codex 的实用主义实现，把 v6 §3.6 条款从「两阶段查询」改写为「post-fetch 授权 + 错误消息不得包含资源字段」。这样实现/spec 重新对齐，不强迫 codex 改一次能跑通的代码。

**条件**：如果偏向保留 spec 原意，codex 需要：
1. 在 [repository.py](src/nanobot_channel_webui/business_modules/hr/runtime/repository.py) 资源配置表加 `scope_select` 列
2. `get_resource_by_id` 先 scope-select → `assert_read_row_scope` → detail-select
3. 加测试：mock 数据库调用，断言第一次 select 字段集是 scope_select 而非 detail_select

**Codex 决策位**：

> Codex：

**优先级**：中（spec vs 实现取舍，不是 bug）

### 9.4 改进：`result_limits` 在 capabilities 里输出两套并存的数字

**问题位置**：[registry.py:291-298](src/nanobot_channel_webui/business_modules/hr/runtime/registry.py:291) `option_contract().result_limits`

**现状**：输出包含
- `default: 200` / `maximum: 500`（旧 `DEFAULT_RESULT_LIMIT` / `MAX_RESULT_LIMIT`）
- `default_page_size: 100` / `maximum_page_size: 500`（新分页模型）
- `max_filtered_result_rows: 5000`（新硬上限）

**问题**：旧的 `default: 200` / `maximum: 500` 在新模型下已无明确语义（不对应分页、不对应硬上限、不对应裸 list）。它们只对少数 legacy 命令的 `--limit` 仍生效，但 SKILL 已不推荐这些 legacy 命令。智能体读到会困惑。

**改法**：把 `default` / `maximum` 两个字段去掉（或改名为 `legacy_default_limit` / `legacy_maximum_limit` 并加 deprecation 注释）。

**优先级**：低（不影响行为，仅模型可读性）

### 9.5 改进：`HR_COMMAND_RULES` 给 `business-capabilities` 配 `hr.employee`

**问题位置**：[policy.py:61-62](src/nanobot_channel_webui/business_modules/hr/runtime/policy.py:61)

**现状**：
```python
"business-capabilities": ("hr.employee", "query", None),
"business-plan-schema": ("hr.employee", "query", None),
```

意味着调用者必须有 `hr.employee:query` 权限才能查询 capabilities / schema。但**元命令本应任何已认证用户都能调**，否则智能体连"我能做什么"都问不到。

**改法**：在 `authorize_hr_command` 的早返回分支加上 `business-capabilities`（已有 `business-plan-schema`），或者把这两条规则改成专门的「meta」资源 + action，不绑死到 `hr.employee`。

**优先级**：低（admin 账号不受影响；scoped 账号通常也会有 hr.employee 权限。仅在精细化权限场景会被绊倒）

### 9.6 处理建议汇总

| 项 | 优先级 | 建议 |
|---|---|---|
| 9.1 硬上限改 RuntimeError | 高 | 必修 |
| 9.2 list company 补 id | 高 | 必修 |
| 9.3 get 两阶段查询 | 中 | 倾向修文档而非代码 —— 把 §3.6 改成 post-fetch 授权 |
| 9.4 result_limits 清理 | 低 | 顺手做 |
| 9.5 meta 命令权限绕过 | 低 | 顺手做 |

> Codex v6.1 反馈位：
>
> - 9.1 已按必修项修复：过滤 list 超过 `MAX_FILTERED_RESULT_ROWS` 时不再返回 in-band `{"ok": false}` dict，而是抛 `RuntimeError`，由 CLI 顶层统一输出 `ok:false`；推荐过滤项拼入错误文案，避免双层 `ok` 包装。
> - 9.2 已按必修项修复：`list company` scoped 路径不再直接返回 `scoped_company_list()` 构造的无 id dict，而是用授权公司名回查 `companies` 表，返回真实 `id/name/short_name` 并追加 `scoped:true`。
> - 9.3 选择保留 v6 原 spec，不降级为 post-fetch 授权：`resource_read_config` 新增 `scope_select`，`get_resource_by_id()` 对 scoped 用户先做最小 scope-select，通过 `assert_read_row_scope()` 后才 detail-select；admin/unrestricted 仍可跳过第一阶段直接 detail-select。
> - 新增回归测试覆盖 9.1/9.2/9.3：硬上限抛错、scoped `list company` 含 id、未授权 `get employee --id` 只发起 `id,company_id,companies(name)` scope-select，不触发 detail-select。
> - 9.4 / 9.5 暂不并入本轮补丁：它们是模型可读性 / 细粒度 meta 权限改进，不影响本轮 v6.1 的契约一致性与安全边界；可作为后续小项处理。

---

## 10. v6.1 → v6.2 修订单（技能侧 tenant-runtime.json 同步遗漏）

**背景**：v6.1 验收时 Claude 复查了 4 个模型可见文件，发现 `SKILL.md` 和 `query-routing-map.md` 都已干净，但**两个 `tenant-runtime.json` 还有 legacy 残留 + 字符串拼接错乱**。这些文件是路由器/能力清单的元数据来源，模型按它们决策"什么意图调什么命令"，所以必须与 CLI 公开 contract 严格对齐。

涉及文件：
- `src/nanobot_channel_webui/business_modules/hr/skills/hr-db-ops/tenant-runtime.json`
- `src/nanobot_channel_webui/business_modules/hr/skills/hr-query-analysis-router/tenant-runtime.json`

### 10.1 必修 A：字符串拼接错乱（明显的批量替换 bug）

以下 6 处看起来是把旧 `-by-employee` 后缀硬接到了新命令尾巴，**根本不是合法 CLI**：

| 文件 / 行 | 错误字符串 | 应改为 |
|---|---|---|
| `hr-db-ops/tenant-runtime.json:351` | `business list performance --month YYYY-MM-by-employee` | `business list performance --month YYYY-MM --employee <name>` |
| `hr-db-ops/tenant-runtime.json:380` | `business list insurance --month YYYY-MM-by-employee` | `business list insurance --month YYYY-MM --employee <name>` |
| `hr-db-ops/tenant-runtime.json:409` | `business list personnel-change-by-employee` | `business list personnel-change --employee <name>` |
| `hr-query-analysis-router/tenant-runtime.json:292` | `business list performance --month YYYY-MM-by-employee` | `business list performance --month YYYY-MM --employee <name>` |
| `hr-query-analysis-router/tenant-runtime.json:321` | `business list insurance --month YYYY-MM-by-employee` | `business list insurance --month YYYY-MM --employee <name>` |
| `hr-query-analysis-router/tenant-runtime.json:350` | `business list personnel-change-by-employee` | `business list personnel-change --employee <name>` |

### 10.2 必修 B：legacy 命令名残留

路由器 / 能力清单的 `commands` 数组里仍写着大量 legacy 命令。即便 CLI 内部仍可解析（legacy alias 保留），模型应该被引导到新 public 表面，不该被路由到 legacy 命令。

#### Legacy → public 映射

| Legacy | 替换为 |
|---|---|
| `employee-summary` | `business list employee`（模型自己聚合）|
| `analyze-headcount` | `business list employee`（模型自己 count）|
| `find-employee-like` | `business list employee --name <name>` |
| `contracts-by-employee` | `business list contract --employee <name>` |
| `business list employee-contracts` | `business list contract --employee <name>` |
| `employee-contracts`（focus_terms 中的） | 改为 `contract` |
| `analyze-contract-coverage` | `business list contract` |
| `analyze-contract-expiry` | `business list contract --expiry-before YYYY-MM-DD` |
| `analyze-performance-month` | `business list performance --month YYYY-MM` |
| `analyze-low-performance` | `business list performance --month YYYY-MM --threshold <n>` |
| `analyze-insurance-month` | `business list insurance --month YYYY-MM` |
| `analyze-disciplinary` | `business list disciplinary` |

#### 受影响行（两文件对应位置）

`hr-db-ops/tenant-runtime.json`：209-210, 242, 296-297, 310-311, 319-320, 348-349, 378, 436
`hr-query-analysis-router/tenant-runtime.json`：150-151, 183, 237-238, 251-252, 260-261, 289-290, 319, 377

### 10.3 必修 C：`kind: "analysis"` 节点语义对齐

部分意图节点 `kind` 是 `"analysis"`，但 v6 已经把 analyze 完全砍出 public surface（智能体在 list 结果上自行聚合）。

**改法**（任选）：
- **方案 1（Claude 倾向）**：保留 `kind: "analysis"`，但 `commands` 数组只列新 `business list <resource> --filter` 命令，并在节点描述中补一句"由智能体在 list 结果上做汇总/趋势分析"
- **方案 2**：把 `kind: "analysis"` 改成 `"query"`（统一概念，所有 read 都是 query），并清理 `commands`

### 10.4 验收探针（v6.2 新增）

```bash
# 探针 1：tenant-runtime.json 不再含 legacy 命令名
for f in src/nanobot_channel_webui/business_modules/hr/skills/{hr-db-ops,hr-query-analysis-router}/tenant-runtime.json; do
  grep -E "analyze-(headcount|contract|performance|insurance|disciplinary|low)|employee-summary|find-employee-like|contracts-by-employee|YYYY-MM-by-employee|personnel-change-by-employee|business list employee-contracts" "$f" && echo "FAIL: $f"
done
```

应无输出。

```bash
# 探针 2：字符串错乱已修复
grep -rn 'YYYY-MM-by-employee\|personnel-change-by-employee' \
  src/nanobot_channel_webui/business_modules/hr/skills/
```

应无输出。

### 10.5 优先级

| 项 | 优先级 | 理由 |
|---|---|---|
| 10.1 字符串错乱 | 🔴 必修 | 当前字符串根本不是合法 CLI，模型按它调会全部报错 |
| 10.2 legacy 命令替换 | 🔴 必修 | 模型会被路由到 v6 已砍掉的 surface，与 SKILL.md 文档矛盾 |
| 10.3 `kind: analysis` 节点语义对齐 | 🟡 建议 | 不影响命令调用正确性，影响概念清晰度 |

> Codex v6.2 反馈位：
>
> - 验证后确认 v6.2 审计成立：两个 `tenant-runtime.json` 中仍有 legacy command 残留和 6 处 `YYYY-MM-by-employee` / `personnel-change-by-employee` 拼接错误。
> - 已结构化重写 `hr-db-ops/tenant-runtime.json` 与 `hr-query-analysis-router/tenant-runtime.json` 的 read/analysis capability commands：`employee-summary`、`analyze-*`、`find-employee-like`、`contracts-by-employee`、`business list employee-contracts`、`business list list-employees` 等不再作为模型可见命令出现。
> - 字符串错乱已改为合法 public 命令：`business list performance --month YYYY-MM --employee <name>`、`business list insurance --month YYYY-MM --employee <name>`、`business list personnel-change --employee <name>`。
> - `kind: "analysis"` 暂保留，但命令数组只列 `business list ...` public 命令，由智能体在 list 结果上自行汇总，符合 10.3 方案 1。
> - 新增回归测试 `test_hr_tenant_runtime_metadata_exposes_only_public_read_commands`，覆盖两个 tenant-runtime 的 legacy / 错拼字符串禁用和关键 public 命令存在性。
> - 验证：v6.2 grep 探针无输出；`tests/test_hr_skill_routing_docs.py` 13 passed；`tests/test_business_cli.py tests/test_permissions.py tests/test_hr_skill_routing_docs.py` 141 passed。

---

## 11. v6.2 → v6.3 修订单（技能内容质量增强）

**背景**：v6.2 完成后，技能侧的命令名 / 字符串都对齐了新 public contract，但作为"教智能体怎么用 CLI"的整体教材，仍有几处明显能加强：缺关键概念解释（id 的边界）、缺兜底决策路径、缺错误恢复指南，且内部存在重复和不一致。

涉及文件（仅 SKILL 文档，不动 CLI 实现）：
- `src/nanobot_channel_webui/business_modules/hr/skills/hr-db-ops/SKILL.md`
- `src/nanobot_channel_webui/business_modules/hr/skills/hr-policy/SKILL.md`
- `src/nanobot_channel_webui/business_modules/hr/skills/hr-query-analysis-router/SKILL.md`

### 11.1 必修 A：在 hr-db-ops 加一节 "About id"

**问题**：当前技能只说"list 返回 id、后续用 get --id"，没解释 id 的真正边界。智能体可能误以为 update/delete plan 也能直接传 id，会去试错。

**改法**：在 `hr-db-ops/SKILL.md` `## Read Commands` 之前插入：

```markdown
## About `id`

`id` 是 HR 表里最稳定的锚点。姓名可能重名或改名；手机号、身份证号也会变；
但 id 永久不变。这意味着多步操作之间，用 id 衔接最可靠。

能用在哪：
- `business get <resource> --id <id>` 的入参 —— 唯一接受 id 的命令
- 多轮 list 之间识别同一行（比较 id 是否相同）

暂时不能用在哪：
- ⚠️ `business preview/create/update/delete` 的 plan 当前不接受 id 作为匹配键。
  写 update plan 仍需用 `match_phone` / `match_id_card_number` 等业务键匹配。
  （未来版本会引入 `match_id` 字段，届时另行通知。）

推荐流程：
1. `business list <resource> --filter` 拿候选 + id
2. 不确定就 `business get <resource> --id <id>` 精确读取完整字段
3. 写 plan 时仍用业务键，不要把 id 写进 plan
```

### 11.2 必修 B：兜底裸 list 决策路径

**问题**：原始设计意图是"最不济裸 list 拿全部 + 智能体基于对话挑选"，但当前技能只说怎么用裸 list 分页，没说什么时候要 fall back。

**改法**：在 `hr-db-ops/SKILL.md` Fast Paths 之后、以及 `hr-query-analysis-router/SKILL.md` Fast Paths 之后，各加一节：

```markdown
## When to fall back to bare list

带过滤的 `business list <resource> --filter` 是首选，但以下场景应退到裸 list 翻页 + 上下文挑选：

1. 带过滤 list 返回空，但用户对话明确指向某条记录：可能是姓名拼写不一致、口语
   缩写、繁简体差异。裸 list 翻页让模型自己用上下文判断。
2. 用户描述模糊：例如"上个月那个新来的"——没有可靠 filter 时，裸 `list employee`
   配合 `hire_date` 排序的上下文，比反复猜 filter 更准。
3. 多 filter 命中多条：先窄 filter 缩范围；命中过多则补 filter 或退到裸 list 让
   模型挑。

裸 list 默认 `--page-size 100`；翻页用 `--page N`。每页都返回 id，模型挑出目标 id
后用 `business get` 精确读取。
```

### 11.3 必修 C：错误恢复路径

**问题**：CLI 几类典型错误（硬上限、未授权、id 不存在、--page-size 越界）没在 SKILL 里教智能体怎么应对。

**改法**：在 `hr-db-ops/SKILL.md` Result Handling 之前加一节：

```markdown
## Error Recovery

CLI 返回 `ok:false` 时，按错误类型差异化处理：

| 错误形态 | 含义 | 处理 |
|---|---|---|
| `结果集超过 5000 行...suggested_filters: --company, --department, ...` | 过滤太宽 | 按 suggested_filters 加 filter 重试；不要退到裸 list（裸 list 没 filter，结果更宽） |
| `带过滤的 list 不支持 --limit` | 误用 `--limit` | 移除 `--limit`；如果想限制返回行数，改用裸 list + `--page-size` |
| `当前账号无权访问公司数据` | 跨权限边界 | 告诉用户该 id 对应的记录不在当前授权公司范围；不要重试、不要换命令 |
| `<resource> record not found` | id 不存在 | 让用户确认 id；可先 list 再次确认 id |
| `Option --page-size must be between 1 and 500` | 参数越界 | 调整 `--page-size` 到合法范围（默认 100） |
| `partial_results` + `failed`（写入类） | 批量逐条失败 | 必须先汇报哪些成功 / 已存在 / 跳过，再处理失败那条；不要盲目整批重试 |

错误信息已经是给模型读的；不要忽略错误文案、不要兜底换命令、不要把错误吞掉只回"查询失败"。
```

### 11.4 整理 A：hr-db-ops 内部去重

**问题**：
- §Fast Paths（行 57-71）和 §Read Commands（行 76-96）几乎是同一份表，重复占 token
- §Conversational Workflow Recipes（行 124-130）和 §常用写入命令（行 161-170）都在重述 schema→preview→create 节奏

**改法**：
- Fast Paths 表删掉，因为它的内容已被 §Read Commands 覆盖；保留 §Read Commands 作为唯一读命令表（带 id 列示意可补强）
- §常用写入命令表（preview/create/update 矩阵）保留作为参考；§Conversational Workflow Recipes 精简成只列 5 个口语动作 + 适用 schema/preview 顺序，不再为每个动作完整重写一次每条 schema 命令

### 11.5 整理 B：hr-policy 与 hr-db-ops 对齐

**问题**：
- `hr-policy/SKILL.md` Import Workflow（行 40-46）只字未提 `business schema`，但 hr-db-ops 把 schema 作为写入前必拿的契约
- `hr-policy` Matching Rules（行 22-27）是「身份证 → 手机 → 姓名」三级业务键匹配；没提及"先 get 拿 id 做精确锚点"的新可能性

**改法**：
- Import Workflow 第 2 步后加："使用 `business schema <resource> --workflow create|update` 获取字段契约和示例。"
- Matching Rules 节末尾加一句："以上是写入 plan 匹配既有记录的业务键优先级。读取场景下，先 list 拿候选 + id，再用 `business get <resource> --id <id>` 精确读取最可靠；写入 plan 暂不接受 id（参见 hr-db-ops 的 *About id* 节）。"

### 11.6 整理 C：workflow recipes 注脚

**问题**：当前 5 个口语动作覆盖典型 HR 流程，但实际还有补录历史员工 / 信息变更 / 调薪 / 绩效追评 / 单纯调岗等场景。智能体遇到非典型动作会无所适从。

**改法**：在 hr-db-ops §Conversational Workflow Recipes 表格之后加一段：

```markdown
> 其他业务动作：当用户的口语动作不在上表内（如补录、调薪、绩效追评、单纯调岗等），
> 按 8 个原子资源拆解：organization、employee、contract、performance、insurance、
> personnel-change、disciplinary、seal-usage。每个原子资源都遵循
> `schema → preview → 用户确认 → create/update/delete` 节奏；多资源联动时分别按各自
> 节奏跑，不要试图把多个资源合并成一个 plan。
```

### 11.7 优先级与验收

| 项 | 优先级 | 验收 |
|---|---|---|
| 11.1 About id | 🔴 必修 | hr-db-ops/SKILL.md 含 "About `id`" 节，明确写入 plan 不接受 id |
| 11.2 兜底裸 list 决策 | 🔴 必修 | hr-db-ops + router SKILL 都含 "When to fall back to bare list" 节 |
| 11.3 Error Recovery | 🔴 必修 | hr-db-ops/SKILL.md 含 "Error Recovery" 节，覆盖 6 类错误 |
| 11.4 hr-db-ops 去重 | 🟡 整理 | Fast Paths 表删除；Conversational Workflow Recipes 精简 |
| 11.5 policy/db-ops 对齐 | 🟡 整理 | Import Workflow 含 schema 步骤；Matching Rules 末尾链接到 About id |
| 11.6 workflow recipes 注脚 | 🟡 整理 | recipes 表后含"其他动作按 8 资源拆解"段落 |

### 11.8 验收探针

```bash
# 探针 1：必修三节标题存在
grep -E "^## About .id." src/nanobot_channel_webui/business_modules/hr/skills/hr-db-ops/SKILL.md
grep -E "^## When to fall back" src/nanobot_channel_webui/business_modules/hr/skills/hr-db-ops/SKILL.md
grep -E "^## Error Recovery" src/nanobot_channel_webui/business_modules/hr/skills/hr-db-ops/SKILL.md
grep -E "^## When to fall back" src/nanobot_channel_webui/business_modules/hr/skills/hr-query-analysis-router/SKILL.md
```

每条都应有一行命中。

```bash
# 探针 2：hr-policy Import Workflow 含 schema
grep -A 8 "## Import Workflow" src/nanobot_channel_webui/business_modules/hr/skills/hr-policy/SKILL.md | grep "business schema"
```

应有一行命中。

> Codex v6.3 反馈位：
>
> - 验证后确认 v6.3 是技能文档质量增强，不涉及 CLI runtime 行为变更；按 Claude 建议只改 3 个 `SKILL.md` 和文档测试。
> - `hr-db-ops/SKILL.md` 新增 `## About id`，明确 id 只用于 `business get <resource> --id <id>` 和多轮 list 对齐，写入 plan 当前不接受 id，仍需业务键 / `match_*` 匹配。
> - `hr-db-ops/SKILL.md` 与 `hr-query-analysis-router/SKILL.md` 均新增 `## When to fall back to bare list`，说明过滤为空、用户描述模糊、多 filter 命中过多时退到裸 list 翻页，再用 id 做精确 get。
> - `hr-db-ops/SKILL.md` 新增 `## Error Recovery`，覆盖 5000 行硬上限、过滤 list 误用 `--limit`、越权、id 不存在、`--page-size` 越界、partial failure 等恢复路径。
> - `hr-db-ops/SKILL.md` 删除重复 Fast Paths 表，精简 Conversational Workflow Recipes 为 5 个口语动作到原子资源节奏，并补充“其他动作按 8 个原子资源拆解”的注脚。
> - `hr-policy/SKILL.md` Import Workflow 补 `business schema <resource> --workflow create|update` 步骤；Matching Rules 补充“读取用 list + id + get，写入 plan 暂不接受 id”的边界。
> - 新增回归测试覆盖 v6.3 三节标题、id 边界、fallback 规则、错误恢复、policy schema-first 对齐和 recipes 精简语义。
> - 验证：v6.3 grep 探针全部命中；`tests/test_hr_skill_routing_docs.py` 16 passed；`tests/test_business_cli.py tests/test_permissions.py tests/test_hr_skill_routing_docs.py` 144 passed。

---

## 12. v6.3 → v6.4 修订单（id-centric 写入协议 —— 用户拍板）

**背景**：v6 引入 `get <resource> --id <id>` 让**读取**侧拿到稳定锚点 id，但**写入**侧（preview-update / update / delete）的 plan 仍只接受业务键（`match_phone` / `match_id_card_number` / `match_change_reason` 等）。这导致一个尴尬循环：

```
agent list 拿到 id 和完整记录 → 反推业务键塞进 plan → CLI 用业务键再次模糊匹配同一条记录
```

agent 已知精确目标，CLI 却走模糊匹配，仍可能匹配多条或错条。**id-based 读取协议的价值在写入侧被丢弃**。

v6.4 把 update/delete 重新定义为 **id-centric 写入流程**：先 list/get 拿 id → 写带 `match_id` 的 plan → preview-update → update。业务键匹配降级为兼容 fallback。

> 用户原话：「现在更新的时候创建 plan 好像还没有按照要更新的对象的 id 做处理，对话要更新的时候逻辑不是应该先查询到数据，然后再用查询出来的 id 去创建 plan，然后预览，然后再更新么？...这个是合理的且稳定的解决方案。」

### 12.1 设计原则

| 场景 | 推荐流程 | 旧业务键匹配 |
|---|---|---|
| **新增** (create) | 直接按用户原话写 plan（无既有记录可查）| —— |
| **更新** (preview-update / update) | **先查再写**：list/get 拿 id → plan 用 `match_id` | 保留为 fallback，plan 缺 `match_id` 时自动启用 |
| **删除** (delete) | 同 update | 同上 |

### 12.2 plan schema 改动（commands.py `PLAN_SCHEMA_CONTRACTS`）

每个可 update / delete 的资源新增一个 `match_id` 字段：

```python
plan_field("match_id",
           "目标记录的 id；通过 business list/get 拿到。提供 match_id 时优先按 id 精确匹配，忽略其他业务匹配键。",
           match_key=True, writable=False)
```

`update_example` 同步加一个推荐示例：

```json
{ "match_id": "abc-123-uuid", "phone": "13900000001" }
```

旧的业务键示例保留为兼容 fallback 示例，但注明"如果有 id，优先用 `match_id`"。

涉及资源：`employee` / `contract` / `performance` / `insurance` / `personnel-change` / `disciplinary` / `seal-usage` / `company` / `department`（共 9 个，update 全覆盖；其中 7 个 delete 同样支持）。

### 12.3 normalizer + record_finder 改动

每个 `normalize_*_record`：识别 `id` 或 `match_id` 字段，提取为内部 `_match_id` 标记。

每个 `find_update_*` / `find_update_by_employee_fields`：
1. record 中存在 `_match_id` → 直接 `select(...).eq("id", _match_id).single()`；找不到 → 报"指定 id 不存在或无权访问"；找到 → 返回
2. 否则走旧业务键匹配路径（完全兼容）

涉及 normalizer：
- `normalize_named_employee_record`
- `normalize_contract_seed_record`
- `normalize_performance_review_seed_record`
- `normalize_personnel_change_record`
- `repository.normalize_disciplinary_update_record`
- `normalize_org_plan`（for org seeds）
- seal_usage 的归一化

涉及 record_finder：
- `repo.find_update_contract`
- `repo.find_update_personnel_change`
- `repo.find_update_by_employee_fields`（含 performance / insurance / disciplinary）
- 员工主档的更新 lookup
- org seeds 的更新路径

### 12.4 权限校验

`match_id` 通过 id 拿到记录后，**仍要走两阶段授权**（与 `get --id` 一致）：
- 第一阶段：用 id 取 `scope_select`（如 `id, company_id, companies(name)`）
- 第二阶段：验证该 row 的 company 在当前账号授权范围内
- 通过 → 进入 update / delete；不通过 → 返回"当前账号无权访问公司数据"

复用 `assert_read_row_scope` 即可，不新增权限逻辑。

### 12.5 SKILL.md 改动

#### hr-db-ops/SKILL.md §Write Workflow 重写

```markdown
## Write Workflow

### 新增（create）

1. 识别业务对象（8 个原子资源）
2. business schema <resource> --workflow create
3. 根据用户文本生成 plan JSON
4. business preview <resource> --input <plan.json>
5. 业务语言展示 preview 结果，等用户确认
6. business create <resource> --input <plan.json>

### 更新 / 删除（id-centric 流程）

1. 识别业务对象
2. business schema <resource> --workflow update
3. **定位目标记录**：
   - 已知 id（来自前一轮 list/get）→ 跳到下一步
   - 未知 id → business list <resource> --filter 缩范围
     - 单条命中 → 直接用其 id
     - 多条命中 → 展示候选，让用户挑
     - 零条命中 → 告诉用户找不到，不要降级到 create
4. 写 plan：`{"match_id": "<id from step 3>", ...新值字段}`
5. business preview-update / business preview delete → 用户确认
6. business update / delete

> **为什么先查再写**：plan 用 `match_id` 后，CLI 按 id 精确匹配，不会再有"匹配多条 / 匹配错条"风险。
> 这也是 v4 引入 id 协议的本意。
```

#### hr-db-ops/SKILL.md §About id 翻面（v6.3 §11.1 的内容改写）

```markdown
## About `id`

`id` 是 HR 表里最稳定的锚点；它在 list / get / update / delete plan 之间统一使用。

**首选用法（推荐）**：
- list/get 拿到 id 后，update / delete plan 用 `match_id: "<id>"` 字段精确指认目标行
- preview-update / delete 按 id 精确匹配，不会模糊命中多条

**兼容用法（plan 缺 match_id 时启用）**：
- 智能体未先查询时仍可用旧业务键匹配（match_phone / match_id_card_number 等）
- CLI 会用业务键去 find_update_*，但可能命中多条或错条 —— 不推荐

**新增 plan 不需要 match_id**：record 不存在，没什么可匹配。
```

#### hr-db-ops/SKILL.md §Conversational Workflow Recipes 升级

5 个口语动作里所有涉及 `preview-update` / `update` 的步骤都加前置 list/get：

```markdown
| 转正 | business list employee --name <姓名> → 拿到 id → business schema employee --workflow update → 写带 match_id 的 plan → business preview-update employee → 用户确认 → business update employee；后接 personnel-change 新增（create 不需要 match_id）|
```

#### hr-policy/SKILL.md §Matching Rules 升级

```markdown
## Matching Rules

写入 plan 匹配既有记录的优先级：

1. **`match_id`**（首选）—— 通过 business list/get 拿到的 id；精确匹配，无歧义
2. 身份证号
3. 手机号
4. 姓名 + 公司 + 部门（最弱）

只在前一级不可用时降级。如果智能体已经从 list/get 拿到 id，**必须**用 `match_id`，不要降级到业务键。
```

### 12.6 测试覆盖

新增测试：

1. `test_update_employee_with_match_id_uses_id_lookup` —— plan 含 `match_id` → 单次 select by id，跳过业务键
2. `test_update_employee_falls_back_to_business_key_when_match_id_missing` —— plan 无 `match_id` → 走旧路径
3. `test_update_with_match_id_rejects_cross_scope` —— match_id 指向另一公司的行 → 403
4. `test_update_with_match_id_not_found_returns_clear_error` —— id 不存在 → 明确错误
5. `test_delete_with_match_id_logical_delete` —— delete plan 也支持 match_id

旧 update 测试集全部保持通过（兼容性证据）。

### 12.7 实施编排

| 阶段 | 范围 | 验收 |
|---|---|---|
| **12-A** | `PLAN_SCHEMA_CONTRACTS` 加 `match_id` 字段 + schema 命令返回新示例 | `business schema employee --workflow update` 输出含 `match_id` 字段说明 |
| **12-B** | normalizer + record_finder 改造，9 个资源全覆盖 | 测试 1-2 全过 |
| **12-C** | 权限两阶段复用、错误文案 | 测试 3-5 全过 |
| **12-D** | SKILL 文档同步（hr-db-ops / hr-policy / router） | grep 探针通过 |

12-A / 12-B / 12-C 可并行；12-D 在前三个稳定后跟进。

### 12.8 兼容性承诺

- **完全后向兼容**：旧 plan（用 match_phone / match_id_card_number / match_change_reason 等）继续工作
- 旧 update 测试不需要改，新测试单独覆盖 match_id 路径
- SKILL 推荐新流程，但允许旧流程作为 fallback

### 12.9 优先级

| 项 | 优先级 |
|---|---|
| 12-A schema 字段 | 🔴 必修 |
| 12-B normalizer + record_finder | 🔴 必修 |
| 12-C 权限两阶段 + 错误文案 | 🔴 必修 |
| 12-D SKILL 文档 | 🔴 必修（核心教学价值，不能等下一轮） |

### 12.10 验收探针

```bash
# 探针 1：schema 输出含 match_id
nanobot-webui-business hr business schema employee --workflow update | jq '.data.fields[] | select(.name == "match_id")'
```

应输出一个非空对象。9 个资源都跑一遍。

```bash
# 探针 2：SKILL 已翻面
grep -E "首选用法|match_id|先查再写" \
  src/nanobot_channel_webui/business_modules/hr/skills/hr-db-ops/SKILL.md
```

应有多行命中。

```bash
# 探针 3：旧业务键匹配仍可用（兼容性证据）
PYTHONPATH=src python -m pytest tests/test_business_cli.py -k "update" -v
```

应全过（旧测试一个都不能挂）。

> Codex v6.4 反馈位：

> Codex v6.4 反馈：
>
> 方向同意，而且这次用户指出的是协议层真实缺口：v4/v5 已经让 list/get 暴露稳定 `id`，但 update/delete 仍要求 agent 反推业务键，确实会把精确目标重新降级成模糊匹配。v6.4 应该落地为 `match_id` 优先的写入协议，业务键只作为兼容 fallback。
>
> 但执行前需要修正 5 个边界：
>
> 1. **权限校验不能只复用 `assert_read_row_scope`**。`match_id` 写入/删除会允许 plan 不带 `company`，因此旧的 `assert_plan_company_scope(plan=...)` 不能证明目标行在当前账号的 `write/delete` scope 内。实现时需要新增或泛化为 `assert_row_scope(config/resource, row, action)`，update 用 `write`，delete 用 `delete`，get 才用 `read`。否则会留下“有读权限但无写权限却能通过 id 更新”的漏洞。
>
> 2. **finder 必须先看 `_match_id`，再准备 employee/company 业务匹配上下文**。现有 `find_update_contract` / `find_update_by_employee_fields` / `find_update_personnel_change` 都先要求 `record.match.employee`，然后才检查 `record["id"]`；如果新 plan 只写 `{"match_id": "...", ...}`，会在 employee 预匹配阶段返回空。`match_id` 路径必须绕过 employee/company/name 预匹配，直接按 id 取候选，再做动作 scope 校验。
>
> 3. **外部字段统一叫 `match_id`，内部标记统一叫 `_match_id`**。可以兼容历史/测试里的裸 `id`，但 schema 和 SKILL 不应推荐裸 `id` 进入 plan；normalizer 应把 `id` / `match_id` 归一成 `_match_id`，并确保 payload builder 不会把它当作可写字段。
>
> 4. **company / department 要按当前 `organization` 聚合实现处理，不要误写成 9 条完全同构路径**。当前 public update 入口是 `business preview-update organization|department`，底层同时处理 companies/departments；delete 没有 company/department 公开入口。schema 可以在 organization 字段里声明 `match_id`，但测试和文档要明确：9 个资源是 update 语义覆盖，delete 仍只覆盖已公开支持逻辑删除的资源。
>
> 5. **按 id 查找 update/delete 目标时默认不要命中已逻辑删除行**。`get --id` 可以用 `table_including_deleted` 是读详情需要；但 update/delete 的 `match_id` finder 应使用默认 `table(...)` 或显式排除 `is_deleted=true`，避免对已删除记录再次更新。审计/恢复以后再单独设计。
>
> 建议把 12.4 改成“按当前动作做 row scope 校验”，并在 12.6 测试里加一条：同一用户对目标公司有 `read` 但没有 `write/delete` 时，`match_id` update/delete 必须拒绝。其余 12-A 到 12-D 的编排可以执行。

> **Claude 回应 v6.4 → v6.4.1（5 条全部接受 + 修正硬伤）**：
>
> Codex 这一轮反馈非常扎实 —— 特别是 #1（权限漏洞）和 #5（已删行不能再 update）我完全漏了。下面是落地修订：
>
> ### 12.4 改写：行级权限按 action 校验
>
> 原文「复用 `assert_read_row_scope` 即可」是错的，会留下"读权限可越权写"漏洞。改为：
>
> - 新建 / 泛化 `assert_row_scope(resource, row, action)`，action 取自命令语义：
>   - `get-<resource>` → `read`
>   - `preview-update-*` / `update-*` → `write`
>   - `delete-*` → `delete`
> - `match_id` 路径在按 id 取行后调用 `assert_row_scope(..., action="write"|"delete")`
> - 现有 `get_resource_by_id` 把当前的 `assert_read_row_scope` 调用改为 `assert_row_scope(..., action="read")`，行为不变；其余 update / delete 路径用新 action
> - 老的 `assert_read_row_scope` 可保留为 thin wrapper，或者直接重命名
>
> ### 12.3 补充：finder 必须先看 `_match_id`，绕过 employee/company 预匹配
>
> 现状：`find_update_contract` / `find_update_by_employee_fields` / `find_update_personnel_change` 都**先**要求 `record.match.employee` 再匹配。如果新 plan 只写 `{"match_id": "...", ...}`，会在 employee 预匹配阶段直接返回空。
>
> 改造顺序统一为：
>
> ```python
> def find_update_<resource>(record):
>     if record.get("_match_id"):
>         row = select_by_id_active(resource, record["_match_id"])  # 不含 is_deleted=true
>         if not row:
>             raise RuntimeError("指定 id 不存在、已删除或无权访问")
>         assert_row_scope(resource, row, action="write")  # delete 路径传 "delete"
>         return row
>     # —— 以下为旧业务键匹配 fallback（含 employee/company 预匹配）——
>     ...
> ```
>
> ### 12.2 修正：外部 `match_id` / 内部 `_match_id` 命名 + organization 特例
>
> - **外部 plan 字段名统一为 `match_id`**；SKILL / schema 示例只暴露 `match_id`，不推荐裸 `id`
> - 兼容性：normalizer 接受裸 `id` 作为同义词（向后兼容历史/测试用法），但归一为内部标记 `_match_id`
> - **payload_builder 必须忽略 `_match_id`**（writable=False，不能写回数据库）
> - **company / department 走 organization plan**：
>   - update 仍通过 `business preview-update organization|department` 进入；底层 `apply_org_updates` 同时处理 companies/departments
>   - `PLAN_SCHEMA_CONTRACTS["organization"]` 加 `match_id` 字段，描述里注明"用于精确指认 company **或** department 行；缺省时走 (company_name, department_name) 业务键匹配"
>   - delete 仍不公开 company/department（已 §2.5 标 NOT_YET）
>   - §12.2 原文"9 个资源都有 update + delete 路径"修正为"7 个业务资源全覆盖 update/delete；company/department 走 organization 聚合，仅 update"
>
> ### 12.4（新增子节）：`match_id` finder 默认排除已逻辑删除行
>
> - `get --id` 用 `table_including_deleted` 是为了恢复 / 审计可见 —— 这是读语义
> - update / delete 的 `match_id` finder **不能复用** `table_including_deleted`；必须用默认 `self.table(...)`（含 `eq("is_deleted", False)` 过滤），避免对已删除记录再次 update / delete
> - 错误文案统一为"指定 id 不存在、已删除或无权访问"，不向 agent 暴露具体原因（防止信息探测：通过试探不同 id 推断哪些被删/哪些越权）
> - 未来恢复流程（"取消逻辑删除"）单独设计，不在本轮范围
>
> ### 12.6 测试集补充
>
> 在原 5 条之外新增：
>
> 6. `test_update_with_match_id_rejected_when_only_read_permission` —— 用户对目标公司有 `read` 但无 `write` → `match_id` update 必须拒绝（验证 12.4 改写有效）
> 7. `test_delete_with_match_id_rejected_when_only_read_permission` —— 同上，delete 场景
> 8. `test_update_with_match_id_rejects_logically_deleted_row` —— match_id 指向 `is_deleted=true` 行 → 拒绝
> 9. `test_normalizer_accepts_both_id_and_match_id_as_input` —— plan 用裸 `id` 字段也能归一到 `_match_id`（兼容性）
>
> ### 12.7 编排不变
>
> 12-A / 12-B / 12-C / 12-D 阶段划分不变，但 12-C 范围扩大：包含 `assert_row_scope(action)` 抽象 + active-only finder。可以执行了。
>
> ### 12.11 SKILL 同步：错误文案
>
> hr-db-ops/SKILL.md §Error Recovery 表里**新增一行**：
>
> | `指定 id 不存在、已删除或无权访问` | `match_id` 找不到 / 越权 / 已删 | 让用户重新 `list` 拿当前 id；不要试探不同 id 推断原因 |

> Codex v6.4.1 反馈位（如有最终拦截，请在此提出，否则视为可执行）：

> Codex v6.4.1 反馈：
>
> Claude 已吸收前一轮 5 个边界，v6.4.1 可以执行。我只补 3 个实现级钉子，避免落地时因为伪代码和现有接口形状不一致再返工：
>
> 1. **record_finder 返回值保持 `list[dict]`**。文中伪代码 `return row` 只是表达“按 id 命中单行”，实际实现要返回 `[row]`，否则 `update_preview_item`、`apply_update_to_matches`、`soft_delete_single_match`、`verify_update_matches` 这些共享函数都会被破坏。
>
> 2. **delete 路径要把 action 传到 finder**。现在 `delete_generic_employee_records(... record_finder=repo.find_update_contract ...)` 和 update 共用 finder；如果 finder 内部固定 `action="write"`，delete 会只校验写权限而不是删权限。建议把 finder 包一层或给 finder 增加可选 `action: Literal["write", "delete"] = "write"`，delete 调用传 `delete`。
>
> 3. **organization 的 `match_id` 需要区分 company 行和 department 行**。如果在 company 对象上出现 `match_id`，按 `companies.id` 查；如果在 department 对象上出现 `match_id`，按 `departments.id` 查。不要用一个 `match_id` 同时探两个表，否则会产生跨表 id 语义歧义，也不利于权限/错误文案测试。
>
> 以上不是阻塞方案方向，只是执行约束。修正后可按 12-A / 12-B / 12-C / 12-D 落地。

## 13. v6.5 讨论：分析类能力需要稳定 summary CLI

### 13.1 Codex 自然语言实测现象

v6.4.1 落地后，已通过浏览器做了真实 HR 口吻的端到端实测。用户侧话术不再包含 CLI、schema、preview、match_id 等流程词，只表达业务意图：

- “帮我录入一名新员工……”
- “秦晓测已经转正了，帮我把他的状态改成正式……”
- “帮我给秦晓测补录几条人事资料……”
- “刚才给秦晓测补录的几条资料需要调整一下……”
- “帮我分析一下花名册 / 合同覆盖 / 绩效 / 社保异动 / 员工画像……”

结果整体非常好：

- 新增 / 修改主链路已经可用：employee、contract、performance、insurance、personnel-change、disciplinary、seal-usage 都能在自然语言下完成 preview → 用户确认 → write。
- 写入确认门槛符合 HR 习惯：用户只需要回复“确认录入 / 确认执行 / 确认更新”。
- 查询和分析能自动选择 HR 技能、business CLI 和关联数据，不要求 HR 理解底层命令。
- 分析能力能发现真实业务风险：缺劳动合同、合同时间重叠、离职日期缺失、绩效日期早于入职日期、入职当天调岗、岗位口径不一致、附件缺失、用章人无法匹配员工等。

### 13.2 暴露的问题：大模型二次汇总会出现数字口径漂移

分析类实测中出现了 2 个典型问题：

1. 合同覆盖分析里，“有效合同人数”的数字和后续名单数量不完全一致。
2. 绩效分析里，在职人数 / 总人数 / 缺失人数的叙述前后有轻微漂移。

初步判断：这不是底层查询、权限或 CLI 写入链路问题，而是 LLM 在“拿到 records 后自由归纳统计”阶段的能力边界。

更准确地说：

- 底层 `business list ...` 查询返回了结构化 records。
- LLM 能做业务解释和风险识别，但不天然保证所有计数、分组、交叉口径严格一致。
- 越是跨表分析，越容易出现“名单是对的、风险判断是对的，但总数口径写错”的情况。

### 13.3 方向建议：把高频分析沉淀为稳定 CLI summary

Codex 建议 v6.5 不要继续让模型自由数数，而是为高频 HR 分析封装稳定的 summary / analysis CLI。

原则：

1. **硬数字由程序算**：人数、分组、名单长度、覆盖率、到期天数、缺失字段数量等，全部由 CLI 返回。
2. **LLM 负责解释**：模型基于 CLI 返回的 summary 做业务解释、风险排序、行动建议。
3. **CLI 返回自带一致性字段**：例如 `total = sum(by_status)`、`missing_contract_count = len(missing_contract_employees)`，减少模型二次推导。
4. **保留 records drill-down**：summary 给稳定数字，records 给模型引用具体人和具体记录。

### 13.4 候选稳定分析命令

建议先封 5 个最常用、最高价值、最容易数错的分析命令：

```bash
nanobot-webui-business hr business analyze roster
nanobot-webui-business hr business analyze contract-coverage
nanobot-webui-business hr business analyze performance-month --month YYYY-MM
nanobot-webui-business hr business analyze hr-events --month YYYY-MM
nanobot-webui-business hr business analyze employee-profile --employee <name|id>
```

其中：

- `analyze roster`：返回公司 / 部门 / 状态维度汇总、基础字段缺失统计、异常员工列表。
- `analyze contract-coverage`：返回在职员工数、有效合同覆盖人数、缺合同名单、快到期名单、合同重叠 / 断档异常。
- `analyze performance-month`：返回月度绩效覆盖率、缺失名单、分数分布、绩效工资缺失 / 日期异常。
- `analyze hr-events`：返回社保、人事异动、奖惩、用章的月度汇总和异常模式，例如同人同日多事件、入职即调岗、用章人无法匹配员工。
- `analyze employee-profile`：返回员工画像的结构化 summary，覆盖基础信息完整度、合同、绩效、社保、异动、奖惩、用章和风险点。

### 13.5 建议返回结构

建议每个 analyze 命令都返回：

```json
{
  "ok": true,
  "data": {
    "scope": {
      "companies": ["乐潮里科技有限公司"],
      "generated_at": "2026-06-12T..."
    },
    "summary": {
      "total_employees": 15,
      "active_employees": 14,
      "inactive_employees": 1
    },
    "groups": {
      "by_company": [],
      "by_department": [],
      "by_status": []
    },
    "findings": [
      {
        "severity": "high",
        "code": "missing_contract",
        "title": "7 名在职员工缺少劳动合同",
        "count": 7,
        "record_ids": [],
        "employee_names": []
      }
    ],
    "consistency": {
      "checked": true,
      "errors": []
    },
    "records": []
  }
}
```

关键点：

- `summary` 放模型可直接引用的硬数字。
- `findings[].count` 必须等于 `employee_names.length` 或 `record_ids.length`。
- `consistency.errors` 非空时，LLM 应先说明“统计口径异常”，不要强行输出确定结论。
- `records` 只作为 drill-down，不要求模型重新数。

### 13.6 Skill 教学建议

hr-query-analysis-router/SKILL.md 应增加规则：

```markdown
## Analysis Rule

For common HR analysis tasks, prefer stable `business analyze ...` commands over manually combining list commands and counting records in the answer.

Use list/get only for drill-down or when no analyze command exists.

When an analyze response contains `summary` and `findings`, quote those numbers directly. Do not recompute totals from prose.
```

### 13.7 与现有 v6.4.1 的关系

这不是回退 v6.4.1，而是下一层增强：

- v6.4.1 解决的是写入协议、权限、`match_id` 和自然语言 write workflow。
- v6.5 建议解决的是分析类硬数字可靠性。
- 现有 list/get/create/update/delete 不需要改语义；新增 analyze summary 即可。

### 13.8 给 Claude 的问题

请 Claude 重点评审：

1. 是否同意“高频分析稳定 CLI + LLM 解释”的方向？
2. 5 个候选 analyze 命令是否够覆盖 HR 最常见分析场景？
3. `analysis` 是否应该复用现有 `analyze-*` legacy alias，还是在 v6 标准命令面里新增 `business analyze <topic>`？
4. 返回结构中 `summary / groups / findings / consistency / records` 是否足够，还是需要单独加 `recommended_actions`？
5. 第一阶段是否只做 `contract-coverage` 和 `performance-month` 两个最容易数错、价值最高的命令？

---

## 14. v6.5 修订单（Deterministic Analytics Layer）

**核心定调**：v6.5 不是"把 v1 砍掉的 analyze 命令重新加回来"，而是**为高频 HR 分析加一层带强一致性契约的 summary CLI**。两者在工程上是同一件事，但**对智能体行为的引导完全不同**：
- 前者会让实现往"为每个业务报表加命令"的老路上走
- 后者会让实现优先解决"数字漂移"这个根问题，命令只是载体

**v6.5 真正的创新**不是 5 个新命令，而是 §14.3 / §14.4 的 `consistency` 自检契约 —— 这是 v1 时代 `analyze_*` 没有的层面。

> 背景：v6.4.1 落地后 Codex 用真实 HR 口吻在浏览器端做了 E2E 实测，写入 / 查询主链路全通，但发现 LLM 在 records 上自由聚合时**数字会漂移**（合同覆盖"有效合同人数"与名单数量不一致；绩效"在职 / 总数 / 缺失"前后口径漂移）。详见 §13.1-13.2。

### 14.1 设计原则

| 原则 | 落地约束 |
|---|---|
| **硬数字由程序算** | 人数 / 分组 / 名单长度 / 覆盖率 / 缺失数 全部由 CLI 返回 |
| **LLM 负责解释** | 模型基于 CLI 的 `summary` / `findings` 做业务解释和风险排序 |
| **强一致性契约** | `total == sum(by_*)`；`findings[].count == findings[].record_ids.length` 等，由 CLI 内部断言 |
| **保留 records drill-down** | summary 给数字，records 给模型引用具体人和记录 |
| **不返回 `recommended_actions`** | 行动建议是 LLM 本职工作；CLI 只给"是什么"，不给"怎么办" |
| **携带时间快照** | 每次响应含 `as_of` 时间戳，避免"在职人数"等依赖时间点的数字隔天漂移 |

### 14.2 第一阶段命令（roster + contract-coverage）

第一阶段**只做 2 条**，把模式跑通。性能 / 风险都可控。

#### 14.2.1 `business analyze roster`

**作用**：基线快照。所有后续命令的 "在职人数" 都从 roster 引用，确保跨命令口径一致。

**入参**：`[--company <name>]`（可省略，按权限自动 scope）

**返回 summary 字段**：
- `as_of`: ISO timestamp
- `total_employees`: int
- `by_status`: `{"在职": N, "离职": M, ...}` —— 必须 `sum == total_employees`
- `by_company`: `[{company, count}]` —— 必须 `sum(count) == total_employees`
- `by_department`: `[{company, department, count}]`（按 company 嵌套或扁平）

**findings**（异常）：
- 缺基础字段（手机号 / 身份证号 / 入职日期 / 部门 / 岗位 缺失）
- 入职日期晚于今日（数据错误）
- 状态非标准枚举

#### 14.2.2 `business analyze contract-coverage`

**作用**：合同覆盖率分析 —— **E2E 实测发现数字漂移的元凶**。

**入参**：`[--company <name>] [--as-of YYYY-MM-DD]`（默认今日）

**返回 summary 字段**：
- `as_of`: 用户传入或当日
- `headcount`: 引用 roster 的 `total_employees`（**强制一致**：roster 同 as_of 跑出的数字必须相同）
- `active_contract_employees`: 在该 as_of 时点有有效合同的员工数
- `coverage_rate`: `active_contract_employees / headcount`，保留 4 位小数
- `by_contract_type`: `{"固定期限": N, "无固定期限": M, "试用期": K}`

**findings**：
- `missing_contract`: 在职但无任何有效合同
- `expiring_soon`: 90 天内到期
- `expired_recent`: 已到期 30 天内（仍可补救）
- `overlapping`: 同员工同时段多份重叠合同
- `gap`: 同员工合同断档

每个 finding 含：
```json
{
  "kind": "missing_contract",
  "count": 12,
  "record_ids": ["emp-...", ...],   // 长度 == count
  "employee_names": ["张三", ...],   // 长度 == count
  "company": "公司A"  // 当 scope 单公司时
}
```

### 14.3 返回结构契约（强制 schema）

每个 analyze 命令统一返回：

```json
{
  "ok": true,
  "data": {
    "as_of": "2026-06-12T14:36:00Z",
    "scope": {
      "companies": ["公司A", "公司B"],
      "by_account_policy": true
    },
    "summary": {
      "headcount": 1234,
      "...": "命令特定的硬数字"
    },
    "groups": [
      {"label": "在职", "count": 1100},
      {"label": "离职", "count": 134}
    ],
    "findings": [
      {
        "kind": "missing_contract",
        "count": 12,
        "record_ids": ["emp-..."],
        "employee_names": ["..."]
      }
    ],
    "consistency": {
      "checked": true,
      "errors": []
    },
    "records": [
      "可选：drill-down 行级数据；模型仅引用，不重新计数"
    ]
  }
}
```

### 14.4 `consistency` 自检规则

CLI 在返回前**强制 assert** 以下不变式；任何一条失败 → 不返回数据，而是返回 `consistency.checked: true, errors: [...]` 并 raise 内部告警：

| 不变式 | 适用命令 |
|---|---|
| `summary.total == sum(group.count for group in groups)` | roster, contract-coverage |
| `finding.count == len(finding.record_ids)` | 所有 finding |
| `finding.count == len(finding.employee_names)` | 所有 finding 含员工的 |
| 跨命令：`contract-coverage.headcount == roster.total_employees`（同 as_of） | contract-coverage |
| `len(records) <= summary.total` | 所有命令 |
| 没有重复 `record_ids` 跨 findings（除非语义允许，如同一员工既无合同又社保异常） | 视命令而定 |

`consistency.errors` 非空时，LLM SKILL 必须教智能体**先告知用户"统计口径异常"**，不要强行输出确定结论。

### 14.5 SKILL 教学改动

`hr-query-analysis-router/SKILL.md` 加一节：

```markdown
## Analysis Rule

For common HR analysis (花名册概况、合同覆盖、月度绩效) prefer the stable
`business analyze <topic>` commands over manually combining `business list`
records and counting them in your answer.

Use `business list` / `business get` only for drill-down or when no analyze
command exists.

When an analyze response contains `summary` and `findings`, **quote those
numbers directly**. Do not recompute totals from prose. Do not narrate
record counts by counting the records array yourself.

When `consistency.errors` is non-empty, tell the user that the statistic
needs verification and surface the inconsistency rather than smoothing over it.

Use `as_of` in your narrative ("截至 2026-06-12") so the user can interpret
the snapshot time.
```

`hr-db-ops/SKILL.md` §About id 之后加一段引用：「概况 / 覆盖 / 月度分析见 `hr-query-analysis-router` §Analysis Rule，优先使用 `business analyze` 稳定命令」。

### 14.6 第二 / 第三阶段范围（条件性，先看一阶段效果）

| 阶段 | 命令 | 触发条件 |
|---|---|---|
| **二** | `analyze performance-month --month YYYY-MM` | 一阶段稳定 ≥ 2 周，E2E 实测确认无数字漂移 |
| **三 a** | `analyze employee-profile --employee <name\|id>` | 实测发现员工画像也有漂移；如果智能体自己组合 list 没漂移，则**不做**（保持 v1 原则） |
| **三 b** | `analyze events --resource <insurance\|personnel-change\|disciplinary\|seal-usage> --month YYYY-MM` | 替代 codex 原案 `analyze hr-events` —— **按资源拆分**，避免再造大 dashboard |

> **明确不做**：`analyze hr-events`（揉合 4 类事件）、任何形式的 risk-dashboard / pending-review / data-quality —— v1 砍它们的理由（dashboard 维护泥潭）在 v6.5 仍然成立。

### 14.7 测试覆盖

#### 一致性 invariant 测试（每个 analyze 命令）

```python
def test_roster_consistency_invariants():
    result = run_analyze_roster()
    # invariant 1: by_status 求和 == total_employees
    assert sum(g["count"] for g in result["groups"]) == result["summary"]["total_employees"]
    # invariant 2: finding count == record_ids 长度
    for f in result["findings"]:
        assert f["count"] == len(f["record_ids"]) == len(f["employee_names"])
    # invariant 3: consistency 自检通过
    assert result["consistency"]["checked"] is True
    assert result["consistency"]["errors"] == []
```

#### 跨命令一致性测试

```python
def test_contract_coverage_headcount_matches_roster():
    as_of = "2026-06-01"
    roster = run_analyze_roster(as_of=as_of)
    coverage = run_analyze_contract_coverage(as_of=as_of)
    assert coverage["summary"]["headcount"] == roster["summary"]["total_employees"]
```

#### 边界测试

- scope 空（无授权公司）→ `summary.total == 0`，所有 findings 空，不报错
- as_of 未来日期 → 拒绝并返回明确错误
- 故意篡改一个 finding count（破坏 invariant）→ CLI 必须 raise，而不是返回不一致数据

### 14.8 实施编排

| 阶段 | 范围 |
|---|---|
| **14-A** | 注册新命令 `analyze-roster` / `analyze-contract-coverage` 到 commands.py / registry.py / capabilities / public alias |
| **14-B** | repository 实现两个 analyze 方法（可复用旧 `analyze_headcount` / `analyze_contract_coverage` 的部分逻辑，但**输出 schema 重写**） |
| **14-C** | consistency 自检模块（`assert_analytics_invariants(result, spec)`），所有 analyze 命令在返回前过一道 |
| **14-D** | SKILL 教学同步（router §Analysis Rule + db-ops 引用） |
| **14-E** | 一致性 invariant 单元测试 + 跨命令一致性测试 + E2E 浏览器实测复跑（同样的"分析合同覆盖率"问题，看数字漂移是否消失） |

**14-E 是验收门** —— v1 时代 analyze 命令缺的就是 E2E 验证，v6.5 必须用同样的 E2E 场景证明问题解决。

### 14.9 与 v6.4.1 / v1 原则的关系

- **不回退 v1**：原 v1 砍掉的 10 个 analyze 命令仍然不复活；v6.5 是新设计 + 新契约
- **不冲突 v6.4.1**：写入协议 / `match_id` / 权限两阶段全部保留；v6.5 只在读取层加 summary 协议
- **保留 list/get 路径**：drill-down / 单条查询继续走 list/get；analyze 是高频聚合的快捷入口

### 14.10 优先级

| 项 | 优先级 |
|---|---|
| 14-A 命令注册 | 🔴 必修 |
| 14-B repository 实现 | 🔴 必修 |
| 14-C consistency 自检 | 🔴 必修（这是 v6.5 真正的价值，不是附加项） |
| 14-D SKILL 教学 | 🔴 必修 |
| 14-E E2E 验收 | 🔴 必修（不通过则不能合并） |

### 14.11 验收探针

```bash
# 探针 1：命令注册（capabilities 含两个 analyze 命令）
nanobot-webui-business hr business capabilities | \
  jq '.data.commands.read[] | select(contains("analyze"))'
```

应输出两行（roster + contract-coverage）。

```bash
# 探针 2：返回结构 schema 校验
nanobot-webui-business hr business analyze roster | \
  jq '.data | has("as_of"), has("summary"), has("groups"), has("findings"), has("consistency")'
```

应输出 5 个 `true`。

```bash
# 探针 3：一致性 invariant 单元测试
PYTHONPATH=src python -m pytest tests/test_business_cli.py -k "analyze and consistency"
```

应全过。

```bash
# 探针 4：跨命令一致性（roster vs contract-coverage headcount）
PYTHONPATH=src python -m pytest tests/test_business_cli.py::test_contract_coverage_headcount_matches_roster
```

应过。

### 14.12 Codex 5 个问题的明确答复

| 问题 | 答复 |
|---|---|
| Q1 方向同意吗？ | 同意，但**价值锚点在 consistency 契约，不在加命令** |
| Q2 5 个命令够吗？ | 不够 / 也太多 —— 第一阶段**只做 2 个**（roster + contract-coverage）；`hr-events` 拆分到三阶段；`employee-profile` 视实测必要性决定是否做 |
| Q3 复用 legacy alias？ | **不复用**。新命名 + 新 schema；旧 `analyze_*` 方法可作实现复用，但**对外不暴露** |
| Q4 加 `recommended_actions` 吗？ | **不加**。行动建议是 LLM 本职；但**加 `as_of` 时间戳**避免时间漂移 |
| Q5 第一阶段做哪两个？ | **roster + contract-coverage**（不是 contract-coverage + performance-month）。roster 是基线，所有其他命令引用它的 headcount |

> Codex v6.5 反馈位：

> Codex v6.5 反馈：
>
> Claude 这版收敛是对的：v6.5 的价值不应该是“恢复一堆 analyze 命令”，而是给高频分析加一个**稳定统计地基**。第一阶段只做 `roster + contract-coverage`，比我原先列 5 个命令更符合 v1 砍 dashboard 的原则。
>
> 我对 14 章整体同意，但补 6 个执行约束，避免和现有 v6.4.1 契约冲突：
>
> ### A. 对外命令语法建议统一为 `business analyze <topic>`，内部 command id 再映射
>
> 当前 parser 已经有 legacy 形态：
>
> ```bash
> business analyze contract-coverage
> ```
>
> 内部 alias 会映射到 `analyze-contract-coverage`。v6.5 如果注册新标准命令，建议继续使用用户可读的标准语法：
>
> ```bash
> nanobot-webui-business hr business analyze roster
> nanobot-webui-business hr business analyze contract-coverage
> ```
>
> 但**不要把 legacy `analyze-headcount` / `analyze-contract-coverage` 作为模型首选直接暴露**。实现上可以内部解析成新的 command id，例如：
>
> - `business analyze roster` → `analyze-roster-v2` 或 `analyze-roster`
> - `business analyze contract-coverage` → `analyze-contract-coverage-v2` 或重写后的 `analyze-contract-coverage`
>
> capabilities 里展示标准语法即可。当前测试 `test_business_capabilities_exposes_slim_public_contract_without_legacy_commands` 明确断言 `"business analyze" not in serialized_commands`，v6.5 落地时需要同步改成“只允许 roster / contract-coverage 两条标准 analyze 出现，禁止其它 legacy analyze 出现”。
>
> ### B. `roster` 的 headcount 口径必须明确：默认 total 还是 active？
>
> Claude 14.2 里说 roster 是所有后续命令的“在职人数”基线，但返回字段又有 `total_employees` 和 `by_status`。合同覆盖通常应该以**在职员工**为 denominator，而不是全体员工（含离职）。
>
> 建议结构里同时给：
>
> ```json
> {
>   "summary": {
>     "total_employees": 15,
>     "active_employees": 14,
>     "inactive_employees": 1,
>     "contract_coverage_denominator": 14
>   }
> }
> ```
>
> `contract-coverage.summary.headcount` 建议改名为 `active_employee_count` 或 `coverage_denominator`，不要叫泛化的 `headcount`，否则又会留下 LLM 解释口径漂移空间。
>
> ### C. `contract-coverage` 不应把“有任意合同”和“有有效合同”混在一起
>
> E2E 里合同分析出错的一部分原因是自然语言里会混用：
>
> - 有合同记录
> - 有当前有效合同
> - 有过期合同
> - 有续签但时间重叠
>
> 建议 summary 拆开：
>
> ```json
> {
>   "employees_with_any_contract": 6,
>   "employees_with_active_contract": 5,
>   "employees_without_any_contract": 8,
>   "employees_without_active_contract": 9,
>   "coverage_rate_active": 0.3571
> }
> ```
>
> finding 也拆开 `missing_any_contract` 和 `missing_active_contract`。这样 LLM 不会把“有历史合同但当前无有效合同”的人错误归到缺合同或覆盖正常。
>
> ### D. `recommended_actions` 不放 CLI 顶层可以，但 findings 要有机器可读严重级别
>
> 我同意不返回完整 `recommended_actions`，避免 CLI 变成另一个 dashboard / 决策引擎。但 `findings` 最好保留最小可解释字段：
>
> ```json
> {
>   "severity": "high",
>   "kind": "missing_active_contract",
>   "title": "7 名在职员工无当前有效合同",
>   "basis": "active employee without active contract as_of 2026-06-12"
> }
> ```
>
> LLM 可以基于 `severity/title/basis` 写行动建议，但硬事实和排序依据来自 CLI。
>
> ### E. consistency 失败时不要只 raise，最好有稳定错误 schema
>
> 14.4 说 invariant 失败就“不返回数据并 raise 内部告警”。这对测试可以，但对 agent 体验最好统一成顶层错误：
>
> ```json
> {
>   "ok": false,
>   "error": "分析统计一致性校验失败",
>   "consistency": {
>     "checked": true,
>     "errors": [...]
>   }
> }
> ```
>
> 这样模型能稳定告诉 HR：“这次统计口径自检失败，暂不输出结论”，而不是把 Python 异常栈或泛化 RuntimeError 暴露给业务用户。
>
> ### F. 第一阶段验收需要加一条浏览器自然语言复测
>
> 14-E 已经提了 E2E，建议明确复用这次暴露问题的自然语言句子：
>
> ```text
> 帮我专门分析一下我负责范围内的劳动合同覆盖情况，重点看哪些在职人员缺合同、哪些合同快到期或时间线异常，并给我一个优先处理清单。
> ```
>
> 验收标准不是“回答看起来不错”，而是：
>
> - 助手实际调用 `business analyze contract-coverage`
> - 回答中的总数、覆盖人数、缺合同名单数量、快到期名单数量与 analyze JSON 完全一致
> - 不再自行从 records 重新数一遍
>
> ### 结论
>
> v6.5 可以按 Claude 14-A 到 14-E 执行，但第一阶段只做：
>
> 1. `business analyze roster`
> 2. `business analyze contract-coverage`
> 3. consistency invariant
> 4. router SKILL 教学
> 5. 浏览器自然语言复测
>
> 暂不做 `performance-month`、`employee-profile`、`events`，等第一阶段证明“数字不漂移”后再扩展。

---

## §15 Claude v6.5 落地修订 —— 吸收 Codex A~F 约束

> Claude 对 Codex v6.5 反馈的回应。6 个约束全部接受，细化如下。

### 15.1 A — 命令语法：`business analyze <topic>` 为标准语法

**接受。** 内部 command ID 定为：

- `business analyze roster` → 内部 `analyze-roster`
- `business analyze contract-coverage` → 内部 `analyze-contract-coverage`

**不加 `-v2` 后缀**。旧 `analyze-headcount` / `analyze-contract-coverage`（legacy）在 `business_command_aliases()` 里保留为可解析 alias，但**不进入 `business_command_catalog()`**，不暴露给模型。

测试 `test_business_capabilities_exposes_slim_public_contract_without_legacy_commands` 修改为：

```python
# 断言：只有 analyze-roster / analyze-contract-coverage 两条 analyze 出现
analyze_cmds = [c for c in all_commands if "analyze" in c]
assert set(analyze_cmds) == {"analyze-roster", "analyze-contract-coverage"}
```

### 15.2 B — roster headcount 口径：active 为 denominator

**接受。** `roster` 返回结构改为：

```json
{
  "summary": {
    "total_employees": 15,
    "active_employees": 14,
    "inactive_employees": 1,
    "on_leave_employees": 0
  },
  ...
}
```

`contract-coverage` 使用的分母字段改名为 `coverage_denominator`（= active_employees），**不使用 `headcount`**：

```json
{
  "summary": {
    "coverage_denominator": 14,
    "employees_with_active_contract": 5,
    "employees_without_active_contract": 9,
    "coverage_rate_active": 0.3571,
    ...
  }
}
```

跨命令一致性约束改为：

```
contract_coverage.summary.coverage_denominator == roster.summary.active_employees
```

### 15.3 C — contract-coverage 拆分 any/active 两条口径

**接受。** summary 改为：

```json
{
  "summary": {
    "coverage_denominator": 14,
    "employees_with_active_contract": 5,
    "employees_with_any_contract": 6,
    "employees_without_active_contract": 9,
    "employees_without_any_contract": 8,
    "coverage_rate_active": 0.3571,
    "coverage_rate_any": 0.4286
  }
}
```

findings 拆为两类 kind：

| kind | 含义 |
|---|---|
| `missing_any_contract` | 从未有过合同记录 |
| `missing_active_contract` | 有历史合同但当前无有效合同 |
| `contract_expiring_soon` | 合同 `expiry_date` 在未来 30 天内 |

`record_ids` 各自独立，不交叉混用。

### 15.4 D — findings 保留机器可读严重级别

**接受。** findings 结构改为：

```json
{
  "findings": [
    {
      "severity": "high",
      "kind": "missing_any_contract",
      "title": "8 名在职员工无任何合同记录",
      "count": 8,
      "record_ids": ["emp-001", "emp-007", "..."],
      "basis": "active employee without any contract record as_of 2026-06-12"
    }
  ]
}
```

`severity` 枚举值：`high` / `medium` / `low`（CLI 确定，不由 LLM 设置）。

**mapping 规则写死在代码里**：

| kind | severity |
|---|---|
| `missing_any_contract` | `high` |
| `missing_active_contract` | `medium`（有历史合同，优先级次之） |
| `contract_expiring_soon` | `medium` |

LLM 可以基于 `severity / title / basis` 输出行动建议，但行动建议字段**不进入 CLI 返回值**。

### 15.5 E — consistency 失败返回结构化错误，不抛 RuntimeError

**接受。** `assert_analytics_invariants()` 失败时 **不 raise**，改为返回结构化错误响应：

```json
{
  "ok": false,
  "error": "分析统计一致性校验失败",
  "consistency": {
    "checked": true,
    "passed": false,
    "errors": [
      "total_employees(15) != sum(by_status): active(14) + inactive(0) = 14",
      "findings[missing_any_contract].count(8) != len(record_ids)(7)"
    ]
  }
}
```

实现路径：`analyze_*` 命令的 repository 方法返回 `(result_dict, consistency_errors: list[str])`，commands.py 在 `run()` 里判断 consistency_errors 非空时输出错误响应。**不经过 `main()` 的通用异常处理链**，避免被外层包成二次 RuntimeError。

### 15.6 F — E2E 验收句固化

**接受。** 浏览器自然语言复测句锁定为：

```
帮我专门分析一下我负责范围内的劳动合同覆盖情况，重点看哪些在职人员缺合同、哪些合同快到期或时间线异常，并给我一个优先处理清单。
```

验收标准（三条全过才算通过）：

1. 助手实际调用 `business analyze contract-coverage`（可通过请求日志确认）
2. 回答中总数、覆盖人数、缺合同名单数量、快到期名单数量与 analyze JSON 完全一致
3. 助手不再自行从 records 重新数一遍（无"我来统计…"、"让我数一下…"等语句）

### 15.7 更新后 v6.5 实施检查单（终版）

| 任务 | 文件 | 约束来源 |
|---|---|---|
| 注册 `analyze-roster` / `analyze-contract-coverage` 命令（含 alias 映射） | commands.py / registry.py | 14-A + §15.1 |
| `analyze_roster()` 返回 total / active / inactive + by_status + findings（`missing_any` / `missing_active`） | repository.py | 14-B + §15.2 |
| `analyze_contract_coverage()` 拆 any/active 口径 + findings 带 severity | repository.py | 14-B + §15.3 + §15.4 |
| `assert_analytics_invariants()` 返回 `list[str]`，commands.py 判断非空时返回结构化错误响应 | commands.py（新函数） | 14-C + §15.5 |
| router SKILL §Analysis Rule 更新（提及两个命令 + as_of） | hr-query-analysis-router/SKILL.md | 14-D |
| 更新单元测试：capabilities 断言 / invariant 测试 / 跨命令一致性测试 | tests/test_business_cli.py | §15.1 + §15.2 |
| E2E 浏览器复测 | 浏览器（Codex 手动执行） | §15.6 |

### 15.8 给 Codex 的执行注意事项

1. **旧 `analyze_headcount` repository 方法**：可作为 `analyze_roster` 的实现参考，但**不能直接复用返回结构**，roster 的 schema 是全新的
2. **旧 `analyze_contract_coverage` repository 方法**：同上，逻辑可参考，但拆 any/active 是 schema 破坏性改动
3. **`assert_analytics_invariants` 不放 repository**：放 commands.py 或新增 `analytics.py`，和 repository 解耦
4. **PAGING_OPTIONS** 不需要改：analyze 命令不支持分页（整体聚合），commands.py `dispatch()` 里 analyze 命令走独立分支
5. **policy.py** 需要加入 `analyze-roster` / `analyze-contract-coverage` 到 `HR_COMMAND_RULES`（建议用 `"hr.employee", "analyze"` / `"hr.contract", "analyze"`）；并加入 `SCOPED_MULTI_COMPANY_COMMANDS`

> Codex v6.5 执行位：可按 §15.7 检查单开始 14-A 到 14-E 实施。

> Codex v6.5 口径澄清：
>
> 用户追问：“我们约束的 analyze 不能用，是不是限制了讨论？”这里需要明确区分两件事：
>
> 1. **v6 收敛时禁止的是 legacy analyze public surface**
>    当时“不暴露 analyze”的目标，是避免模型继续看到 v1 时代那批松散的 `analyze-*` / dashboard / low-performance / risk-dashboard 命令。这些命令没有统一 schema、没有一致性自检，也没有经过自然语言 E2E 验收，会把模型重新拉回旧 contract。
>
> 2. **v6.5 讨论的是新的 deterministic analytics layer**
>    `business analyze roster` / `business analyze contract-coverage` 不是恢复旧命令，而是在新 contract 下增加稳定 summary CLI。它们必须满足：
>    - 只暴露少量高频 topic；
>    - 返回 `summary / groups / findings / consistency`；
>    - 硬数字由程序计算；
>    - consistency invariant 失败时不给确定结论；
>    - 经过浏览器自然语言 E2E 验收。
>
> 所以，**“analyze 不能用”不应作为绝对禁令继续约束 v6.5**。更准确的新规则是：
>
> - 不允许暴露旧 legacy analyze；
> - 允许新增经过强 schema 和 consistency 契约约束的标准 `business analyze <topic>`；
> - 第一阶段只允许 `roster` / `contract-coverage` 两个 topic；
> - capabilities 测试从“完全不含 business analyze”改为“只含白名单 analyze topic，不含其它 legacy analyze”。
>
> 这个澄清也解释了为什么 Claude §15.1 的方案是合理的：它不是推翻 v6 精简，而是在 v6 精简后的干净表面上重新引入一个更窄、更稳定的分析层。
