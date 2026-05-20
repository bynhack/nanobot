# nanobot Current Gap Notes Against Ga-web + skyable-cloud

工作区：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui`

目标：只记录当前 `nanobot` 与原版 `Ga-web + skyable-cloud` 仍然成立的差异，不写修复方案。

## 范围

- 后端：
  - `src/nanobot_channel_webui/case_graph/service.py`
  - `src/nanobot_channel_webui/case_graph/mysql_client.py`
  - `src/nanobot_channel_webui/case_graph/types.py`
  - `src/nanobot_channel_webui/case_graph/storage.py`
- 前端：
  - `frontend/src/case-graph/types.ts`
  - `frontend/src/case-graph/adapters.ts`
  - `frontend/src/case-graph/store.ts`
  - `frontend/src/case-graph/workbench.tsx`
  - `frontend/src/case-graph/graph-canvas.tsx`
  - `frontend/src/case-graph/case-rail.tsx`

## 先校正：以下旧结论已经不成立

这次按当前代码重新核对后，下面这些旧判断应该视为过期：

- `/trade/query` 不再是早期那种 `graph.nodes / graph.edges` 简化返回。
  - 当前后端主查询返回的是：
    - `nodes`
    - `money`
    - `phone`
    - `excludedTrades`
    - `groups`
    - `sourceSelectId`
  - 对应代码：
    - `src/nanobot_channel_webui/case_graph/mysql_client.py::_build_query_result`
    - `frontend/src/case-graph/types.ts::CaseGraphQueryResult`
- 后端主流程不再缺 `groupMap / sourceSelectId / summarySelectedAccountId / excludedAccountName / minAmount / maxAmount` 这些核心字段。
  - 当前 `CaseGraphState` 和 `CaseGraphSnapshot` 已经能承载这些字段。
  - 对应代码：
    - `src/nanobot_channel_webui/case_graph/types.py::CaseGraphState`
    - `frontend/src/case-graph/types.ts::CaseGraphSnapshot`
- `/trade/query` 后端已经有“summary 补点 + 上下游递归扩点 + 群组聚边”的主链路，不再是单纯种子卡号直接聚边。
  - 对应代码：
    - `src/nanobot_channel_webui/case_graph/mysql_client.py::query_graph`
    - `::_resolve_query_trade_cards`
    - `::_query_graph_expanded_cards`
    - `::_construct_query_trade_result`
- `drilldown / drillup / drill / target-detail` 都已经有独立接口。
  - 对应代码：
    - `src/nanobot_channel_webui/channel.py`
    - `src/nanobot_channel_webui/case_graph/service.py`
    - `frontend/src/case-graph/api.ts`
- workbench 也不再是“只有简化图 tab”的最早形态。
  - 当前已经有：
    - `savedGraphs -> graphTabs`
    - `graph detail -> tab state`
    - `originData + groupMap + sourceSelectId + queryBaselineTradeCards`
  - 对应代码：
    - `frontend/src/case-graph/workbench.tsx`
    - `frontend/src/case-graph/store.ts`

## 仍成立的差异

### P0: `phone` 链路仍未实现

当前位置：

- `src/nanobot_channel_webui/case_graph/mysql_client.py::_build_query_result`
- `frontend/src/case-graph/adapters.ts`
- `frontend/src/case-graph/graph-canvas.tsx`

现状：

- 主查询结果里虽然保留了 `phone` 字段，但后端固定返回 `phone: []`
- 没有原版 `callService.queryCallData(...)` 那条补话单关系的链路
- 前端也没有把 `phone` 关系画到画布上

影响：

- 当前 `/trade/query` 的资金关系已经能对齐，但话单关系仍然缺失

### P0: `excludedTrades` 没有原版那种“按当前图节点集自动修正”的步骤

当前位置：

- `src/nanobot_channel_webui/case_graph/mysql_client.py::query_graph`
- `src/nanobot_channel_webui/case_graph/mysql_client.py::_build_query_result`

现状：

- 当前实现会把 `excludedTrades` 直接带进 SQL 过滤
- 但不会像原版那样先做一次“这个排除流水是否仍然属于当前图节点集”的修正
- 返回时也只是把请求里的 `excludedTrades` 原样回填

影响：

- 历史排除项不会自动清理
- 这和原版 `queryTargetCardExcludedTrade(...)` 的行为不一致

### P1: 主查询后端 contract 基本对齐了，但前端没有把原版全部查询输入开放出来

当前位置：

- `frontend/src/case-graph/types.ts::QueryCaseGraphPayload`
- `frontend/src/case-graph/workbench.tsx::handleAnalyze`
- `frontend/src/case-graph/workbench.tsx::handleDrill`

现状：

- 类型层已经声明了这些字段：
  - `groupMap`
  - `excludedAccountName`
  - `summarySelectedAccountId`
  - `summarySelectedAccountName`
  - `sourceSelectId`
  - `isSelectedTradeCardChanged`
  - `minAmount / maxAmount / startTime / endTime`
- 但当前 UI 主流程真正发出去的主要还是：
  - `tradeCards`
  - `groupMap`
  - `excludedTrades`
  - `excludedAccountId`
  - `sourceSelectId`
  - `isSelectedTradeCardChanged`
  - `minAmount / maxAmount`

当前缺口：

- 没有时间范围 UI，也没有把 `startTime / endTime` 挂进当前 tab 运行态
- 没有汇总分析 UI，因此 `summarySelectedAccountId / summarySelectedAccountName` 没有真实入口
- 没有“取消上图主体”累计态，因此 `excludedAccountName` 也没有真实入口

### P1: 图运行态只对齐了一部分，缺少原版那些围绕 `sourceSelectId / summary / excluded-name` 的前端闭环

当前位置：

- `frontend/src/case-graph/workbench.tsx::GraphTabState`
- `frontend/src/case-graph/workbench.tsx::handleAnalyze`
- `frontend/src/case-graph/workbench.tsx::handleDrill`

现状：

- 当前 tab 已维护：
  - `tradeCards`
  - `queryBaselineTradeCards`
  - `groupMap`
  - `sourceSelectId`
  - `excludedTrades`
  - `excludedAccountId`
  - `drillNums / drillType / minAmount / maxAmount`
- 但没有把这些原版运行态挂进 tab：
  - `summarySelectedAccountId`
  - `summarySelectedAccountName`
  - `excludedAccountName`

影响：

- 后端虽已支持部分字段，前端仍缺原版那套“累计增点 / 累计排除 / 依据 sourceSelectId 判断原始主体”的状态闭环

### P1: `sourceSelectId` 的回读机制与原版不同

当前位置：

- `src/nanobot_channel_webui/case_graph/service.py::query_graph`
- `src/nanobot_channel_webui/case_graph/storage.py`

现状：

- 当前当 `isSelectedTradeCardChanged == false` 时
  - 不是像原版那样走 Redis
  - 而是直接从当前图快照里的 `sourceSelectId` 回读
- 当前图每次 query 后都会把新的 `graphData / groupMap / sourceSelectId` 回写本地持久化

影响：

- 语义上已经接近原版“改不改主体决定是否重算 sourceSelectId”
- 但底层实现不是原版 Redis 维度，而是本地图快照维度

### P1: “新建图 -> 分析上图” 的顺序仍未完全对齐原版

当前位置：

- `frontend/src/case-graph/workbench.tsx::handleCreateGraph`
- `frontend/src/case-graph/workbench.tsx::handleAnalyze`

现状：

- 当前新建图时仍然是：
  - `createCaseGraph({ caseId, graphName, tradeCards: [] })`
- 也就是新建动作本身不会把当前主体选择写进图记录
- 当前也没有原版那种：
  - 没有 tab 时点击“分析上图”
  - 先弹新建图
  - 新建成功后自动对新 tab 执行一次查询

影响：

- 当前 tab / graph detail / query 这条链路已经存在
- 但“新建即带入当前上图基线”的行为仍和原版不完全一致

### P1: 右键菜单只实现了钻取，原版多项操作仍是占位

当前位置：

- `frontend/src/case-graph/graph-canvas.tsx`

现状：

- 当前右键菜单可用的是：
  - `双向钻取`
  - `上钻`
  - `下钻`
- 但这些原版动作仍是禁用占位：
  - `取消上图`
  - `取消群组`
  - `明细分析`
  - `汇总分析`
  - `资金关系图`

影响：

- 当前画布虽然已经不是“只能看静态图”，但仍没有原版完整的节点操作面

### P1: 群组能力是“可展示、可参与查询”，但不是原版完整的群组交互模型

当前位置：

- `src/nanobot_channel_webui/case_graph/mysql_client.py::_group_card_records`
- `src/nanobot_channel_webui/case_graph/mysql_client.py::_construct_query_trade_result`
- `frontend/src/case-graph/workbench.tsx::buildSelectionGroupMap`
- `frontend/src/case-graph/graph-canvas.tsx`

现状：

- 后端已经能：
  - 自动同名分组
  - 把群组节点写进 `nodes`
  - 把群组边写进 `money`
- 前端也已经能：
  - 保存 `groupMap`
  - 识别群组节点
  - 按群组节点取边详情所需的 `payerCards / payeeCards`

但仍缺：

- 原版那种用户侧取消群组、重组群组的完整交互
- 原版围绕 `baseGroupsMap / userGroupsMap` 的持续运行态

### P1: 钻取接口都有了，但 contract 仍和原版不完全一样

当前位置：

- `src/nanobot_channel_webui/case_graph/service.py::_drill_graph`
- `frontend/src/case-graph/api.ts`

现状：

- 当前 `drilldown / drillup / drill` 都存在
- 但返回值仍是：
  - `{ tradeCards: [...] }`
- 不是原版那种直接返回 `TradeAccountDTO[]`

影响：

- 当前前端的数据流是“先合并 tradeCards，再二次 query”
- 这和原版 drill 接口的原始 contract 仍有差异

### P1: `target-detail` 已基本对齐，但主图节点类型仍比原版薄一些

当前位置：

- `src/nanobot_channel_webui/case_graph/mysql_client.py::_query_node_from_card`
- `frontend/src/case-graph/types.ts::CaseGraphNode`

现状：

- `target-detail` 现在已经可以直接吃 `payerCards / payeeCards`，返回值也是明细数组，这块旧 gap 已不成立
- 但节点类型本身仍比原版薄：
  - 前端 `CaseGraphNode` 没有显式建模 `suspectIdNumber / bank / suspectId`
  - 后端主查询节点里 `bank` 当前固定是 `None`
  - 主查询节点也没有原版那种稳定的 `suspectIdNumber`

影响：

- 主图主体已经能画出来，但节点对象还不是原版那种完整事实对象

### P1: `graphContent` 虽已持久化，但当前加载图时不会优先恢复已保存坐标

当前位置：

- `src/nanobot_channel_webui/case_graph/types.py::CaseGraphState`
- `src/nanobot_channel_webui/case_graph/storage.py`
- `frontend/src/case-graph/graph-canvas.tsx`
- `frontend/src/case-graph/graph-layout.ts`

现状：

- 后端已经持久化 `graphContent`
- 前端布局器也有解析 `graphContent` 坐标的能力
- 但 `GraphCanvas` 当前调用布局时固定传了：
  - `preferPersistedPositions: false`

影响：

- 已保存图重新打开后，仍以当前布局算法重排为主
- 不是原版那种更偏向恢复既有画布位置的行为

## 当前判断

从代码角度看，`nanobot-gap-notes` 之前最核心的错误，是把“早期简化版 case-graph”当成了当前现状。

现在更准确的结论应该是：

1. `/trade/query` 后端结果形状和主查询主链已经基本对齐原版
2. 图快照字段也已经比早期版本完整很多
3. 还没对齐的重点，主要已经从“后端主查询 contract 缺失”转成：
   - `phone` 未实现
   - `excludedTrades` 修正链路未实现
   - 前端缺少原版汇总分析 / 取消上图 / 取消群组 / 资金关系图等交互闭环
   - 布局恢复与节点事实字段仍有薄化
