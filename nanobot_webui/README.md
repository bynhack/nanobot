# Nanobot WebUI Channel

`nanobot_webui` 是一个独立的 nanobot channel。

它和 Telegram、Feishu、Email 这些内建 channel 一样，都是通过 `BaseChannel` 接入 nanobot 核心；不同点在于它不是单纯的平台适配器，而是一个“浏览器网关 + 前端应用 + 设置工作区”组合体。

本文档面向维护者，目标是说明：
- WebUI channel 在 nanobot 里的职责边界
- 它与上游官方 Channel Plugin Guide 的契约对应关系
- Python 核心模块如何协作
- 消息、流式输出、工具调用、媒体、设置管理的主链路
- 当前实现的关键限制和后续扩展点

## 1. 和上游 Channel Plugin Guide 的关系

官方文档：
- [Channel Plugin Guide](https://nanobot.wiki/cn/docs/0.1.5/advanced/channel-plugin)

官方文档定义的 channel/plugin 核心契约是：
- `start()` 长期运行，负责监听外部输入
- 收到外部消息后调用 `BaseChannel._handle_message(...)`
- agent 结果通过 `send(msg)` 发回
- 如需流式输出，实现 `send_delta()` 并启用 `"streaming": true`
- `default_config()` 用于 `nanobot onboard` 自动补配置

`nanobot_webui` 完全符合这套契约：
- 它是 `BaseChannel` 子类
- 浏览器发来的消息最终也走 `_handle_message()`
- agent 返回结果也走 `send()` / `send_delta()`

它比普通 channel 多出的部分是：
- 它自己承载了 HTTP 页面服务
- 它自己维护 WebSocket 连接
- 它自己管理浏览器会话历史重建
- 它自己实现附件上传和媒体签名
- 它自己提供配置/技能/运行态设置接口

可以这样理解：
- 内建 channel：平台适配器
- WebUI channel：平台适配器 + 浏览器应用网关 + 管理后台

## 2. 模块分层

`nanobot_webui` 的 Python 模块可以分成 4 层：

1. 入口与编排
   - `channel.py`
2. WebSocket / HTTP 支撑
   - `auth.py`
   - `connections.py`
   - `protocol.py`
   - `runtime.py`
3. 会话 / 媒体 / 上传
   - `sessions.py`
   - `media.py`
   - `uploads.py`
4. 设置工作区管理
   - `management.py`

结论先说：
- `channel.py` 是唯一主入口
- 其余模块都在为 `channel.py` 提供支撑能力
- 这个 WebUI 不直接改 nanobot core 的主业务逻辑，而是通过 `BaseChannel`、`AgentHook`、bus 和 session 重建接入现有 AgentLoop

## 3. 主入口：`channel.py`

文件：
- [channel.py](/Users/brian/Documents/Project/nanobot/nanobot_webui/channel.py)

### 3.1 `WebUIConfig`

定义 WebUI channel 的配置：
- `enabled`
- `host`
- `port`
- `allowed_origins`
- `auth_token`
- `media_token_ttl_seconds`
- `streaming`
- `title`

关键字段：
- `auth_token`：浏览器端是否必须认证
- `streaming`：是否启用流式输出

### 3.2 `_TurnTracker`

`_TurnTracker` 负责跟踪某个 chat 当前 turn 是否已经产生过流式输出。

它解决的问题是：
- 已经通过 `send_delta()` 发出的文本，不应在最终阶段重复 append
- 没有走流式输出的 turn，需要在最终阶段补一个 `turn.completed`

内部状态：
- `_stream_activity`
- `_active_stream_ids`

### 3.3 `WebUIHook`

`WebUIHook` 是 WebUI 和 AgentLoop 之间的桥。

职责：
- 工具调用前发送 `tools.started`
- 工具调用后发送 `tools.finished`
- 非工具分支完成时发送 `turn.completed`

关键方法：
- `before_execute_tools()`
- `after_iteration()`

它依赖 `runtime.current_route_context()` 获取当前 WebUI 会话上下文：
- `chat_id`
- `session_key`
- `wants_streaming`

### 3.4 `WebUIChannel`

`WebUIChannel` 是浏览器 channel 的主体。

职责：
- 创建 aiohttp app
- 暴露 HTTP 路由和 WebSocket 路由
- 把浏览器命令转成 `_handle_message()` 调用
- 把 nanobot 的最终消息、流式 delta、工具事件广播回前端

关键依赖：
- `WebUIAccessControl`
- `ConnectionRegistry`
- `SessionQueryService`
- `MediaService`
- `WebUIManagementService`
- `attach_webui_runtime()`

## 4. HTTP / WebSocket 路由

`channel.py` 中注册的路由类型：

页面与连接：
- `GET /`
- `GET /ws`

会话：
- `GET /sessions`
- `DELETE /sessions/{chat_id}`

设置页 API：
- `GET /api/settings/skills`
- `GET /api/settings/skills/{name}`
- `GET /api/settings/skills/{name}/file`
- `POST /api/settings/skills/{name}/toggle`
- `GET /api/settings/config`
- `POST /api/settings/config`
- `GET /api/settings/runtime`

附件与媒体：
- `POST /uploads/{chat_id}`
- `GET /media/{token}`

### 4.1 WebSocket 主循环

浏览器连接主流程：
1. 权限校验
2. 建立 WebSocket
3. 恢复已有 chat 或创建新 chat
4. 在 `ConnectionRegistry` 中订阅 chat
5. 发 `session.init`
6. 如为已存在 chat，发 `session.history`
7. 进入命令循环

支持的命令：
- `message.send`
- `message.cancel`
- `session.new`
- `session.switch`

具体行为：
- `message.send`：必要时把附件转成模型补充提示，再调 `_handle_message()`
- `message.cancel`：发送 `/stop`
- `session.new`：仅在 WebUI 层切新 chat id
- `session.switch`：切换 chat 并重载历史

## 5. 与 `BaseChannel` 的对接方式

上游 BaseChannel 契约文件：
- [base.py](/Users/brian/Documents/Project/nanobot/nanobot/channels/base.py)

WebUI 和其他 channel 的共同点：
- 收到外部消息后，最终调用 `_handle_message()`
- 回复通过 `send()` 发送
- 流式输出通过 `send_delta()` 发送

这和官方 plugin 文档完全一致。

不同点只是 WebUI 的“外部平台”是浏览器，而不是 Telegram、Feishu、Email。

## 6. 访问控制：`auth.py`

文件：
- [auth.py](/Users/brian/Documents/Project/nanobot/nanobot_webui/auth.py)

`WebUIAccessControl` 统一处理：
- origin 校验
- token 校验

支持的 token 来源：
- `Authorization: Bearer ...`
- `X-WebUI-Token`
- query string：`token`
- query string：`auth_token`

设计特点：
- 未配置 `auth_token` 时允许匿名访问
- 未配置 `allowed_origins` 时默认只允许当前 host 同源访问
- `"*"` 表示允许任意来源

## 7. 连接注册表：`connections.py`

文件：
- [connections.py](/Users/brian/Documents/Project/nanobot/nanobot_webui/connections.py)

`ConnectionRegistry` 维护：
- 哪些 websocket 订阅了哪个 `chat_id`
- 哪些 chat 已删除，不应再收消息

核心方法：
- `subscribe()`
- `unsubscribe()`
- `emit_to_ws()`
- `emit_to_chat()`
- `delete_chat()`
- `mark_active()`
- `is_blocked()`

设计特点：
- 全部是内存态
- 不负责持久化
- 只负责广播与连接生命周期

## 8. 协议定义：`protocol.py`

文件：
- [protocol.py](/Users/brian/Documents/Project/nanobot/nanobot_webui/protocol.py)

WebUI 前后端共享协议定义在这里。

### 8.1 浏览器命令

当前支持：
- `message.send`
- `message.cancel`
- `session.new`
- `session.switch`

### 8.2 服务端事件

当前支持：
- `session.init`
- `session.history`
- `session.deleted`
- `turn.phase`
- `turn.delta`
- `tools.started`
- `tools.finished`
- `turn.completed`
- `error`

### 8.3 当前协议限制

当前协议只有一条文本输出通道：
- `turn.delta.delta`
- `turn.completed.content`

没有：
- `reasoning_delta`
- `reasoning_content`
- `thinking_blocks`

这意味着 WebUI 协议层当前没有给“思考消息”留独立表示。

## 9. Runtime 挂接：`runtime.py`

文件：
- [runtime.py](/Users/brian/Documents/Project/nanobot/nanobot_webui/runtime.py)

这个模块的作用是把 WebUI 请求上下文挂进 AgentLoop。

核心结构：
- `WebUIRouteContext`
- `_ROUTE_CONTEXT`（`ContextVar`）

关键函数：
- `push_route_context()`
- `pop_route_context()`
- `current_route_context()`
- `attach_webui_runtime()`

### 9.1 为什么需要它

`WebUIHook` 在工具调用和流式完成阶段需要知道：
- 当前运行属于哪个 WebUI chat
- 当前是否是流式请求

但 hook 本身拿不到 HTTP 请求对象。

因此 `attach_webui_runtime()` 会包一层 `AgentLoop._process_message`：
- 如果消息来自 `webui`
- 就把 `InboundMessage + wants_streaming` 写入 `ContextVar`

这样后续 hook 就能通过 `current_route_context()` 读到正确的上下文。

### 9.2 设计特点

这是一个轻侵入方案：
- 不改 core 协议
- 通过 monkey patch 包一层 `_process_message`
- 通过 `gc` 在同一个 bus 上找到 live `AgentLoop`

## 10. 会话与历史重建：`sessions.py`

文件：
- [sessions.py](/Users/brian/Documents/Project/nanobot/nanobot_webui/sessions.py)

`SessionQueryService` 负责：
- 列出 WebUI 会话摘要
- 从底层 session 重建前端可显示历史

### 10.1 会话 key

WebUI 会话 key 格式：
- `webui:{chat_id}`

### 10.2 删除机制

删除不只是删 session 文件，还会维护：
- `.nanobot_webui_deleted_sessions.json`

作用：
- 即使底层 session 文件还在，WebUI 层也可以把它视为已删除

### 10.3 `load_history()` 的重建逻辑

它会把底层 `Session.messages` 转成前端 `HistoryMessage[]`：

用户消息：
- 提取文本
- 提取图片/文件占位符
- 转成 `type: "user"`，必要时附带 `media`

助手消息：
- 读取 `assistant.content`
- 如果有 `tool_calls`，继续向后吃掉连续 `tool` 消息
- 转成：
  - `type: "assistant"`
  - `type: "tools"`
  - `type: "outbound"`（针对 `message` 工具）

### 10.4 当前限制

历史重建时：
- 只读取 assistant 的 `content`
- 不透传 `reasoning_content`
- 不透传 `thinking_blocks`

因此历史回放也没有单独的思考消息。

## 11. 媒体签名与上传

### 11.1 `media.py`

文件：
- [media.py](/Users/brian/Documents/Project/nanobot/nanobot_webui/media.py)

`MediaService` 把本地文件路径转换成短期有效的浏览器访问 URL。

关键方法：
- `build_media_item()`
- `build_media_items()`
- `issue_token()`
- `resolve_token()`

本地文件会被映射成：
- `/media/{token}`

token 内部包含：
- 文件绝对路径
- 过期时间
- HMAC 签名

远程 URL 则直接透传。

### 11.2 `uploads.py`

文件：
- [uploads.py](/Users/brian/Documents/Project/nanobot/nanobot_webui/uploads.py)

职责：
- 给附件分类
- 生成模型可读的文件补充提示
- 生成上传目标路径

关键方法：
- `classify_attachment_type()`
- `attachment_prompt_suffix()`
- `next_upload_path()`

上传目录：
- `workspace/.nanobot_webui_uploads/{chat_id}/`

非图片文件会追加：
- `[file: ...]`
- `[File: source: /abs/path]`

这样模型后续可以通过工具读取本地文件。

## 12. 设置工作区：`management.py`

文件：
- [management.py](/Users/brian/Documents/Project/nanobot/nanobot_webui/management.py)

这是设置页的 Python 后端。

职责分 3 类：

### 12.1 技能管理

关键方法：
- `list_skills()`
- `get_skill()`
- `set_skill_enabled()`
- `get_skill_file()`

当前特点：
- 只扫描 `workspace/skills`
- 通过 `SKILL.md` / `SKILL.disabled.md` 切换启用状态
- 不要求 nanobot core 改动

### 12.2 配置管理

关键方法：
- `config_snapshot()`
- `save_config()`

当前管理对象：
- `~/.nanobot/config.json`

返回内容包括：
- 原始 JSON 文本
- 已解析配置
- 顶层 section
- 实例目录资源文件列表

### 12.3 运行态观测

关键方法：
- `runtime_snapshot()`

聚合内容包括：
- workspace
- config metrics
- 最近日志
- 最近 session 状态文件
- 最近 memory / plan 文件
- 最新日志预览

## 13. 一条完整消息链路

### 13.1 浏览器发消息

1. 前端通过 WebSocket 发 `message.send`
2. `protocol.parse_client_command()` 解析命令
3. `channel._handle_ws()` 收到命令
4. 如果有附件，调用 `attachment_prompt_suffix()`
5. 最终调用 `_handle_message()` 把消息送入 nanobot

### 13.2 AgentLoop 执行

1. `runtime.attach_webui_runtime()` 预先把 route context 挂进 AgentLoop
2. AgentLoop 运行期间，`WebUIHook` 可以知道当前 chat
3. 如有工具调用，WebUIHook 广播：
   - `turn.phase(running_tools)`
   - `tools.started`
   - `tools.finished`

### 13.3 流式输出

1. core 调 `send_delta()`
2. WebUIChannel 广播：
   - `turn.phase(streaming)`（仅新 stream）
   - `turn.delta`
3. 前端把 delta 累加到单一的 `streamBuffer`

### 13.4 最终完成

1. WebUIHook 或 `channel.send()` 发 `turn.completed`
2. 前端先提交 `streamBuffer`
3. 再提交 pending tools
4. 最终补 assistant / outbound 消息

## 14. 和内建 channel 的异同

共同点：
- 都是 `BaseChannel` 子类
- 都通过 `_handle_message()` 进 bus
- 都通过 `send()` / `send_delta()` 出结果

不同点：
- 内建 channel 大多只是平台适配层
- WebUI 额外承担：
  - HTTP 页面服务
  - WebSocket 会话层
  - 会话重建
  - 媒体签名和上传
  - 设置管理后台

所以：
- 在“核心接法”上，WebUI 和官方 plugin / 内建 channel 是同一体系
- 在“复杂度”上，WebUI 明显更重

## 15. 当前关键限制

### 15.1 思考消息没有独立通道

当前 provider / runner 层虽然能保留：
- `reasoning_content`
- `thinking_blocks`

但 WebUI：
- 协议层没有独立字段
- 流式层没有 reasoning delta
- 历史重建层不透传 reasoning
- 前端消息模型也没有 reasoning 类型

所以 WebUI 现在不能把“思考过程”和“正式回答”分开显示。

### 15.2 设置页能力全部由 WebUI 自己实现

这是当前的重要设计原则：
- 不改 nanobot core
- 所有技能 / 配置 / runtime 管理都在 WebUI 层完成

## 16. 建议的后续演进顺序

如果后续继续迭代，建议按这个顺序：

1. 先扩协议
   - 是否增加 `reasoning_delta`
   - 是否在 `turn.completed` 带 `reasoningContent`

2. 再扩 session 历史
   - `load_history()` 是否保留 `reasoning_content`
   - 前端消息模型是否引入 reasoning 类型

3. 最后做 UI
   - 可折叠思考区
   - 工具时间线
   - 更细的设置工作区拆分

## 17. 代码入口索引

主入口：
- [channel.py](/Users/brian/Documents/Project/nanobot/nanobot_webui/channel.py)

访问控制：
- [auth.py](/Users/brian/Documents/Project/nanobot/nanobot_webui/auth.py)

连接广播：
- [connections.py](/Users/brian/Documents/Project/nanobot/nanobot_webui/connections.py)

协议：
- [protocol.py](/Users/brian/Documents/Project/nanobot/nanobot_webui/protocol.py)

runtime 接入：
- [runtime.py](/Users/brian/Documents/Project/nanobot/nanobot_webui/runtime.py)

会话重建：
- [sessions.py](/Users/brian/Documents/Project/nanobot/nanobot_webui/sessions.py)

媒体签名：
- [media.py](/Users/brian/Documents/Project/nanobot/nanobot_webui/media.py)

上传：
- [uploads.py](/Users/brian/Documents/Project/nanobot/nanobot_webui/uploads.py)

设置管理：
- [management.py](/Users/brian/Documents/Project/nanobot/nanobot_webui/management.py)
