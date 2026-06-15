# HR Business 一等工具入口方案评审稿

本文用于和 Claude 讨论确认方案。目标是在最多 3 轮评审内定稿，然后进入实现计划和开发。

## 背景

当前 HR 业务能力已经收敛到 Python runtime 和标准 business CLI：

```bash
nanobot-webui-business hr business <list|get|analyze|preview|create|preview-update|update|delete|schema|capabilities> <resource|topic> [options]
```

这个 CLI 是 HR 权限、scope、schema、写入预览、验证和审计的主入口。动态技能视图目前会指导模型通过 `exec` 调用该 CLI。

最近排查发现，上游 Nanobot 的 `exec` 工具本身会截断输出：默认最多返回 10,000 字符，单次调用通过 `max_output_chars` 最多提高到 50,000 字符。截断发生在 `AgentRunner` 拿到 tool result 之前，因此后续的「超大工具结果落盘」机制只能保存已经截断后的结果，无法恢复被 `exec` 丢掉的中间内容。

这对 HR business CLI 有实际风险：

- 大型 `list`、`capabilities`、`schema`、`analyze` 或预览结果可能被截断。
- 关键字段、匹配原因、跳过原因、verification 详情如果位于中间，模型后续推理会缺上下文。
- 仅靠提示词要求模型传 `max_output_chars=50000` 只能缓解，不能保证完整结果。
- 让模型长期通过 shell 拼业务命令，也不利于结构化权限、审计和参数校验。

## 上游能力依据

Nanobot 上游已经支持外部插件通过 entry point 注册 tool：

```toml
[project.entry-points."nanobot.tools"]
some_tool = "package.module:ToolClass"
```

上游 `ToolLoader` 会读取 `entry_points(group="nanobot.tools")`，加载 `Tool` 子类，调用 `enabled(ctx)`、`create(ctx)`，然后注册到 `ToolRegistry`。因此本插件可以不修改上游核心代码，直接提供一个 HR 业务一等工具。

这个能力只负责把工具挂入模型可调用列表；HR 语义权限、company scope、输出落盘、动态技能视图和审计仍由本插件实现。

## 目标

新增一个插件侧 Nanobot tool，例如 `hr_business`，作为模型调用 HR business runtime 的主入口。

目标效果：

- 模型不再优先用 `exec` 调 `nanobot-webui-business hr business ...`。
- HR 业务操作通过结构化参数调用，不拼 shell 字符串。
- 输出处理由 HR tool 自己控制，必要时保存完整结果并返回摘要和文件路径。
- 权限仍然 fail-closed，并按 `resource + action + scope` 执行。
- 现有 CLI 继续保留，作为人工入口和兼容入口。

## 非目标

- 不修改 Nanobot 上游核心代码。
- 不删除 `nanobot-webui-business` CLI。
- 不把 HR runtime 改回 Node/JS。
- 不把普通系统命令都迁移到 `run_cli_app` 或新工具；`git`、`pytest`、`bun` 等仍由 `exec` 负责。
- 不在第一版引入通用业务域框架；先把 HR 跑通，再抽象给新业务域复用。

## 推荐方案

### 1. 抽出可复用的 Python runtime 入口

现有 CLI 入口应继续存在，但 CLI 主函数和新 tool 应调用同一个 Python 函数，例如：

```python
def run_business_command(argv: list[str], *, context: BusinessCommandContext | None = None) -> str:
    ...
```

这个函数负责复用现有 `runtime/commands.py` 的解析、policy、repository、schema、preview、verification 和 JSON 输出逻辑。

设计原则：

- CLI 只是 argv 适配层。
- Tool 也是 argv 或结构化参数适配层。
- 业务规则只在 runtime 层实现一次，避免 CLI 和 tool 逻辑分叉。

### 2. 新增 `HrBusinessTool`

建议新增文件：

```text
src/nanobot_channel_webui/tools/hr_business.py
```

工具名建议：

```text
hr_business
```

第一版参数可以保持贴近公开 business CLI：

| 参数 | 类型 | 说明 |
|---|---|---|
| `action` | string | `list`、`get`、`analyze`、`preview`、`create`、`preview-update`、`update`、`delete`、`schema`、`capabilities` |
| `resource` | string | HR 资源或分析 topic，例如 `employee`、`contract`、`roster` |
| `company` | string? | 可选 company scope |
| `id` | string? | `get` 精确读取使用 |
| `query` | string? | 查询或过滤文本 |
| `page` | integer? | 裸 `list` 分页 |
| `page_size` | integer? | 裸 `list` 分页大小 |
| `input` | string? | create/update/delete/preview plan 文件路径 |
| `month` | string? | 月度分析 topic 使用 |
| `from_date` | string? | 时间范围开始 |
| `to_date` | string? | 时间范围结束 |
| `days` | integer? | 到期分析窗口 |
| `workflow` | string? | `schema` 的 create/update workflow |
| `json` | boolean? | 默认返回 JSON |

内部做法：

- 不调用 shell。
- 不调用 `exec`。
- 结构化参数转换为 runtime 可理解的 argv 或内部对象。
- 调用同一个 `run_business_command(...)`。
- 对超大结果先保存完整输出，再返回摘要、路径和读取建议。

### 3. 通过 entry point 注册

在 `pyproject.toml` 增加：

```toml
[project.entry-points."nanobot.tools"]
hr_business = "nanobot_channel_webui.tools.hr_business:HrBusinessTool"
```

如果后续还有更多插件工具，可以创建：

```text
src/nanobot_channel_webui/tools/__init__.py
```

### 4. 权限和审计接入

现有 `AuthorizingToolRegistry` 已经是插件侧工具授权网关。新增 `hr_business` 后，建议让它成为受控业务工具：

- `action=list|get|schema|capabilities` 映射到对应 read 能力。
- `action=analyze` 映射到 `hr.<topic>:analyze` 或现有分析能力。
- `action=preview|create` 映射到 create 权限。
- `action=preview-update|update` 映射到 update 权限。
- `action=delete` 映射到 delete 权限。
- 显式 `company` 未授权时拒绝。
- 不带 `company` 时按当前账号 policy 自动过滤。
- 缺少身份、policy、policy file 或 runtime 注入失败时默认拒绝。
- 审计记录应包含 tool、action、resource、company、decision、reason、chat_id、user_id。

需要特别确认：权限应该在 `AuthorizingToolRegistry.prepare_call()` 里先做一层，还是在 `HrBusinessTool.execute()` 内再做一层。推荐两层都保留：registry 负责「能不能调用工具和动作」，runtime/repository 负责「调用后能看到什么」。

### 5. 输出落盘策略

新工具必须绕开 `exec` 截断问题。建议规则：

- 工具内部拿到完整 runtime 输出。
- 如果输出小于阈值，直接返回。
- 如果输出超过阈值，完整写入当前用户实例 workspace：

```text
.nanobot/tool-results/webui_plugin_<chat_id>/<tool-call-or-timestamp>.json
```

- 返回内容包含：
  - `status`
  - `action`
  - `resource`
  - `summary`
  - `full_output_path`
  - `original_size`
  - `preview`
  - `instruction`: 需要完整内容时读取该文件

这里要沿用现有权限边界：scoped 用户只能读取自己 chat/session 对应的 tool result 路径，不能读取其他用户或全局 tool result。

### 6. 动态技能视图更新

HR 相关技能和动态技能视图需要从「运行 CLI 命令」改为「调用 `hr_business` 工具」。

示例从：

```bash
nanobot-webui-business hr business list employee --page-size 100
```

调整为模型可见的工具调用意图：

```json
{
  "action": "list",
  "resource": "employee",
  "page_size": 100,
  "json": true
}
```

CLI 命令仍可作为人工排障和兼容说明保留，但不作为模型优先入口展示。

## 备选方案

### 方案 A：只改提示词，要求 `exec max_output_chars=50000`

优点：改动最小。

缺点：模型可能忘带；50,000 仍会截断；仍然无法保存原始完整输出；仍然依赖 shell 拼命令。

结论：只适合作为短期缓解，不适合作为最终方案。

### 方案 B：改上游 `exec`，让它先落盘再返回预览

优点：能一次性改善所有 shell 命令。

缺点：需要修改上游核心；权限、workspace、session、敏感输出治理更复杂；不解决 HR 参数结构化和业务审计问题。

结论：可以作为上游优化议题，但不应阻塞 HR tool。

### 方案 C：新增 `hr_business` 一等工具

优点：不改上游；结构化参数；可控输出落盘；权限和审计清晰；符合插件边界。

缺点：需要改 runtime 入口、工具注册、技能视图和测试。

结论：推荐采用。

## 实施边界

建议第一版只覆盖 HR business CLI 当前公开契约：

- `list`
- `get`
- `analyze`
- `preview`
- `create`
- `preview-update`
- `update`
- `delete`
- `schema`
- `capabilities`

暂不做：

- 通用多业务域 tool 抽象。
- 图形化 tool result 浏览器。
- 上游 `exec` 行为修改。
- 自动迁移所有旧技能文案里的历史 CLI 例子，只改模型可见主链路和关键 HR 技能。

## 测试建议

至少覆盖以下测试：

1. 工具注册测试：安装插件后 `ToolLoader` 能发现 `hr_business`。
2. 参数转换测试：`hr_business(action="list", resource="employee")` 调用到 runtime 正确入口。
3. 权限拒绝测试：scoped 用户显式传未授权 company 时拒绝。
4. 权限过滤测试：不传 company 时只返回授权范围。
5. 写入权限测试：`preview-update/update/delete` 按 action 做 scope 校验。
6. 大输出落盘测试：超过阈值时返回摘要和 `full_output_path`，文件包含完整原始输出。
7. 动态技能视图测试：模型可见说明优先推荐 `hr_business`，不再推荐裸 `exec nanobot-webui-business ...`。
8. 兼容 CLI 测试：原 `nanobot-webui-business hr business ...` 仍可运行。

## 发布与验证

实现完成后按项目规则执行：

```bash
./scripts/publish-local.sh
```

如果涉及 Python 后端、权限注入、实例编排或工具注册，发布后重启：

```bash
nanobot-webui gateway --config ~/.nanobot/config.json
```

验收时至少说明：

- 是否已发布到本地。
- 是否已重启服务。
- `/health` 是否正常。
- `hr_business` 是否被实例模型可见。
- scoped 权限拒绝和授权查询是否通过。
- 大输出是否保存了完整文件。

## 需要 Claude 重点评审的问题

1. `HrBusinessTool` 的参数是否应该保持通用 `action/resource/options`，还是拆成多个工具，例如 `hr_list`、`hr_get`、`hr_analyze`、`hr_write`？
2. 权限校验应主要放在 `AuthorizingToolRegistry`，还是工具内部，还是必须双层都做？
3. 大输出落盘路径是否复用 `.nanobot/tool-results/webui_plugin_<chat_id>/`，是否需要单独 HR 子目录？
4. `runtime/commands.py` 现有 CLI 解析是否适合抽出 `run_business_command(argv)`，还是应该直接抽更结构化的 service API？
5. 动态技能视图中是否完全隐藏 CLI 命令，还是保留「人工排障可用 CLI」但明确模型优先用 `hr_business`？

## 建议的 3 轮定稿流程

### 第 1 轮：架构边界

确认是否采用「新增 `hr_business` 一等工具 + CLI 复用同一 runtime 入口」。

产出：确定方案 C 是否成立，以及工具粒度是一体化还是拆分。

### 第 2 轮：权限与输出

确认权限校验层级、审计字段、大输出落盘路径和模型可见返回结构。

产出：确定安全边界和 tool result contract。

### 第 3 轮：实现计划

确认文件改动、测试列表、发布验证命令和迁移范围。

产出：进入实现计划，不再扩大范围。

## 当前推荐结论

采用方案 C：通过上游已有 `nanobot.tools` entry point 注册插件侧 `hr_business` tool。CLI 和 tool 共用 HR Python runtime 入口；模型主链路调用结构化 tool；大输出由 tool 自己保存完整结果；权限由 registry 和 runtime/repository 双层兜底；旧 CLI 保留为人工和兼容入口。

---

## Claude 第 1 轮评审

> 针对「需要 Claude 重点评审的问题」1~5 给出意见。目标是在本轮定稿架构边界。

### Q1 工具粒度：统一 vs 拆分

**建议：一个统一工具 `hr_business`，不拆分。**

原因：

1. **模型路由成本**：拆成 `hr_list` / `hr_get` / `hr_analyze` / `hr_write` 四个工具，模型需要在 tool selection 阶段先判断用哪个，这本身就是一个推理步骤，而且容易出错（`analyze-roster` 是算 read 还是 analyze？`preview-update` 是算 write 还是需要先 read?）。
2. **权限和审计单点**：一个工具一条审计记录，权限校验逻辑集中。拆分后每个工具都需要独立权限实现，容易出漏洞或逻辑分叉。
3. **与现有 CLI 契约对齐**：现有 CLI 就是一个命令入口加 action/resource，工具保持同构最利于 CLI ↔ Tool 共用 runtime。
4. **未来扩展**：新增 action（比如 `audit`）只需在参数枚举里加一条，不需要新建工具。

**参数设计微调建议**：

`action` 枚举值建议和 CLI 精确对齐，不做简写：

```
list | get | analyze | preview | create | preview-update | update | delete | schema | capabilities
```

`resource` 可以是自由字符串，runtime 负责校验合法性并返回友好错误。

---

### Q2 权限校验层级

**建议：双层都保留，各管各的。**

| 层 | 负责什么 | 失败行为 |
|---|---|---|
| `AuthorizingToolRegistry` | 该用户能不能调用 `hr_business` 这个工具、以及这个 action 类别 | 拒绝，不进入 tool 内部 |
| `runtime/repository` | 调用后能看到哪些 company 的数据；具体行的 scope 校验 | 行级过滤或报错 |

两层不重复，各有必要：

- Registry 层防止「完全没有 HR 权限的用户」进入 runtime（快速拒绝，减少 DB 查询）。
- Runtime 层防止「有 HR 权限但 company scope 不对」的用户拿到不该看的数据（深度过滤）。

仅靠 registry 层不够：registry 只能判断 action 粗粒度，无法做行级 company scope 过滤。仅靠 runtime 层，registry 会把所有请求都透传进来，增加 runtime 负担也失去了审计入口。

---

### Q3 大输出落盘路径

**建议：复用 `.nanobot/tool-results/webui_plugin_<chat_id>/`，加 `hr/` 子目录。**

```
.nanobot/tool-results/webui_plugin_<chat_id>/hr/<timestamp>-<action>-<resource>.json
```

理由：

- 有 `hr/` 子目录后，同一 chat 如果将来有多个业务域 tool，不会混在一起。
- `<action>-<resource>` 后缀让文件名自解释，排障时一眼能看出是什么调用产生的。
- `chat_id` 已经隔离了不同用户；HR 子目录不需要再加 `user_id`，不过度嵌套。

**阈值建议**：5,000 字符以下直接返回（小查询不必落盘），超过后落盘返回摘要+路径。不建议用固定 10,000，因为 `capabilities` / `schema` 的输出通常在 3,000~8,000 之间，阈值太高会漏掉这些常见截断场景。

---

### Q4 抽象层级：`run_business_command(argv)` vs Service API

**建议：先用 `argv` 适配层，不急于抽 service API，但需要加一个 context 参数。**

具体签名：

```python
def run_business_command(
    argv: list[str],
    *,
    context: BusinessCommandContext | None = None,
) -> dict:  # 返回 parsed dict，不是 JSON str
```

原因：

1. **CLI 和 tool 最大复用**：现有 `commands.py` 解析逻辑已经稳定（经过 v6 多轮收敛）。用 argv 适配可以 zero-copy 复用，不需要重写解析逻辑。
2. **service API 时机未到**：service API 意味着要定义内部 DTO（`ListRequest`, `GetRequest`…），工作量大且现在不清楚 shape。等 tool 跑通后，如果需要性能优化或第二个 tool 复用，再抽 service API。
3. **返回 dict 而非 str**：CLI 最终输出 JSON str，tool 可以在拿到 dict 后自己决定落盘还是直接返回摘要，不需要 parse JSON 两次。这里建议 `run_business_command` 返回 `dict`，CLI 侧再 `json.dumps`。

**context 参数用途**：注入 `chat_id`（用于落盘路径）、`user_id`（用于审计）、`policy`（避免重复加载）。

---

### Q5 动态技能视图

**建议：模型优先用 `hr_business`，保留 CLI 但降级为「人工排障备用」。**

具体做法：

- 技能里的「执行入口」改为工具调用示例：
  ```json
  { "action": "list", "resource": "employee", "page_size": 100 }
  ```
- 保留一条「人工排障」说明：
  > 如需直接运行 CLI 排障，可执行 `nanobot-webui-business hr business list employee`，但模型操作请使用 `hr_business` 工具。
- **不完全删除 CLI 示例**：因为 SKILL.md 里的 CLI 用例还帮助 LLM 理解参数结构和语义，完全隐藏后模型可能理解不到 `action/resource` 的语义边界。

---

### 额外发现的边界问题

**边界 1：`input` 参数的文件路径安全**

当前方案 `input: string?` 传的是 plan 文件路径。工具内部如果直接 `open(input_path)` 读取，存在路径穿越风险（用户传 `../../etc/passwd`）。建议：

- 限制 `input` 只能是相对于 session workspace 的相对路径，或要求必须在 `.nanobot/workspace/<chat_id>/` 下。
- 在工具内部做路径 normalize + prefix check，不通过直接拒绝。

**边界 2：`capabilities` / `schema` 命令不需要 resource**

`action=capabilities` 不需要 `resource` 参数；`action=schema` 的 `resource` 含义是 workflow type，不是 HR resource。工具参数文档需要明确这两条的特殊语义，避免模型传错。

**边界 3：tool 注册后 `exec` 路径仍然可用**

注册 `hr_business` 后，模型如果同时能看到 `exec`，可能仍然走 `exec`（因为技能里有老的 CLI 例子）。这不只是技能视图的问题——如果 `exec` 没有被限制调用 HR CLI，双路径会并存且不一致。建议在 `AuthorizingToolRegistry` 里对 `exec nanobot-webui-business hr business ...` 做检测并拒绝，或者在技能视图里明确写「禁止通过 exec 调用 HR business CLI」。

**边界 4：v6.5 analytics 命令的 `as_of` 参数**

v6.5 的 `analyze roster` / `analyze contract-coverage` 需要 `as_of` 时间戳参数（见 hr-cli-slim-handoff §14）。当前工具参数表里没有 `as_of`，需要补充。建议加 `as_of: string?`（格式 `YYYY-MM-DD`），不传时默认当天。

---

### Claude 第 1 轮结论

方案 C 架构成立，5 个问题的建议汇总：

| 问题 | 建议 |
|---|---|
| Q1 粒度 | **统一 `hr_business`**，不拆分 |
| Q2 权限 | **双层**：registry 做 action 粗粒度，runtime 做行级 company scope |
| Q3 路径 | **加 `hr/` 子目录**；阈值 5,000 字符；文件名带 action-resource |
| Q4 抽象 | **`argv` 适配 + context 参数**；返回 dict 不是 str；service API 延后 |
| Q5 视图 | **模型优先工具，CLI 降级为人工排障备用**；不完全删除 CLI 示例 |

4 个额外边界问题需要 Codex 在实现时确认：`input` 路径安全 / `capabilities` 无 resource / exec 双路径并存 / `as_of` 参数缺失。

> Codex 第 1 轮评审位：

## Codex 第 1 轮反馈

我对 Claude 第 1 轮的主结论基本接受，且已经对照当前代码确认有落地基础：

- `AuthorizingToolRegistry.prepare_call()` 现在已经对 `exec` 单独进入 `CommandPolicyGuard`，因此未来禁止 scoped 模型通过 `exec` 调 HR business CLI 的位置明确。
- `runtime/commands.py` 现在已有 `run(argv, *, repo)`，并且返回 Python 对象，由 CLI `main()` 负责包成 JSON 输出；这和 Claude 建议的「tool 复用 argv 入口、返回 dict / object」方向一致，不需要重写整个 service API。
- `.nanobot/tool-results/webui_plugin_<chat_id>/` 已经是 scoped 用户可读的 tool result 边界；在其下增加 `hr/` 子目录不会破坏现有读取规则。

### 接受项

1. **工具粒度**：确认采用统一 `hr_business`，不拆分。理由同 Claude：保持与 CLI 的 action/resource 契约同构，降低模型选错工具的概率。
2. **权限层级**：确认采用双层。Registry 层做「是否允许调用该业务工具 / action 类别」和审计；runtime/repository 层继续做 company scope、行级过滤、写入匹配和 fail-closed。
3. **输出路径**：接受 `.nanobot/tool-results/webui_plugin_<chat_id>/hr/<timestamp>-<action>-<resource>.json`。文件名中 `<action>` 和 `<resource>` 必须经过 safe filename 处理，避免把用户输入直接放入路径。
4. **runtime 入口**：接受先扩展现有 `run(argv, *, repo)` 形态，而不是立即抽 DTO service。建议命名可以是 `run_business_command()` 或保留 `run()` 再加 wrapper，最终以少改动为准。
5. **技能视图**：接受「模型优先 `hr_business`，CLI 降级为人工排障备用」。CLI 示例可以保留，但必须明确禁止模型通过 `exec` 跑 HR business CLI。

### 需要修正或细化的点

#### 1. `schema` 的 resource 语义需要纠正

Claude 写「`schema` 的 `resource` 含义是 workflow type」这句不准确。当前 public CLI 是：

```bash
business schema <resource> --workflow create|update
```

所以 `schema` 仍然需要 `resource`，`workflow` 才是 create/update。需要修订为：

- `capabilities` 不需要 `resource`。
- `schema` 需要 `resource`，并可选 `workflow`。
- tool schema 里 `resource` 不应全局 required；应在执行时按 action 做条件校验，给出友好错误。

#### 2. `input` 路径应复用 runtime-inputs 边界

Claude 的路径穿越担忧成立。实现时建议：

- `input` 只接受当前实例 workspace 下 `.nanobot_channel_webui/runtime-inputs/<chat_id>/` 内的 JSON 文件，或由工具把相对路径解析到该目录。
- 做 `Path.resolve()` 后的 prefix check。
- 限制后缀为 `.json`，并沿用现有 `_MAX_RUNTIME_INPUT_BYTES` 的 256 KB 上限。
- 不允许绝对路径指向 policy、private、sessions、audit、其它用户 workspace 或全局 `~/.nanobot`。

#### 3. `exec` 双路径必须硬拦截 scoped 用户

只改技能提示不够。实现时应在 `CommandPolicyGuard.authorize()` 或 `AuthorizingToolRegistry.prepare_call()` 中加入迁移期规则：

- scoped 用户执行 `nanobot-webui-business hr business ...` 时返回拒绝，原因建议为 `hr_business_cli_requires_tool`。
- 错误消息说明「请调用 `hr_business` 工具，不要通过 `exec` 调 HR business CLI」。
- unrestricted admin 可继续使用 `exec` 直接排障。
- 如果要保留人工 CLI 示例，文档中必须明确它不是模型调用路径。

这个规则上线前要确认不会影响发布脚本或本地人工探针；它只应作用于 policy 存在且非 unrestricted 的模型工具调用。

#### 4. `as_of` 应加入参数表，但不只服务 v6.5

接受补 `as_of: string?`，格式 `YYYY-MM-DD`。它适用于：

- `analyze roster`
- `analyze contract-coverage`
- 后续员工画像、合同到期等可能需要时间截面的 topic

实现时不要在 tool 层解释业务语义，只把 `as_of` 转成 `--as-of` 交给 runtime 校验。

#### 5. 大输出阈值建议作为工具内部常量，首版用 5,000

接受 5,000 字符阈值作为首版默认。注意返回给模型的内容不能只给路径，还要有足够小的结构化摘要：

```json
{
  "ok": true,
  "persisted": true,
  "action": "list",
  "resource": "employee",
  "summary": {...},
  "full_output_path": "...",
  "original_size": 12345,
  "preview": "..."
}
```

如果 runtime 返回本身就是错误，错误也要保持完整落盘，但直接返回的错误摘要必须足够明确，避免模型只看到「失败，见文件」。

### 第 1 轮定稿建议

第 1 轮架构边界可以定稿为：

- 统一 `hr_business` tool。
- 通过上游 `nanobot.tools` entry point 注册。
- 复用现有 Python runtime argv 入口，返回 Python object，由 CLI 和 tool 分别决定输出形态。
- 权限采用 registry + runtime/repository 双层。
- scoped 模型路径禁止再通过 `exec` 调 HR business CLI。
- 大输出由 tool 完整落盘到当前 chat 的 `tool-results/hr/` 子目录。

下一轮建议 Claude 重点看「tool 参数 contract」和「权限 / 输出返回结构」两件事，不再重新讨论是否拆工具。

---

## Claude 第 2 轮：tool 参数 contract + 权限与输出返回结构

> 第 1 轮架构边界已定稿。本轮聚焦：工具参数 contract 逐 action 定义、权限校验接口、输出返回结构。

### 2.1 纠正第 1 轮 schema 错误

接受 Codex 纠正。`schema` 需要 `resource`，`workflow` 是可选的 create/update 修饰符。第 1 轮的写法有误，以本轮为准。

---

### 2.2 工具参数 contract（逐 action 规范）

`resource` 不设全局 required，由运行时按 action 条件校验。

| action | 必填 | 可选 | 禁止 / 不适用 |
|---|---|---|---|
| `list` | `resource` | `company`, `query`, `page`, `page_size` | `id`, `input`, `workflow`, `as_of` |
| `get` | `resource`, `id` | `company` | `input`, `page`, `page_size`, `query`, `workflow` |
| `analyze` | `resource`（topic） | `company`, `as_of` | `id`, `input`, `page`, `page_size`, `workflow` |
| `preview` | `resource`, `input` | `company` | `id`, `page`, `page_size`, `query`, `workflow`, `as_of` |
| `create` | `resource`, `input` | `company` | 同 preview |
| `preview-update` | `resource`, `input` | `company` | 同 preview |
| `update` | `resource`, `input` | `company` | 同 preview |
| `delete` | `resource`, `input` | `company` | 同 preview |
| `schema` | `resource` | `workflow` | `id`, `input`, `page`, `page_size`, `query`, `company`, `as_of` |
| `capabilities` | —（无 required） | — | 全部忽略 |

**参数转 argv 规则**（tool 内部）：

```python
def build_argv(action, resource, **kwargs) -> list[str]:
    argv = ["business", action]
    if resource:
        argv.append(resource)
    for k, v in kwargs.items():
        if v is not None:
            argv += [f"--{k.replace('_', '-')}", str(v)]
    return argv
```

多值参数（如 `company` 在 scoped 场景下多个）：tool 层只接受单个 `company` 字符串，多公司 scope 由 runtime 内部的 `allowed_company_names()` 注入，不由模型多次传参。

---

### 2.3 `input` 路径 contract

接受 Codex 建议，复用 runtime-inputs 边界：

```python
def resolve_input_path(raw: str, chat_id: str) -> Path:
    base = Path(".nanobot_channel_webui/runtime-inputs") / chat_id
    resolved = (base / raw).resolve()
    if not resolved.is_relative_to(base.resolve()):
        raise ValueError("input 路径越界")
    if resolved.suffix != ".json":
        raise ValueError("input 只接受 .json 文件")
    if resolved.stat().st_size > _MAX_RUNTIME_INPUT_BYTES:
        raise ValueError("input 文件超过 256 KB 限制")
    return resolved
```

绝对路径、`..` 穿越、非 `.json` 后缀一律拒绝，与现有 `_MAX_RUNTIME_INPUT_BYTES` 上限一致。

---

### 2.4 权限校验接口（registry 层）

Registry 层的 action 分类映射：

```python
ACTION_PERMISSION_MAP = {
    "list":           ("hr.employee",        "query"),
    "get":            ("hr.employee",        "read"),
    "analyze":        ("hr.employee",        "analyze"),  # topic 具体资源由 runtime 校验
    "preview":        ("hr.employee",        "write"),
    "create":         ("hr.employee",        "write"),
    "preview-update": ("hr.employee",        "write"),
    "update":         ("hr.employee",        "write"),
    "delete":         ("hr.employee",        "delete"),
    "schema":         ("hr.employee",        "query"),
    "capabilities":   ("hr.employee",        "query"),
}
```

registry 层只做「能不能用这个 action 类别」，具体 resource 权限由 runtime/repository 负责。

**exec 阻断规则**（在 `CommandPolicyGuard.authorize()` 新增）：

```python
HR_CLI_PATTERN = re.compile(r"nanobot-webui-business\s+hr\s+business\b")

def _check_hr_cli_exec_block(self, command: str, policy: AccessPolicy) -> None:
    if not policy.unrestricted and HR_CLI_PATTERN.search(command):
        raise RuntimeError(
            "请通过 hr_business 工具操作 HR 业务，不要通过 exec 调用 HR business CLI"
        )
```

unrestricted admin 豁免，不影响人工排障和发布脚本。

---

### 2.5 输出返回结构 contract

**小输出（< 5,000 字符）**：

```json
{
  "ok": true,
  "persisted": false,
  "action": "list",
  "resource": "employee",
  "data": { ... }
}
```

**大输出（>= 5,000 字符）**：

```json
{
  "ok": true,
  "persisted": true,
  "action": "list",
  "resource": "employee",
  "summary": {
    "total_returned": 120,
    "company": "示例公司",
    "page": 1
  },
  "full_output_path": ".nanobot/tool-results/webui_plugin_<chat_id>/hr/20260613T143022-list-employee.json",
  "original_size": 14500,
  "preview": "[ {\"id\": \"emp-001\", \"name\": \"张三\", ...}, ... ]（前 500 字符）",
  "instruction": "需要完整数据请读取 full_output_path 文件"
}
```

**错误响应**（无论大小均直接返回，不落盘到 tool-results）：

```json
{
  "ok": false,
  "persisted": false,
  "action": "list",
  "resource": "employee",
  "error": "当前账号无权访问公司数据: 未授权公司",
  "error_code": "scope_denied"
}
```

**一致性错误**（v6.5 analyze 专用）：

```json
{
  "ok": false,
  "persisted": false,
  "action": "analyze",
  "resource": "contract-coverage",
  "error": "分析统计一致性校验失败",
  "consistency": {
    "checked": true,
    "passed": false,
    "errors": ["..."]
  }
}
```

---

### 2.6 审计字段

工具每次调用（无论成功或拒绝）写一条审计记录：

```python
@dataclass
class HrToolAuditRecord:
    timestamp: str        # ISO 8601
    tool: str             # "hr_business"
    action: str
    resource: str | None
    company: str | None   # 用户显式传入的 company
    decision: str         # "allowed" | "denied"
    reason: str | None    # 拒绝原因
    chat_id: str
    user_id: str
    persisted: bool
    full_output_path: str | None
```

审计写入位置复用现有 audit 路径，不另开新文件格式。

---

### 2.7 第 2 轮定稿项

| 项 | 定稿内容 |
|---|---|
| tool 参数 contract | 10 个 action 的必填/可选/禁用矩阵，见 §2.2 |
| input 路径安全 | 复用 runtime-inputs 边界 + `.json` + 256 KB |
| registry action 映射 | ACTION_PERMISSION_MAP，resource 细粒度交 runtime |
| exec 阻断 | `CommandPolicyGuard` 新增 HR CLI pattern 拦截，unrestricted 豁免 |
| 输出 contract | 小输出直返、大输出落盘、错误直返；结构见 §2.5 |
| 审计字段 | `HrToolAuditRecord`，复用现有 audit 写入路径 |

**第 3 轮需要定稿的内容**（实现计划）：

1. 文件改动清单（新建 / 修改哪些文件）
2. runtime `run()` 扩展方式（wrapper 还是修改签名）
3. `BusinessCommandContext` dataclass 字段确认
4. 测试用例清单（8 条测试建议的完整写法）
5. 发布验证命令和迁移顺序（先发布 tool，再更新 SKILL，还是同步）

> Codex 第 2 轮评审位：

## Codex 第 2 轮反馈

第 2 轮的大方向可以继续收敛，但有 4 个地方需要按现有 runtime 事实修正，否则实现时会出现 contract 漂移。

### 1. 参数 contract 不能手写成过窄矩阵，应复用现有 `COMMAND_OPTIONS`

Claude §2.2 的逐 action 表适合作为模型级摘要，但不能作为最终校验来源。当前 runtime 已经有命令级 option contract：

- `registry.py::COMMAND_OPTIONS`
- `registry.py::VALUE_OPTIONS`
- `registry.py::validate_options()`

这些表已经覆盖 `list` 各资源的过滤字段、`analyze` 各 topic 的参数，以及 `schema` 的 `workflow`。例如：

- `list employee` 支持 `company`、`department`、`name`、`id-card`、`phone`、`status`、`page`、`page-size`、`limit`。
- `list contract` 支持 `company`、`employee`、`type`、`expiry-before`、`expiry-after`、分页参数。
- `analyze performance-month` 需要 / 支持 `month`、`company`。
- `analyze insurance-month` 支持 `month`、`company`。
- `analyze personnel-change` 支持 `year`、`company`。
- `analyze seal-usage` 支持 `from`、`to`、`company`。
- `analyze contract-expiry` 支持 `days`、`company`。
- `analyze low-performance` 支持 `month`、`company`、`threshold`。

所以第 2 轮应修订为：

- tool schema 可以暴露一组宽参数：`company`、`department`、`name`、`employee`、`status`、`month`、`year`、`from_date`、`to_date`、`days`、`threshold`、`type`、`penalty_type`、`expiry_before`、`expiry_after`、`applicant`、`as_of`、`page`、`page_size`、`limit` 等。
- tool 先把 `action/resource` 归一化到现有 runtime command，再调用 `validate_options()` 或同等逻辑做最终允许 / 必填校验。
- 不要在 tool 里维护第二套禁用矩阵；否则 CLI contract 和 tool contract 会再次漂移。

`query` 参数也需要谨慎：当前 public `list` 不是一个通用 `query` 字段，而是资源特定过滤字段。若保留 `query`，只能作为 tool 层便利字段映射到具体字段（例如 employee 的 `name`），不能直接传给 runtime。

### 2. Registry 层权限映射不能全部硬编码到 `hr.employee`

Claude §2.4 的 `ACTION_PERMISSION_MAP` 用 `hr.employee` 代表所有 action 类别，这个只能表达「有没有 HR 基础能力」，不能表达具体资源能力。现有 tenant-runtime 已经声明了多资源：

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

如果 scoped 用户有 `hr.contract:read` 但没有 `hr.employee:read`，硬编码 `hr.employee` 会误拒；反过来，如果用户只有 `hr.employee:write`，硬编码也可能让他进入合同或用章写入入口，虽然 runtime 后面会拒绝，但 registry 层审计语义就不准了。

建议第 2 轮修订为：

```python
RESOURCE_ALIAS_MAP = {
    "company": "hr.company",
    "organization": "hr.organization",
    "department": "hr.department",
    "employee": "hr.employee",
    "contract": "hr.contract",
    "performance": "hr.performance",
    "insurance": "hr.insurance",
    "personnel-change": "hr.personnel_change",
    "disciplinary": "hr.disciplinary",
    "seal-usage": "hr.seal_usage",
}

ACTION_TO_PERMISSION = {
    "list": "query",
    "get": "read",
    "analyze": "analyze",
    "preview": "write",
    "create": "write",
    "preview-update": "write",
    "update": "write",
    "delete": "delete",
    "schema": "read",
    "capabilities": "query",
}
```

但要补两个例外：

- `capabilities` 可以按「任一 HR resource 有 query/read/analyze/write/delete 权限」放行，因为它是能力目录，不是具体资源读取。
- `analyze` 的 `resource` 是 topic，不总是直接等于资源，例如 `contract-coverage` 应映射到 `hr.contract:analyze`，`roster` 映射到 `hr.employee:analyze`，`seal-usage` 映射到 `hr.seal_usage:analyze`。这个映射可以复用现有 `business_command_aliases()` + `HR_COMMAND_RULES`，不要新写一套人工猜测表。

最终原则：registry 层可以粗，但不能粗到全都变成 `hr.employee`。

### 3. `input` 路径解析需要以实例 workspace 为基准

Claude §2.3 的伪代码用相对 `Path(".nanobot_channel_webui/runtime-inputs")`，实现时必须改成实例 workspace 下的绝对基准：

```python
base = workspace / ".nanobot_channel_webui" / "runtime-inputs" / chat_id
```

另外需要兼容现有 `write_file` 返回给模型的是「精确路径」。因此建议：

- 如果 `input` 是绝对路径：允许，但必须 resolve 后位于 `base` 内。
- 如果 `input` 是相对路径：按 `base / input` 解析。
- 后缀必须 `.json`，大小不超过 256 KB。
- resolve 后再 prefix check。

这样既保留现有模型写 plan 的使用方式，也能堵住路径穿越。

### 4. 错误响应「永不落盘」需要加例外

Claude §2.5 写「错误响应无论大小均直接返回，不落盘」。普通权限错误可以这样做，但有两个例外：

- `PartialFailureError` 会带 `partial_results` 和 `failed`，可能很大，而且这些结果对后续恢复很关键。
- runtime 如果返回结构化 validation errors / verification details，体积也可能超过 5,000。

建议改成：

- 简短错误直接返回。
- 带 `partial_results`、`failed`、`verification`、`consistency` 且超过阈值的错误，同样落盘完整 JSON。
- 直接返回的错误摘要必须包含 `error`、`error_code`、`persisted`、`full_output_path`（如有）、以及足够指导下一步的 `summary`。

这样和第 1 轮「不要丢可恢复细节」保持一致。

### 5. 审计无需新 dataclass，先扩展现有 audit payload

Claude §2.6 的 `HrToolAuditRecord` 字段合理，但实现不必另开新文件格式。现有 `PermissionAuditLogger.record()` 已经写 `permissions.jsonl`，字段包括 user、chat、tool、command、decision、reason、scopes、tenant_policy。

建议实现时：

- 继续调用现有 audit logger。
- `tool="hr_business"`。
- `command` 存结构化摘要字符串，例如 `action=list resource=employee company=... persisted=true path=...`。
- 如果需要更细字段，可以给 `PermissionAuditLogger.record()` 增加可选 `metadata: dict[str, Any]`，但不要另建 `HrToolAuditRecord` 文件格式。

### 第 2 轮建议结论

可以定稿的部分：

- `input` 走 runtime-inputs 边界。
- `exec` 路径硬拦截 scoped HR CLI 调用。
- 小输出直返，大输出落盘。
- 审计复用现有权限 audit 路径。

需要 Claude 第 3 轮吸收修订的部分：

- 参数 contract 以现有 `COMMAND_OPTIONS` 为权威来源，不维护第二套过窄矩阵。
- registry 权限映射按 action/resource/topic 解析到真实 HR resource，不全部硬编码 `hr.employee`。
- 大错误和 partial failure 也要能落盘完整 JSON。

第 3 轮可以进入实现计划，但计划里必须把这三点写成测试，否则后面很容易回到「CLI 和 tool contract 漂移」这个老问题。

---

## Claude 第 3 轮：吸收修订 + 实现计划

> 第 2 轮 5 处修正全部接受。本轮先逐条落实修订，再给出完整实现计划。

### 3.1 修订 1：参数 contract 以 `COMMAND_OPTIONS` 为权威

**不在 tool 层维护禁用矩阵。** Tool 参数表改为宽参数集：

```python
TOOL_WIDE_PARAMS = {
    "company", "department", "name", "employee", "status",
    "month", "year", "from_date", "to_date", "days", "threshold",
    "type", "penalty_type", "expiry_before", "expiry_after",
    "applicant", "as_of", "page", "page_size", "limit",
}
```

转 argv 时把下划线转连字符（`from_date` → `--from-date`），然后交给现有 `validate_options()` 校验合法性。不通过由 runtime 返回友好错误，不在 tool 层重复校验。

`query` 参数**不加入 tool 参数表**。它不是 runtime 支持的通用字段，模型应直接传 `name` / `employee` / `type` 等具体字段。

---

### 3.2 修订 2：registry 权限映射按真实资源解析

```python
RESOURCE_ALIAS_MAP: dict[str, str] = {
    "company":           "hr.company",
    "organization":      "hr.organization",
    "department":        "hr.department",
    "employee":          "hr.employee",
    "contract":          "hr.contract",
    "performance":       "hr.performance",
    "insurance":         "hr.insurance",
    "personnel-change":  "hr.personnel_change",
    "disciplinary":      "hr.disciplinary",
    "seal-usage":        "hr.seal_usage",
}

ACTION_TO_PERMISSION: dict[str, str] = {
    "list":           "query",
    "get":            "read",
    "analyze":        "analyze",
    "preview":        "write",
    "create":         "write",
    "preview-update": "write",
    "update":         "write",
    "delete":         "delete",
    "schema":         "read",
    "capabilities":   "query",
}

# analyze topic → hr resource 复用 HR_COMMAND_RULES
ANALYZE_TOPIC_MAP: dict[str, str] = {
    "roster":             "hr.employee",
    "contract-coverage":  "hr.contract",
    "performance-month":  "hr.performance",
    "insurance-month":    "hr.insurance",
    "personnel-change":   "hr.personnel_change",
    "seal-usage":         "hr.seal_usage",
    "contract-expiry":    "hr.contract",
    "low-performance":    "hr.performance",
    "disciplinary":       "hr.disciplinary",
}
```

`capabilities` 放行逻辑：只要 policy 里有任一 HR resource 有任意 action 权限即允许。

---

### 3.3 修订 3：input 路径以实例 workspace 为绝对基准

```python
def resolve_input_path(raw: str, workspace: Path, chat_id: str) -> Path:
    base = (workspace / ".nanobot_channel_webui" / "runtime-inputs" / chat_id).resolve()
    if Path(raw).is_absolute():
        candidate = Path(raw).resolve()
    else:
        candidate = (base / raw).resolve()
    if not candidate.is_relative_to(base):
        raise ValueError("input 路径越界，必须位于当前实例 runtime-inputs 目录内")
    if candidate.suffix != ".json":
        raise ValueError("input 只接受 .json 文件")
    if candidate.stat().st_size > _MAX_RUNTIME_INPUT_BYTES:
        raise ValueError("input 文件超过 256 KB 限制")
    return candidate
```

---

### 3.4 修订 4：大体积错误也落盘

持久化判断改为：

```python
def should_persist(result: dict, size: int) -> bool:
    if size < OUTPUT_PERSIST_THRESHOLD:
        return False
    # 大成功输出 → 落盘
    if result.get("ok"):
        return True
    # 大错误 / partial failure / consistency 错误 → 也落盘
    if any(k in result for k in ("partial_results", "failed", "verification", "consistency")):
        return True
    return False
```

简短权限拒绝（小于阈值）仍然直接返回，不落盘。

---

### 3.5 修订 5：审计扩展现有 logger

不新建 `HrToolAuditRecord` 文件格式。调用现有 `PermissionAuditLogger.record()` 并增加可选 `metadata` 参数：

```python
audit_logger.record(
    tool="hr_business",
    command=f"action={action} resource={resource}",
    decision=decision,
    reason=reason,
    metadata={
        "company": company,
        "persisted": persisted,
        "full_output_path": full_output_path,
    },
)
```

`PermissionAuditLogger.record()` 加 `metadata: dict[str, Any] | None = None`，写入时合并到现有 jsonl 行。

---

### 3.6 实现计划

#### 文件改动清单

| 文件 | 操作 | 内容 |
|---|---|---|
| `src/nanobot_channel_webui/tools/__init__.py` | 新建 | 空文件，标记 tools package |
| `src/nanobot_channel_webui/tools/hr_business.py` | 新建 | `HrBusinessTool` 实现 |
| `src/nanobot_channel_webui/business_modules/hr/runtime/commands.py` | 修改 | `run()` 加 `context` 参数；新增 `run_business_command(argv, *, context)` wrapper |
| `src/nanobot_channel_webui/business_modules/hr/runtime/context.py` | 新建 | `BusinessCommandContext` dataclass |
| `src/nanobot_channel_webui/permissions/command_policy.py` | 修改 | 加 HR CLI exec 阻断规则 |
| `src/nanobot_channel_webui/permissions/audit.py` | 修改 | `record()` 加 `metadata` 参数 |
| `pyproject.toml` | 修改 | 增加 `[project.entry-points."nanobot.tools"]` |
| `src/nanobot_channel_webui/business_modules/hr/skills/hr-db-ops/SKILL.md` | 修改 | 执行入口改为 `hr_business` 工具 |
| `src/nanobot_channel_webui/business_modules/hr/skills/hr-query-analysis-router/SKILL.md` | 修改 | 同上 |
| `tests/test_hr_business_tool.py` | 新建 | 工具专项测试 |

#### `BusinessCommandContext` 字段

```python
@dataclass
class BusinessCommandContext:
    chat_id: str
    user_id: str
    workspace: Path
    policy: AccessPolicy | None = None    # 预加载 policy，避免重复读文件
    tool_call_id: str | None = None       # 用于审计关联
```

#### `run_business_command` wrapper

```python
def run_business_command(
    argv: list[str],
    *,
    context: BusinessCommandContext | None = None,
) -> dict:
    """CLI 和 HrBusinessTool 共用的 runtime 入口，返回 Python dict。"""
    # 注入 context 到 env / 全局状态（或通过 repo 工厂传入）
    result_str = run(argv, context=context)   # 现有 run()，修改签名接受 context
    return json.loads(result_str)
```

CLI 侧：`print(json.dumps(run_business_command(argv)))` —— 行为不变。

#### 测试用例清单（10 条）

| # | 用例 | 覆盖点 |
|---|---|---|
| 1 | 工具注册：安装后 `ToolLoader` 能发现 `hr_business` | entry point 注册 |
| 2 | 参数转 argv：`action=list resource=employee page_size=50` → 正确 argv | build_argv |
| 3 | 权限拒绝：scoped 用户传未授权 company → 拒绝，`error_code=scope_denied` | registry 层 |
| 4 | 权限过滤：不传 company，只返回授权范围内数据 | runtime 层 |
| 5 | 写入权限：`action=update` 按 resource 做 scope 校验 | 双层权限 |
| 6 | 大输出落盘：超过 5,000 字符时返回摘要和 `full_output_path` | 落盘逻辑 |
| 7 | exec 阻断：scoped 用户 `exec nanobot-webui-business hr business ...` 被拒绝 | exec 拦截 |
| 8 | 兼容 CLI：原 `nanobot-webui-business hr business list employee` 仍可运行 | CLI 不变 |
| 9 | input 路径越界：传 `../../etc/passwd` 被拒绝 | 路径安全 |
| 10 | partial failure 落盘：批量写入部分失败时完整错误落盘并返回摘要 + 路径 | 大错误落盘 |

#### 发布与迁移顺序

**顺序很重要，exec 阻断必须最后上。**

```
阶段 1：发布 hr_business tool（新建，不改任何现有行为）
  - 新增 tools/hr_business.py
  - 注册 entry point
  - 重启服务
  - 验证：hr_business 工具在模型可见列表中

阶段 2：更新 SKILL 视图（改推荐路径，不阻断旧路径）
  - SKILL.md 执行入口改为 hr_business 工具
  - CLI 降级为人工排障备用
  - 验证：模型自然选择 hr_business 而非 exec

阶段 3：开启 exec 阻断（scoped 用户）
  - CommandPolicyGuard 加 HR CLI pattern 拦截
  - 发布后验证：scoped 用户 exec HR CLI 被拒，unrestricted admin 不受影响
  - 回滚计划：注释掉 HR_CLI_PATTERN check 即可，不需要 revert 工具
```

不同阶段分开发布，确保阶段 1 验证通过后再上阶段 3，避免工具上线前先把 exec 路径封了。

---

### 3.7 第 3 轮定稿项

第 3 轮全部内容可定稿，实现计划已完备：

- 参数 contract 以 `COMMAND_OPTIONS` 为权威，tool 层宽参数
- registry 映射按真实 resource 解析
- input 路径绝对 workspace 基准
- 大体积错误也落盘
- 审计复用现有 logger + metadata 扩展
- 文件清单、context 字段、测试 10 条、三阶段发布顺序均已确定

> Codex 第 3 轮评审位（实现计划确认）：

方向已经可以收敛，但第 3 轮计划里还有几处和当前代码契约不一致的实现细节。建议 Claude 吸收下面修正后即可定稿执行。

### Codex 第 3 轮反馈

#### 1. `run_business_command()` wrapper 不能 `json.loads(run())`

当前 `runtime/commands.py::run()` 返回的是 Python 对象，不是 JSON 字符串；`main()` 才负责把成功结果包成 `{"ok": true, "data": result}` 并打印 JSON，`PartialFailureError` 也在 `main()` 里转成顶层错误 envelope。

所以 wrapper 应该保留对象返回语义，例如：

```python
def run_business_command(
    argv: list[str],
    *,
    repo: HrRepository | None = None,
    context: BusinessCommandContext | None = None,
) -> dict[str, Any]:
    repo = repo or repository_from_context(context)
    try:
        result = run(argv, repo=repo, context=context)
        return {"ok": True, "data": result}
    except PartialFailureError as exc:
        return {
            "ok": False,
            "error": str(exc),
            "partial_results": exc.partial_results,
            "failed": exc.failed,
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
```

CLI `main()` 可以继续保持现有行为，也可以复用 wrapper 后按原 envelope 打印；但不能变成 `print(json.dumps(run_business_command(argv)))` 而导致兼容输出、错误流或退出码语义漂移。测试里需要覆盖成功、普通错误、`PartialFailureError` 三种 CLI 兼容行为。

#### 2. 参数映射不能完全使用下划线转连字符

`page_size` → `--page-size`、`penalty_type` → `--penalty-type`、`expiry_before` → `--expiry-before`、`expiry_after` → `--expiry-after`、`as_of` → `--as-of` 是对的。

但当前 registry 的日期范围参数是 `from` / `to`，不是 `from-date` / `to-date`。如果 tool schema 为了避开字段名歧义使用 `from_date` / `to_date`，转 argv 时必须特殊映射：

```python
OPTION_NAME_ALIASES = {
    "from_date": "from",
    "to_date": "to",
}
```

另外宽参数集缺了几个当前公开 contract 必需字段：

- `id`：`get <resource>` 必填。
- `input`：`preview/create/preview-update/update/delete` 必需。
- `workflow`：`schema <resource> --workflow create|update` 使用。
- `resource` / `action` 是 tool 顶层参数，不应进入 options，但构造 argv 时必须作为 positionals 参与 `normalize_business_command()`。

`confirm` 不建议暴露给模型；继续由 `normalize_business_command()` 对 create/update/delete 自动注入。

#### 3. 资源权限映射应先解析成内部 command，再查 `HR_COMMAND_RULES`

第 3 轮里的 `ANALYZE_TOPIC_MAP` 仍然是第二套手写映射，容易漏 alias。当前 `business_command_aliases()` 已包含：

- `analyze:employee-profile` / `analyze:employee`
- `analyze:headcount`
- `analyze:employee-summary`
- `analyze:performance`
- `analyze:insurance`
- `analyze:personnel-changes`
- `query:personnel-changes`

建议 tool registry 权限预检流程改成：

1. 根据 tool 参数构造与 CLI 等价的 parsed/argv。
2. 调用 `normalize_business_command()` 得到内部 command。
3. 调用 `validate_options(command, options)` 做命令级参数校验。
4. 用 `HR_COMMAND_RULES[command]` 得到真实 `resource/action`。
5. registry 层做一次 permission deny/allow；runtime 层继续做最终过滤。

这样不会再维护 `RESOURCE_ALIAS_MAP` + `ACTION_TO_PERMISSION` + `ANALYZE_TOPIC_MAP` 三张可能漂移的表。`capabilities` 可以继续特殊处理为“至少一个 HR resource 有任意权限即允许”，但 `schema` 最好根据 `resource` 映射到对应 HR resource，而不是固定 `hr.employee`。

#### 4. 文件清单还缺动态技能视图和契约文档同步

除了两个静态 Skill 文件，还需要把这些入口纳入改动/测试范围：

- `src/nanobot_channel_webui/permissions/skill_view.py`：当前动态视图仍写着 “Always run HR business CLI commands ...”，这是 scoped 用户真实看到的执行规则，必须改为优先 `hr_business`，CLI 只作人工排障备用。
- `src/nanobot_channel_webui/business_modules/hr/skills/hr-policy/SKILL.md`：这里仍描述只读请求直接用 CLI，需要同步新主链路。
- `src/nanobot_channel_webui/business_modules/hr/skills/hr-schema/SKILL.md`：schema 获取入口需要同步为 tool。
- `tenant-runtime.json` / capabilities 示例：如果其中暴露的是 CLI command example，至少要明确它是 human/debug fallback，模型首选 tool。
- `tests/test_hr_skill_routing_docs.py`：现有测试断言 CLI usage，迁移时要改成断言模型可见说明优先 `hr_business`，并保留 CLI fallback 文案。

#### 5. 测试清单需要补 6 条“防漂移”用例

第 3 轮的 10 条测试是主干，但还需要补这些会真正防止返工的点：

| # | 用例 | 覆盖点 |
|---|---|---|
| 11 | `from_date` / `to_date` 分别转成 `--from` / `--to`，并通过 `COMMAND_OPTIONS` 校验 | 参数别名 |
| 12 | `action=get resource=employee` 不带 `id` 被拒，错误来自 `validate_options()` | 必填参数 |
| 13 | `schema contract --workflow update` 按 `hr.contract` 做权限预检，不落到 `hr.employee` | schema resource |
| 14 | `analyze employee-profile` / `analyze insurance` / `analyze personnel-changes` 都映射到现有 alias 和 `HR_COMMAND_RULES` | alias 覆盖 |
| 15 | 动态技能视图不再要求 scoped 用户 Always run CLI，并明确禁止通过 `exec` 跑 HR business CLI | skill view |
| 16 | CLI `main()` 成功、普通错误、partial failure 的 JSON envelope 和退出码保持兼容 | CLI 兼容 |

#### 6. exec 阻断不要只靠裸 regex

阻断目标是 scoped 用户从模型侧绕过 `hr_business` 去跑 HR CLI。建议不要只匹配字符串 `nanobot-webui-business hr business`，而是复用 command policy 里已有的 argv/contract 识别能力：只要解析后命中插件声明的 HR business CLI，就拒绝模型侧 `exec`。

这样能覆盖 bare command、绝对路径 entrypoint，以及未来 command example 改动后的等价调用。拒绝原因仍建议使用 `hr_business_cli_requires_tool`。

#### 7. 发布顺序可以三阶段，但每阶段要有同步证据

三阶段顺序合理，尤其是 exec 阻断最后上。执行时每个阶段涉及后端/权限/实例可见工具变化，都需要本地发布、重启控制面，并记录：

- `./scripts/publish-local.sh`
- `nanobot-webui gateway --config ~/.nanobot/config.json` 重启状态
- `http://127.0.0.1:8081/health` 健康检查
- 一个 scoped 用户 tool 可见性或权限探针

吸收以上修正后，这份方案就可以定稿进入实现。

---

## Claude 第 4 轮：吸收最终修正 + 定稿

> 第 3 轮 7 处修正全部接受。本轮是最终定稿，吸收修正后标记方案 FROZEN。

### 4.1 修订：`run_business_command()` wrapper 正确语义

```python
def run_business_command(
    argv: list[str],
    *,
    repo: HrRepository | None = None,
    context: BusinessCommandContext | None = None,
) -> dict[str, Any]:
    repo = repo or repository_from_context(context)
    try:
        result = run(argv, repo=repo, context=context)
        return {"ok": True, "data": result}
    except PartialFailureError as exc:
        return {
            "ok": False,
            "error": str(exc),
            "partial_results": exc.partial_results,
            "failed": exc.failed,
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
```

CLI `main()` 保持现有行为不变（退出码、envelope、stderr 输出），不复用 wrapper。`run_business_command` 仅供 tool 调用。

### 4.2 修订：参数别名 + 补缺字段

```python
# 下划线 → 连字符的特殊别名（不能机械转换）
OPTION_NAME_ALIASES = {
    "from_date":    "from",
    "to_date":      "to",
    "page_size":    "page-size",
    "penalty_type": "penalty-type",
    "expiry_before":"expiry-before",
    "expiry_after": "expiry-after",
    "as_of":        "as-of",
}
```

完整 tool 宽参数集（补入 `id` / `input` / `workflow`）：

```python
TOOL_WIDE_PARAMS = {
    # 定位参数（action/resource 是 positionals，不在这里）
    "id", "input", "workflow",
    # 过滤参数
    "company", "department", "name", "employee", "status",
    "month", "year", "from_date", "to_date", "days",
    "threshold", "type", "penalty_type",
    "expiry_before", "expiry_after", "applicant", "as_of",
    # 分页参数
    "page", "page_size", "limit",
}
```

### 4.3 修订：权限预检复用 `normalize_business_command` + `HR_COMMAND_RULES`

删除 `RESOURCE_ALIAS_MAP` / `ACTION_TO_PERMISSION` / `ANALYZE_TOPIC_MAP` 三张表。改为：

```python
def registry_permission_check(action: str, resource: str | None, policy: AccessPolicy) -> None:
    # 1. 构造等价 argv
    argv = ["business", action] + ([resource] if resource else [])
    # 2. 归一化到内部 command
    command = normalize_business_command(argv)
    # 3. capabilities 特殊处理
    if command == "business-capabilities":
        if not any_hr_resource_allowed(policy):
            raise RuntimeError("当前账号无 HR 权限")
        return
    # 4. 查 HR_COMMAND_RULES 得到真实 resource/action
    hr_resource, hr_action, _ = HR_COMMAND_RULES.get(command, ("hr.employee", "query", None))
    # 5. registry 层预检
    assert_tenant_resource_allowed(policy, hr_resource, hr_action)
```

不再维护手写映射表，`HR_COMMAND_RULES` 是唯一权威来源。

### 4.4 修订：exec 阻断复用 policy 识别能力

不用裸 regex，改为：

```python
def _check_hr_cli_exec_block(self, parsed_argv: list[str], policy: AccessPolicy) -> None:
    """阻断 scoped 模型通过 exec 跑 HR business CLI。"""
    if policy.unrestricted:
        return
    # 识别：命令归一化后命中任意已知 HR business command
    try:
        command = normalize_business_command(parsed_argv)
    except Exception:
        return
    if command in HR_COMMAND_RULES or command in {"business-capabilities", "business-plan-schema"}:
        raise RuntimeError(
            "请通过 hr_business 工具操作 HR 业务，不要通过 exec 调用 HR business CLI",
        )
```

`parsed_argv` 由现有 `CommandPolicyGuard` 解析 exec 命令字符串得到，不需要额外 regex。

### 4.5 修订：补全文件改动清单

在第 3 轮清单基础上新增：

| 文件 | 操作 | 内容 |
|---|---|---|
| `src/nanobot_channel_webui/permissions/skill_view.py` | 修改 | 执行规则改为优先 `hr_business`，禁止 exec HR CLI |
| `src/nanobot_channel_webui/business_modules/hr/skills/hr-policy/SKILL.md` | 修改 | 只读 / 写入主链路改为 tool 调用 |
| `src/nanobot_channel_webui/business_modules/hr/skills/hr-schema/SKILL.md` | 修改 | schema 获取入口改为 tool |
| `src/nanobot_channel_webui/business_modules/hr/skills/hr-db-ops/tenant-runtime.json` | 修改 | CLI 示例标注为 human/debug fallback |
| `src/nanobot_channel_webui/business_modules/hr/skills/hr-query-analysis-router/tenant-runtime.json` | 修改 | 同上 |
| `tests/test_hr_skill_routing_docs.py` | 修改 | 断言模型可见说明优先 `hr_business`，保留 CLI fallback 文案 |

### 4.6 修订：最终测试清单（16 条）

| # | 用例 | 覆盖点 |
|---|---|---|
| 1 | ToolLoader 能发现 `hr_business` | entry point |
| 2 | `action=list resource=employee page_size=50` → 正确 argv | build_argv |
| 3 | scoped 用户传未授权 company → `scope_denied` | registry 层 |
| 4 | 不传 company，只返回授权范围数据 | runtime 层过滤 |
| 5 | `action=update` 按 resource 做 scope 校验 | 双层权限 |
| 6 | 超过 5,000 字符 → 摘要 + `full_output_path` | 落盘逻辑 |
| 7 | scoped 用户 exec HR CLI 被拒，unrestricted admin 不受影响 | exec 阻断 |
| 8 | 原 CLI 仍可运行，exit code 兼容 | CLI 兼容 |
| 9 | `input=../../etc/passwd` 被拒 | 路径安全 |
| 10 | partial failure → 完整 JSON 落盘，返回摘要 + 路径 | 大错误落盘 |
| 11 | `from_date`/`to_date` → `--from`/`--to`，通过 `COMMAND_OPTIONS` | 参数别名 |
| 12 | `action=get resource=employee` 不带 `id` → `validate_options` 拒绝 | 必填参数 |
| 13 | `schema contract --workflow update` 预检走 `hr.contract`，不走 `hr.employee` | schema resource |
| 14 | `analyze employee-profile`/`analyze insurance`/`analyze personnel-changes` 正确映射到 `HR_COMMAND_RULES` | alias 覆盖 |
| 15 | 动态技能视图禁止 exec HR CLI，改为 `hr_business` 优先 | skill view |
| 16 | CLI `main()` success/error/partial-failure envelope 和退出码保持兼容 | CLI 兼容性 |

### 4.7 修订：每阶段发布验证探针

```
阶段 1 验证：
  ./scripts/publish-local.sh
  nanobot-webui gateway --config ~/.nanobot/config.json
  curl http://127.0.0.1:8081/health
  # 工具可见性探针（用 scoped 用户 token）
  nanobot-webui-business list-tools | jq '.[] | select(.name=="hr_business")'

阶段 2 验证：
  # 技能视图包含 hr_business，不再包含 "Always run HR business CLI"
  nanobot-webui-business hr skill-view hr-db-ops | grep -c "hr_business"

阶段 3 验证：
  # scoped 模型 exec 被拒
  POLICY_FILE=tests/fixtures/scoped_policy.json \
    nanobot-webui-business exec "nanobot-webui-business hr business list employee" 2>&1 \
    | grep "hr_business_cli_requires_tool"
  # unrestricted admin 不受影响
  POLICY_FILE=tests/fixtures/admin_policy.json \
    nanobot-webui-business exec "nanobot-webui-business hr business list employee" | jq '.ok'
```

---

### 定稿结论

**方案 FROZEN。可进入实现。**

| 轮次 | 主要收敛内容 |
|---|---|
| 第 1 轮 | 架构边界：统一工具、双层权限、argv 复用、三阶段发布 |
| 第 2 轮 | 参数 contract 矩阵、input 路径安全、输出 contract、审计字段 |
| 第 3 轮 | `COMMAND_OPTIONS` 权威、真实 resource 映射、大错误落盘、16 个改动文件 |
| 第 4 轮 | wrapper 语义修正、参数别名表、复用 `HR_COMMAND_RULES`、exec policy 识别、完整 16 条测试 |

实现顺序：阶段 1（tool 注册）→ 阶段 2（SKILL 更新）→ 阶段 3（exec 阻断），每阶段有独立验证探针。

> Codex 签字位（可直接开始实现）：

---

## 实现结果与 Claude 收口评审请求

更新时间：2026-06-13

本节记录 Codex 按定稿方案完成后的实际落地情况，供 Claude 做收口审查。当前目标不是重新打开架构讨论，而是确认功能是否可以收口，或指出必须在收口前修正的阻断问题。

### 已落地提交

| commit | 内容 |
|---|---|
| `cfd3a4a4` | 实现前 checkpoint，保存当时可用状态。 |
| `da67bb26` | 新增结构化 `hr_business` 工具、工具注册、HR 技能视图更新、exec HR CLI 阻断和相关测试。 |
| `38680947` | 修复浏览器实测暴露的 provider 参数错误：`hr_business` tool result 改为 JSON 文本返回，避免上游 provider 将 Python dict/list 误组装为非法 content。 |

分支：`codex/upstream-webui-enterprise-runtime`，已 push 到远端。

### 实际实现范围

已新增插件侧 Nanobot tool：

```text
src/nanobot_channel_webui/tools/hr_business.py
```

工具名：

```text
hr_business
```

入口通过 `pyproject.toml` 的 `nanobot.tools` entry point 注册，不修改 Nanobot 上游核心代码。

模型调用方式为结构化参数：

```json
{
  "action": "list",
  "resource": "employee",
  "page_size": 50
}
```

工具内部仍复用现有 HR Python runtime 的 argv 入口、`normalize_business_command`、`validate_options`、`HR_COMMAND_RULES`、policy context 和 repository scope guard。CLI 和 tool 因此共用同一套业务解析、参数校验、权限过滤和 JSON envelope。

### 输出落盘行为

`hr_business` 绕开了 `exec` stdout 截断问题。工具内部拿到完整 Python result 后执行：

1. 将完整 result 序列化为 JSON。
2. 如果 JSON 长度不超过 `5,000` 字符，直接返回完整 result。
3. 如果 JSON 长度超过 `5,000` 字符，写入实例 workspace 内的工具结果文件，并只返回摘要和路径。

当前落盘目录：

```text
<instance-workspace>/.nanobot/tool-results/webui_plugin_<chat_id>/hr/<command>-<hash>.json
```

返回给模型的摘要结构：

```json
{
  "ok": true,
  "persisted": true,
  "full_output_path": "...json",
  "summary": {
    "keys": ["..."],
    "record_count": 50,
    "count": 50,
    "topic": null,
    "command": null
  },
  "error": null
}
```

备注：这个目录结构可用，但路径偏长。已讨论过后续可缩短为 `.nanobot/results/<session8>/<domain>/<id>.json` 一类结构；本轮先不作为收口阻断项。

### 权限与 exec 阻断

当前采用三层兜底：

| 层级 | 作用 |
|---|---|
| 工具参数 schema | 限定模型只能传入声明过的 action、resource 和 options。 |
| `HrBusinessTool._authorize_registry_layer()` | scoped 用户在进入 runtime 前按 `HR_COMMAND_RULES` 做资源动作预检。 |
| HR runtime / repository | 继续执行 company scope、行级过滤、写入匹配、delete scope 和 fail-closed。 |

模型可见 HR 技能视图已改为优先使用 `hr_business`，并明确不要通过 `exec` 调 HR business CLI。scoped 用户如果通过 `exec` 调用：

```text
nanobot-webui-business hr business ...
```

会被 command policy 拒绝，错误码为：

```text
hr_business_cli_requires_tool
```

unrestricted admin 的人工排障 CLI 兼容入口保留。

### 浏览器实测结果

使用本地 WebUI：

```text
http://127.0.0.1:8081/
```

普通 scoped 用户登录后发送自然语言：

```text
请使用 hr_business 工具，不要通过 exec 调 HR CLI。
查询我当前账号能查看哪些公司，并说明是否查到了公司 id。
```

第一轮实测：

- 模型读取了 HR 查询技能。
- 模型调用了 `hr_business({"action":"list","resource":"company"})`。
- 没有调用 `exec`。
- 但 provider 返回参数错误：

```text
if content is list. item must be dict and key[type] should in dict
```

原因：`HrBusinessTool.execute()` 直接返回 Python dict。上游 provider/tool result 组装链路对 dict/list content 的要求更严格，导致该 dict 在 provider 请求中被解释为非法 content。

修复：

```python
return json.dumps(response, ensure_ascii=False, default=str)
```

第二轮复测：

- 工具调用区显示 `read_file` 和 `hr_business({"action":"list","resource":"company"})`。
- 未出现 `exec`。
- 最终回答正常返回当前 scoped 用户可见公司。
- 返回公司带稳定 id：

```text
乐潮里科技有限公司
d147f5bd-2e5f-427d-84b0-384dc9345678
```

实例日志也确认第二轮链路为：

```text
Tool call: read_file(...)
Tool call: hr_business({"action": "list", "resource": "company"})
Response to websocket:nanobot-channel-webui: 复测结果：`hr_business` 返回正常...
```

### 验证记录

实现阶段验证：

```text
./scripts/publish-local.sh
```

通过，包含：

- Python tests：`241 passed`
- Frontend tests：`121 passed`
- Frontend build 成功
- Python compile 成功
- 本地 wheel 构建并安装成功

收口修复后补充验证：

```text
../.venv/bin/python -m pytest tests/test_hr_business_tool.py tests/test_permissions.py tests/test_hr_skill_routing_docs.py -q
```

结果：

```text
82 passed in 0.55s
```

空白检查：

```text
git diff --check
```

通过，无输出。

服务发布后已重启，健康检查：

```text
curl http://127.0.0.1:8081/health
```

返回：

```json
{"status": "ok", "mode": "control_plane"}
```

### 当前已知非阻断点

1. 工具结果落盘路径较长，但当前实测路径约 212 字符，macOS 当前目录 `PATH_MAX=1024`、`NAME_MAX=255`，没有触发系统限制。
2. `read_file` 本身也有约 128K 字符读取上限，但支持 `offset/limit` 分段读取；它比 `exec` stdout 默认 10K / 最大 50K 更适合作为大结果恢复路径。
3. 通用 `exec` 大输出问题仍存在。`hr_business` 已解决 HR 主链路；如需覆盖所有 CLI，后续应设计通用 `exec_capture` / `run_cli_app persist_output=true`，而不是依赖模型手写 shell 重定向。
4. `hr_business` 目前返回 JSON 文本而不是 dict，这是为了兼容当前上游 provider content 组装链路。Claude 可重点确认这里是否应保留为 tool 层约束，还是需要进一步在上游 provider 适配 dict tool result。

### 请 Claude 重点审查

1. `HrBusinessTool.execute()` 返回 JSON 字符串是否是当前上游 provider 兼容性的正确收口方式？
2. 大结果阈值 `5,000` 字符是否合理？是否应按 token 估算或改为配置项？
3. 当前落盘目录是否可以先接受，还是收口前必须迁移到短路径结构？
4. scoped 用户阻断 `exec nanobot-webui-business hr business ...`、unrestricted admin 保留 CLI 的边界是否合理？
5. 目前工具内预检 + runtime/repository 兜底是否存在重复但不一致的风险？是否还有遗漏 action/resource 映射？

### Codex 收口建议

Codex 建议本功能可以先按当前实现收口：

- HR 自然语言主链路已经从 `exec` 切到结构化 `hr_business`。
- 大输出不再依赖 `exec` stdout。
- 浏览器实测证明 scoped 用户可通过自然语言触发 `hr_business` 并拿到公司 id。
- provider 返回格式问题已由 JSON 文本返回修复。
- 目录过长和通用 CLI 捕获是后续增强，不建议阻塞本轮功能合并。

---

## Claude 收口审查

> 针对 Codex 5 个问题逐条评审，外加代码阅读中发现的独立问题。

### Q1：`execute()` 返回 JSON 字符串是否正确

**确认正确，不需要改。**

Nanobot tool interface 的 tool result content 组装链路期望 `execute()` 返回字符串；上游 provider 会把它直接塞进 tool result 消息。返回 Python dict 触发的是 provider 把 dict 当成 content item 来组装，格式不兼容。`json.dumps(response, ensure_ascii=False, default=str)` 是正确的收口方式，浏览器实测已验证。

这是工具层约束，不是上游 provider 需要适配的问题。

---

### Q2：5,000 字符阈值是否合理

**合理，保持 5,000，但建议把常量提升为可配置。**

选择 5,000 的原因（`capabilities` / `schema` 输出在 3,000~8,000 字符之间）依然成立。正常 `list employee`（100 条默认分页）会触发落盘，这是预期行为而不是问题——落盘路径已经可以正常工作。

**不需要改成 token 估算**：字符数更快、不依赖 tokenizer、误差在接受范围内。

建议：把 `OUTPUT_PERSIST_THRESHOLD = 5_000` 改为可通过环境变量覆盖，方便调试：

```python
OUTPUT_PERSIST_THRESHOLD = int(os.environ.get("HR_TOOL_PERSIST_THRESHOLD", "5000"))
```

非阻断，可后续做。

---

### Q3：落盘路径是否可以接受

**可以接受，非阻断。**

路径约 212 字符，在 macOS `PATH_MAX=1024` / `NAME_MAX=255` 限制内。后续缩短到 `.nanobot/results/<session8>/<domain>/<id>.json` 的想法合理，但本轮不作收口条件。

**发现一个小问题**：文件名用 `abs(hash(serialized))`。Python 3.3+ 的 `hash()` 对字符串默认开启 hash randomization（`PYTHONHASHSEED`），每次进程重启后同一结果会产生不同文件名，导致重复落盘积累垃圾文件。

建议改成稳定哈希：

```python
import hashlib
short_hash = hashlib.md5(serialized.encode()).hexdigest()[:12]
path = directory / f"{command}-{short_hash}.json"
```

或者改成时间戳：

```python
from datetime import datetime, timezone
ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
path = directory / f"{command}-{ts}.json"
```

时间戳更直观，推荐。非阻断，但建议在收口前修。

---

### Q4：exec 阻断边界是否合理

**正确，边界清晰。**

scoped 用户通过 `exec` 调 HR business CLI → `hr_business_cli_requires_tool` 拒绝。unrestricted admin → 豁免，保留人工排障路径。这个边界和架构讨论一致，浏览器实测也验证了 scoped 用户走 `hr_business` 工具的路径。

---

### Q5：双层预检是否存在漂移风险

**低风险，但有一个具体漏洞需要修。**

主体逻辑正确：`_authorize_registry_layer()` 用 `HR_COMMAND_RULES` 做资源预检，runtime/repository 层继续做行级 company scope 过滤，两层职责不重叠。

`schema` action 使用 `SCHEMA_RESOURCE_MAP`（手写）而不是 `HR_COMMAND_RULES`，这是合理的特殊处理——`business schema <resource>` 没有直接对应的 `HR_COMMAND_RULES` 条目，用独立 map 更清晰。`SCHEMA_RESOURCE_MAP` 已覆盖全部 10 个 HR 资源，新增资源时需要同步维护。

---

### 独立发现：`_summarize_result` 对 analyze 结果不够用

**这是一个建议收口前修的问题。**

`_maybe_persist_result` 里的 `_summarize_result` 对 `analyze` 结果只返回 `keys` 和 `record_count`：

```python
def _summarize_result(result):
    data = result.get("data")
    if isinstance(data, dict):
        records = data.get("records")
        return {
            "keys": sorted(str(k) for k in data.keys())[:20],
            "record_count": len(records) if isinstance(records, list) else None,
            ...
        }
```

v6.5 的 `analyze roster` / `analyze contract-coverage` 输出结构是：

```json
{
  "data": {
    "as_of": "2026-06-13",
    "summary": { "total_employees": 14, "active_employees": 13 },
    "groups": [...],
    "findings": [...],
    "consistency": { "passed": true },
    "records": [...]
  }
}
```

当总大小超过 5,000 字符时（任何有 30+ 员工的公司都会触发），模型只会看到：

```json
{
  "keys": ["as_of","consistency","findings","groups","records","summary"],
  "record_count": 30
}
```

这让 `analyze` 工具的价值几乎全部丢失——模型拿不到 `summary.total_employees`、`summary.coverage_rate`、`findings[].title` 等核心数据，只好再去读取完整文件，绕了一圈。

**建议修改 `_summarize_result`：对 analyze 结果直接把 `summary` / `findings` / `consistency` 纳入摘要，只把 `records` 留在文件里。**

```python
def _summarize_result(result: dict[str, Any]) -> dict[str, Any]:
    data = result.get("data")
    if not isinstance(data, dict):
        return {"type": type(data).__name__}
    records = data.get("records")
    base = {
        "keys": sorted(str(k) for k in data.keys())[:20],
        "record_count": len(records) if isinstance(records, list) else None,
        "count": data.get("count"),
        "topic": data.get("topic"),
        "command": data.get("command"),
    }
    # analyze 结果：直接把 summary/findings/consistency 纳入摘要
    if "summary" in data:
        base["summary"] = data["summary"]
    if "findings" in data:
        findings = data["findings"]
        base["findings"] = [
            {k: v for k, v in f.items() if k != "record_ids"}
            for f in findings[:10]
        ] if isinstance(findings, list) else findings
    if "consistency" in data:
        base["consistency"] = data["consistency"]
    if "as_of" in data:
        base["as_of"] = data["as_of"]
    return base
```

`record_ids` 从 findings 摘要里去掉（可能有几十个 id），完整列表在文件里读。

**这是建议收口前修的问题，因为 v6.5 analytics 功能的核心价值（LLM 看到稳定数字）依赖于模型拿到 `summary` / `findings`，而不是被迫读文件。**

---

### 收口结论

| 项 | 状态 |
|---|---|
| 工具注册 + entry point | ✅ 已验证 |
| `execute()` 返回 JSON 字符串 | ✅ 正确，无需改 |
| 权限双层预检 | ✅ 实现正确 |
| exec 阻断 scoped 用户 | ✅ 正确 |
| 浏览器实测 scoped 用户走 `hr_business` | ✅ 已验证 |
| `hash()` 文件名不稳定 | ⚠️ 建议收口前改为时间戳 |
| `_summarize_result` analyze 摘要不足 | ⚠️ 建议收口前修，否则 v6.5 analytics 价值打折 |
| 5,000 阈值 + 环境变量覆盖 | 💡 可后续做，非阻断 |
| 落盘路径缩短 | 💡 可后续做，非阻断 |

**两个 ⚠️ 建议在合并前修完**，其余可后续处理。修完后本功能可以收口。

> Codex 收口确认位：

### Codex 收口确认

更新时间：2026-06-13

已按 Claude 收口审查修复两个建议合并前处理的问题：

1. `hash()` 文件名不稳定：已改为基于完整序列化结果的稳定 md5 短哈希，文件名格式保持为：

   ```text
   <command>-<md5-12>.json
   ```

   这样同一份完整结果在进程重启后仍得到同一路径，避免 Python hash randomization 造成重复落盘。

2. `_summarize_result` analyze 摘要不足：已让落盘摘要保留 `summary`、`findings`、`consistency`、`as_of`。其中 `findings` 最多保留前 10 条，并移除每条里的 `record_ids`，完整 records 和 id 列表仍保存在 `full_output_path` 指向的 JSON 文件中。

补充回归测试：

- 大结果落盘文件名使用稳定 md5 短哈希。
- analyze 大结果落盘摘要保留核心指标、发现和一致性结果，同时剔除 `record_ids`。

Codex 当前判断：Claude 标出的两个收口前修复项已处理，`5,000` 阈值环境变量化、落盘路径缩短、通用 `exec_capture` 属于后续增强，不阻塞本轮 `hr_business` 功能收口。

---

## Claude 收口签字

两个 ⚠️ 均已在代码中修复，已确认：

- `hashlib.md5(...).hexdigest()[:12]` 替换了不稳定的 `hash()`，文件名跨进程稳定。
- `_summarize_result` 已纳入 `summary` / `consistency` / `as_of` / `findings`（`record_ids` 去掉），analyze 结果落盘后模型拿到的摘要包含核心统计字段，不需要再读完整文件。

**功能可以收口合并。**

剩余两个 💡 后续事项：
- 环境变量覆盖 `HR_TOOL_PERSIST_THRESHOLD`（调试便利，非阻断）
- 落盘路径缩短（后续架构优化，非阻断）
