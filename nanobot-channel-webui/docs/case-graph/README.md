# Case Graph Docs

这组文档现在保留三类信息：

1. 原版 `Ga-web + skyable-cloud` 的当前真实实现
2. `nanobot` 当前实现与原版之间仍成立的差异
3. 已经被代码直接证明、后续仍待修复的问题

当前上图分析已经是产品主路径之一。关系图不只是渲染结果，而是案件研判过程资产：
`graph.json` 保存当前投影，`steps/*.json` 保存每次关系分析后的完整步骤快照，
`graph.layout.nodePositions` 保存布局位置。

当前应优先阅读：

- [current-ga-implementation.md](./current-ga-implementation.md)
  - 原版 `Ga-web + skyable-cloud` 的事实基线
  - 包含接口链路、状态语义、`/trade/query` 的确定性执行流程、时序图和逐步输入/输出清单
- [nanobot-gap-notes.md](./nanobot-gap-notes.md)
  - `nanobot` 当前实现与原版之间仍成立的差异
- [pending-fixes.md](./pending-fixes.md)
  - 已被代码直接证明、后续仍待修复的问题
  - 同时区分原版自身的问题与当前 `nanobot` 尚未补齐的差异
- [real-example/query-payload.json](./real-example/query-payload.json)
  - 原版 `/trade/query` 的真实请求样本
- [real-example/query-response.json](./real-example/query-response.json)
  - 原版 `/trade/query` 的真实返回样本

本地过程文件也必须作为布局和步骤事实来源：

- `~/.nanobot/workspace/.nanobot_channel_webui/case_graphs/**/graph.json`
- `~/.nanobot/workspace/.nanobot_channel_webui/case_graphs/**/steps/*.json`

已清理：

- 过程型重建计划文档
- 已被总文档吸收、容易继续分叉的前后端拆分 contract 文档

维护原则：

- 事实写进 `current-ga-implementation.md`
- 差异写进 `nanobot-gap-notes.md`
- 待修复问题写进 `pending-fixes.md`
- 不再保留独立的过程计划文档作为当前事实来源
- 涉及扩图、钻取、补关系、恢复和回放的文档，必须写清楚已有节点坐标不可被自动重排；只有用户显式拖拽或未来明确的手动重布局动作才能改变已有位置
- 涉及图页面渲染、布局、交互、插件、事件、拖拽、框选、右键菜单、缩放和视口能力时，优先使用 G6 官方方案；只有官方能力无法表达业务语义时，才记录并实现自定义补充逻辑
