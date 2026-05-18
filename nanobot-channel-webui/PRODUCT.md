# Product

## Register

product

## Users

`nanobot-channel-webui` 面向需要通过浏览器使用 nanobot gateway 的实际操作者和管理员。

核心用户包括：

- 高频办公用户：在人事、企业运营、政务或内部数据查询场景中，通过自然语言发起任务、查看结果、下载生成内容。
- 管理员：负责安装插件、配置 `channels.webui_plugin`、管理技能、检查运行状态、处理认证和会话数据。
- 插件维护者：需要在不修改上游 `nanobot-ai` 核心代码的前提下，迭代 WebUI、兼容 runtime 漂移，并保证本地构建发布流程稳定。

用户的使用环境偏向桌面浏览器和内部系统场景，重点不是营销展示，而是可靠完成对话、会话管理、文件预览、工具结果查看和运行配置。

## Product Purpose

这个插件把 nanobot 的 gateway 能力包装成一个可独立安装、可随主工具环境启动的 WebUI channel。它保持上游 `nanobot-ai` 的安装和启动方式不变，通过 `nanobot.channels` entry point 提供浏览器聊天入口、HTTP / WebSocket 后端、上传签名、会话索引、设置页和可选的 PocketBase 账号体系。

成功标准是：

- 用户可以用 `uv tool install nanobot-ai --with nanobot-channel-webui --force` 安装插件，并继续用 `nanobot gateway` 启动。
- 前端对齐 assistant-ui 的 runtime、Thread、Composer、Message、ThreadList 等最佳实践，不为短期可用性堆叠非标准状态。
- 聊天输入、中文输入、技能选择、附件上传、流式消息、表格、图片、工具调用和只读会话都保持稳定。
- 发布流程可以通过 `./scripts/publish-local.sh` 自动完成校验、构建、静态资源同步、wheel 构建和安装。

## Brand Personality

品牌人格是「克制、可靠、清爽」。

界面应该像一个内部专家工作台：不抢戏，不堆装饰，状态表达明确，信息密度足够高。它要让用户相信每一次点击、发送、下载、删除和配置变更都有清晰反馈；同时保持足够轻，避免把聊天体验做成沉重的后台系统。

文案语气默认使用中文，短句、直接、可执行。技术名词可以保留英文，例如 WebSocket、PocketBase、runtime、wheel，但按钮、提示、工具提示和状态应优先中文化。

## Anti-references

这个产品不应该像：

- 营销型 AI 落地页：大标题、渐变英雄区、抽象口号不能替代真实工作流。
- 聊天玩具界面：过度拟人、过度动效、漂浮装饰会削弱专业性。
- 传统后台表单堆叠：所有能力塞进表格和弹窗会让对话主线失焦。
- 非标准 assistant-ui 拼装：为了保留旧实现而绕过 runtime、Composer、ThreadList 等官方抽象，会给后续迭代制造输入、会话和状态同步问题。
- 默认暴露所有小工具：复制、下载、全屏、删除等辅助动作应在 hover / focus 时出现，减少内容区噪声；触屏设备除外。

## Design Principles

1. **对话是主路径。** 聊天输入、流式状态、消息内容和会话切换优先级最高，设置、详情和工具面板都应该服务主路径，而不是争夺注意力。
2. **标准抽象优先。** assistant-ui 已经提供的 runtime、primitive、adapter 和 thread list 能力，应优先作为实现基座；除非有明确缺口，否则不要自造平行状态系统。
3. **辅助工具按需显露。** 内容区的下载、复制、全屏、删除等小工具默认安静，用户 hover 或键盘聚焦时再出现，保持阅读连续性。
4. **插件边界清晰。** WebUI-only 的 HTTP、WebSocket、sessions、uploads、settings 和 runtime compat 逻辑留在插件内，不要求上游 nanobot core 为插件做特殊改动。
5. **发布必须可验证。** 任何功能迭代都应能通过 Python 测试、前端测试、前端构建、源码编译和本地发布脚本验证，避免只在开发服务器里看起来可用。

## Accessibility & Inclusion

默认目标是可达到 WCAG 2.1 AA 的产品可用性：键盘可达、焦点状态清晰、颜色不作为唯一状态表达、中文工具提示完整、触屏设备保留关键操作入口。

界面需要兼容浅色、深色和系统主题；减少非必要动效，动效只用于状态确认和空间变化。内容区 hover-only 工具必须同时支持 `:focus-within` 或 `:focus-visible`，移动和触屏环境不能因为没有 hover 而失去下载、复制或全屏能力。
