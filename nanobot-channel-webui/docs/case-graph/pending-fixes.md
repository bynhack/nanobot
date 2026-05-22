# Case Graph Pending Fixes

工作区：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui`

目标：记录 case-graph 这条链路中已经被代码直接证明、后续仍需要处理的问题。

原则：

- 只记录代码能直接坐实的问题和缺口
- 区分「原版实现自身的问题」与「当前 nanobot 尚未补齐的差异」
- 不写猜测，不写修复方案，不把旧认知当事实

## 一、原版 `Ga-web + skyable-cloud` 自身存在的问题

### P0: `excludedTrades` 的字段语义在原版内部不一致

现象：

- `QueryTradeDTO` 把 `excludedTrades` 定义成「排除的交易流水」
- 主查询里用于修正排除项的 SQL 实际按 `gt.id` 查询
- 主查询正式聚边时也按 `id NOT IN` 排除
- 但上下钻 SQL 又按 `serial_number NOT IN` 排除

证据：

- `cloud-data/src/main/java/com/skyable/cloud/data/domain/dto/trade/QueryTradeDTO.java`
- `cloud-data/src/main/resources/mapper/GaTradeMapper.xml`

定位：

- [QueryTradeDTO.java](../../../../公安系统/skyable-cloud/cloud-data/src/main/java/com/skyable/cloud/data/domain/dto/trade/QueryTradeDTO.java:35)
- [GaTradeMapper.xml](../../../../公安系统/skyable-cloud/cloud-data/src/main/resources/mapper/GaTradeMapper.xml:6374)
- [GaTradeMapper.xml](../../../../公安系统/skyable-cloud/cloud-data/src/main/resources/mapper/GaTradeMapper.xml:6470)
- [GaTradeMapper.xml](../../../../公安系统/skyable-cloud/cloud-data/src/main/resources/mapper/GaTradeMapper.xml:5705)
- [GaTradeMapper.xml](../../../../公安系统/skyable-cloud/cloud-data/src/main/resources/mapper/GaTradeMapper.xml:5762)

影响：

- 同一个字段在不同链路里混用了两种主键语义
- 这会让「主查询排除了什么」与「上下钻排除了什么」不再稳定一致

### P0: 群组边日期聚合存在明确代码错误

现象：

- 合并 `startDate` 时，当前值误写成再次解析 `startDateSub`
- 合并 `endDate` 时，`else` 和 `catch` 分支把值写回了 `startDate`

定位：

- [GaTradeServiceImpl.java](../../../../公安系统/skyable-cloud/cloud-data/src/main/java/com/skyable/cloud/data/service/impl/GaTradeServiceImpl.java:1256)
- [GaTradeServiceImpl.java](../../../../公安系统/skyable-cloud/cloud-data/src/main/java/com/skyable/cloud/data/service/impl/GaTradeServiceImpl.java:1271)

影响：

- 群组聚边后的时间范围可能被错误覆盖
- 这不是显示层问题，而是聚合结果本身错误

### P1: `sourceSelectId` 的建模、返回值和存储编码不一致

现象：

- 查询返回的 `sourceSelectId` 实际是节点 `label`，也就是名字
- 汇总分析前端也是按名称来比较「是否原始主体」
- 但图实体和更新 DTO 中，`sourceSelectId` 被建模成 `List<Integer>`
- Redis 存取用 `String.join("-")` / `split("-")`

定位：

- [GaTradeServiceImpl.java](../../../../公安系统/skyable-cloud/cloud-data/src/main/java/com/skyable/cloud/data/service/impl/GaTradeServiceImpl.java:353)
- [TradeVO.java](../../../../公安系统/skyable-cloud/cloud-data/src/main/java/com/skyable/cloud/data/domain/vo/trade/TradeVO.java:45)
- [dialogSummary.vue](../../../../公安系统/Ga-web/src/views/analysis/upper/dialogSummary.vue:287)
- [dialogSummary.vue](../../../../公安系统/Ga-web/src/views/analysis/upper/dialogSummary.vue:387)
- [GaCaseGraph.java](../../../../公安系统/skyable-cloud/cloud-data/src/main/java/com/skyable/cloud/data/domain/entity/GaCaseGraph.java:51)
- [CaseGraphEditDto.java](../../../../公安系统/skyable-cloud/cloud-data/src/main/java/com/skyable/cloud/data/domain/dto/graph/CaseGraphEditDto.java:33)

影响：

- 同名账户会让「原始主体」与「汇总新增主体」的区分失真
- 名称中如果包含 `-`，Redis 回读后的拆分结果会被破坏

### P1: 图状态持久化和重置是有损的

现象：

- 前端保存图时会发送：
  - `excludedAccountName`
  - `summarySelectedAccountName`
- 后端保存 DTO 和实体都没有这两个字段
- 前端重载图时却又尝试从图详情中恢复它们
- `resetCaseGraph(...)` 只恢复图内容、tradeCards、groupMap、graphData、excludedTrades
- 图日志实体也只保存了这些字段

定位：

- [customizeNode.vue](../../../../公安系统/Ga-web/src/views/analysis/upper/customizeNode.vue:2590)
- [CaseGraphEditDto.java](../../../../公安系统/skyable-cloud/cloud-data/src/main/java/com/skyable/cloud/data/domain/dto/graph/CaseGraphEditDto.java:21)
- [GaCaseGraph.java](../../../../公安系统/skyable-cloud/cloud-data/src/main/java/com/skyable/cloud/data/domain/entity/GaCaseGraph.java:51)
- [customizeNode.vue](../../../../公安系统/Ga-web/src/views/analysis/upper/customizeNode.vue:3717)
- [GaCaseGraphServiceImpl.java](../../../../公安系统/skyable-cloud/cloud-data/src/main/java/com/skyable/cloud/data/service/impl/GaCaseGraphServiceImpl.java:128)
- [GaCaseGraphLog.java](../../../../公安系统/skyable-cloud/cloud-data/src/main/java/com/skyable/cloud/data/domain/entity/GaCaseGraphLog.java:54)

影响：

- 汇总分析与取消上图依赖的名称级运行态不能被完整保存
- reset 并不是完整回滚，而是部分字段回滚

### P1: 钻取配置存在「可配置」与「实际执行」不一致

现象：

- 图实体保存了 `drillNums / drillType / minAmount / maxAmount`
- 手动钻取 DTO 也支持 `limit / drillType`
- 但主查询自动扩点时写死了 `drillType(1)`，并固定递归两层
- 上下钻 SQL 本身写死 `limit 10`
- Java 层的 `limit` 裁剪代码又被注释掉了

定位：

- [GaCaseGraph.java](../../../../公安系统/skyable-cloud/cloud-data/src/main/java/com/skyable/cloud/data/domain/entity/GaCaseGraph.java:101)
- [QueryTradeDrillDTO.java](../../../../公安系统/skyable-cloud/cloud-data/src/main/java/com/skyable/cloud/data/domain/dto/trade/QueryTradeDrillDTO.java:27)
- [GaTradeServiceImpl.java](../../../../公安系统/skyable-cloud/cloud-data/src/main/java/com/skyable/cloud/data/service/impl/GaTradeServiceImpl.java:382)
- [GaTradeMapper.xml](../../../../公安系统/skyable-cloud/cloud-data/src/main/resources/mapper/GaTradeMapper.xml:5742)
- [GaTradeMapper.xml](../../../../公安系统/skyable-cloud/cloud-data/src/main/resources/mapper/GaTradeMapper.xml:5797)
- [GaTradeServiceImpl.java](../../../../公安系统/skyable-cloud/cloud-data/src/main/java/com/skyable/cloud/data/service/impl/GaTradeServiceImpl.java:1117)
- [GaTradeServiceImpl.java](../../../../公安系统/skyable-cloud/cloud-data/src/main/java/com/skyable/cloud/data/service/impl/GaTradeServiceImpl.java:1148)

影响：

- 配置项不等于实际运行语义
- 用户在图配置中修改的部分参数，并不会完整进入主查询自动扩点链路

## 二、当前 `nanobot-channel-webui` 仍待补齐的差异

### P0: `phone` 链路仍未实现

现状：

- 当前查询结果仍固定返回 `phone: []`
- 前端也没有渲染话单关系

定位：

- [mysql_client.py](../../src/nanobot_channel_webui/case_graph/mysql_client.py:2087)
- [types.ts](../../frontend/src/case-graph/types.ts:141)

### P0: `excludedTrades` 还没有原版那种“按当前图节点集自动修正”的步骤

现状：

- 当前会直接把请求中的 `excludedTrades` 用于过滤
- 返回时也原样回填
- 没有原版 `queryTargetCardExcludedTrade(...)` 那一步清理历史失效排除项

定位：

- [mysql_client.py](../../src/nanobot_channel_webui/case_graph/mysql_client.py:307)
- [mysql_client.py](../../src/nanobot_channel_webui/case_graph/mysql_client.py:2091)

### P1: 前端还没有接上原版那套 `summary / excluded-name` 运行态闭环

现状：

- 类型层已声明：
  - `excludedAccountName`
  - `summarySelectedAccountId`
  - `summarySelectedAccountName`
- 但当前 `GraphTabState` 未维护这些运行态
- `handleAnalyze` 也没有把这些字段发给主查询

定位：

- [types.ts](../../frontend/src/case-graph/types.ts:159)
- [workbench.tsx](../../frontend/src/case-graph/workbench.tsx:40)
- [workbench.tsx](../../frontend/src/case-graph/workbench.tsx:365)

### P1: 右键菜单仍缺原版多项动作

现状：

- 当前可用的是：
  - 双向钻取
  - 上钻
  - 下钻
- 下列动作仍是 disabled：
  - 取消上图
  - 取消群组
  - 明细分析
  - 汇总分析
  - 资金关系图

定位：

- [graph-canvas.tsx](../../frontend/src/case-graph/graph-canvas.tsx:439)

### P1: 原版完整画布序列化能力仍未完全复刻

现状：

- 当前关系图状态已经把节点坐标保存到 `graph.layout.nodePositions`
- 刷新页面会优先读取 `case_graphs/{caseId}/{graphId}/graph.json` 的当前投影
- 但原版围绕 `graphContent` 的完整画布图元序列化、重置和回放能力还没有完全复刻

定位：

- [graph_repository.py](../../src/nanobot_channel_webui/case_graph/graph_repository.py)
- [workbench.tsx](../../frontend/src/case-graph/workbench.tsx)

影响：

- 当前可以解决刷新后关系图节点坐标漂移
- 但如果未来要做完整回放、重置到任意历史步骤、或保留非关系图元，还需要继续补齐画布层能力

### P1: 新建图时没有带入当前左侧主体基线

现状：

- 原版新增图会把当前左侧勾选 `tradeCards` 一并提交
- 当前新建图固定传 `tradeCards: []`

定位：

- [dialogNewBuild.vue](../../../../公安系统/Ga-web/src/views/analysis/upper/dialogNewBuild.vue:132)
- [upper/index.vue](../../../../公安系统/Ga-web/src/views/analysis/upper/index.vue:445)
- [workbench.tsx](../../frontend/src/case-graph/workbench.tsx:282)

说明：

- 这里成立的偏差是「新建图没有带入当前主体基线」
- 不成立的旧说法是「原版新建后会自动分析」；原版代码明确也是等待用户点击「分析上图」
- 证据见 [customizeNode.vue](../../../../公安系统/Ga-web/src/views/analysis/upper/customizeNode.vue:3852)

## 三、维护约束

- 新增问题前，先确认能否被代码直接定位
- 如果只是旧认知过期，先修正文档，再决定是否记为待修复项
- 当前 `nanobot-gap-notes.md` 继续只写「当前 nanobot 与原版之间仍成立的差异」
- 本文档用于记录：
  - 原版自身已确认的问题
  - 当前实现仍待补齐、且后续需要实际修复的问题
