# Case Graph Docs

这组文档只记录当前 `nanobot-channel-webui` 上图产品事实、功能状态和待办问题。

当前不再以原版 `Ga-web + skyable-cloud` 作为实现目标或差异跟踪基线。原版项目中有不少实现问题，后续规划应以当前产品目标、用户工作流、过程文件和本项目代码为准。

当前上图分析已经是产品主路径之一。关系图不只是渲染结果，而是案件研判过程资产：
`graph.json` 保存当前投影，`steps/*.json` 保存每次关系分析后的步骤快照，
`graph.layout.nodePositions` 保存布局位置。已加载交易流水会沉淀到
`facts/trades.jsonl`，`graph.json` 和步骤快照只保留 `factStore` 与 `edge.tradeIds`
引用，把关系边和交易事实关联起来，避免交易事实随着步骤数重复膨胀。

当前应优先阅读：

- [feature-tracker.md](./feature-tracker.md)
  - 当前上图产品功能台账
  - 用于规划时快速区分 `Done / Partial / Missing / Deferred`
- [pending-fixes.md](./pending-fixes.md)
  - 当前产品仍待补齐的问题和决策点
  - 只记录本项目当前真实状态，不按原版差异建账

本地过程文件也必须作为布局和步骤事实来源：

- `~/.nanobot/workspace/.nanobot_channel_webui/case_graphs/**/graph.json`
- `~/.nanobot/workspace/.nanobot_channel_webui/case_graphs/**/steps/*.json`
- `~/.nanobot/workspace/.nanobot_channel_webui/case_graphs/**/facts/trades.jsonl`

维护原则：

- 功能状态和规划视角写进 `feature-tracker.md`
- 当前待办、缺陷和开放决策写进 `pending-fixes.md`
- 不再新增或维护“原版实现对比 / 原版差异 / 原版问题”类跟踪文档
- 不再保留独立的过程计划文档作为当前事实来源
- 涉及扩图、钻取、补关系、恢复和回放的文档，必须写清楚已有节点坐标不可被自动重排；只有用户显式拖拽或未来明确的手动重布局动作才能改变已有位置
- 涉及图页面渲染、布局、交互、插件、事件、拖拽、框选、右键菜单、缩放和视口能力时，优先使用 G6 官方方案；只有官方能力无法表达业务语义时，才记录并实现自定义补充逻辑
