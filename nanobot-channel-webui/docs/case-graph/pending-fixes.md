# Case Graph Pending Fixes

目标：记录当前 `nanobot-channel-webui` 上图产品仍待补齐的问题、风险和开放决策。

本文不再按原版实现建立差异清单。只有当前产品仍需要处理的事项才应该保留在这里。

## P0

### `phone` 话单关系链路仍未实现

现状：

- 查询结果类型仍保留 `phone`
- 后端当前固定返回 `phone: []`
- 前端画布还没有话单关系类型、样式和交互

定位：

- [mysql_client.py](../../src/nanobot_channel_webui/case_graph/mysql_client.py:2403)
- [types.ts](../../frontend/src/case-graph/types.ts:104)

## P1

### 主查询兼容路径和当前产品入口需要继续分层

现状：

- 当前前端“分析上图”主入口是 `/api/case-graph/relation/query`，后端对应关系图一跳查询和步骤快照。
- 关系图一跳查询、图内关系查询、全局线索候选和交易事实回填已经统一基于 `trade_info` 事实视图读取交易流水，默认排除无效流水，并用账户/嫌疑人信息补齐交易主体姓名。
- 旧 `query_graph` / `/api/case-graph/query` 兼容路径仍保留部分旧主查询字段和行为，但不再是当前产品主入口。

后续需要：

- 后续若继续清理主查询，应优先围绕关系图主入口补测试和修语义。
- 不要把旧主查询兼容字段重新引回当前关系图主链路。
- 如果未来完全废弃旧路径，再统一移除对应 contract 和测试夹具。

定位：

- [workbench.tsx](../../frontend/src/case-graph/workbench.tsx)
- [relation_service.py](../../src/nanobot_channel_webui/case_graph/relation_service.py)
- [mysql_client.py](../../src/nanobot_channel_webui/case_graph/mysql_client.py)

### 对话直接操作图谱协议仍需扩展

现状：

- 图谱操作完成后，右侧对话已经可以读取当前图上下文和最新步骤，并给出研判解释
- 图谱操作助手可把明确的操作意图输出为隐藏动作注释，前端解析后在对话消息下展示“图谱操作”确认卡片
- 图谱研判助手只负责图事实解释、节点/资金线分析和下一步建议；图谱对话里明确的改图请求会自动选择图谱操作助手
- 对已存在会话里旧技能上下文只输出“请确认是否执行”的中文金额筛选文案，前端有窄范围兜底解析；普通研判建议不会被转成动作
- 当前确认卡片已能复用现有链路执行：
  - 金额和时间筛选
  - 清空筛选条件
  - 上钻、下钻、双向钻取
  - 取消主体上图
  - 恢复主体或恢复全部主体
  - 补全当前图上关系
- skill 仍然不能直接修改图谱文件或调用图谱后端接口，必须由前端确认后执行

后续需要：

- 扩展交易核查、批量动作和更复杂的组合动作
- 增加多轮歧义澄清，例如同名主体、多账号主体和缺少焦点时的确认
- 继续保持 `graph.json` 与 `steps/*.json` 为事实来源，不允许 skill 直接改写图谱状态

定位：

- [workbench.tsx](../../frontend/src/case-graph/workbench.tsx)
- [chat-action-protocol.ts](../../frontend/src/case-graph/chat-action-protocol.ts)
- `~/.nanobot/workspace/skills/case-graph-analyst/scripts/case_graph_analyst.py`
- `~/.nanobot/workspace/skills/case-graph-operator/SKILL.md`

### 部分图操作仍没有产品入口

现状：

- 当前可用的是：
  - 双向钻取
  - 上钻
  - 下钻
  - 取消上图
  - 多选取消上图
  - 交易核查
  - 资金流向图视图
- 下列能力还没有可用入口或完整工作流：
  - 取消群组
  - 资金关系图工作流

定位：

- [graph-canvas.tsx](../../frontend/src/case-graph/graph-canvas.tsx)

### 交易核查的证据链输出仍可增强

现状：

- 节点右键已经有交易核查入口
- 前端会按关联边加载交易流水，提交时把运行时 `tradeFacts` 与 `edgeTradeIds` 交给后端核算；磁盘步骤快照只保留事实引用，完整事实落在 `facts/trades.jsonl`
- 交易核查和交易线详情都支持条件筛选、表头排序、勾选排除、当前结果全选，并通过当前图上的交易流水编号重算资金线；交易核查以一个表格承载当前节点全部关联线的交易，并用“方向、关联主体”列交代来源；交易线详情暂不做前端假分页
- 后端“交易核查”步骤会基于已沉淀事实重算受影响边，不再为交易核查重新查库；交易事实已经从 `graph.json` 和步骤快照拆到 `facts/trades.jsonl`，并保留摘要/备注、流水号、借贷标志、渠道、机构、IP、MAC、设备、商户和订单等后续分析字段
- 办案人员可在已有案件图和图上主体基础上人工补充不入库的办案事实；画布空白处可独立创建只存在于当前图谱的交易主体，并记录银行卡号或账号、发现原因、来源材料和情况说明
- 补充资金往来和标注现实关系需要从当前图上主体中选择两端对象；选择控件支持输入筛选，适配图上主体较多的场景
- 补充资金往来会进入当前图的事实文件、`manualEdges` 和步骤快照；现实关系进入 `realityRelations`，不参与资金统计
- 当前还没有独立的证据导出文件和交易引用编号视图；完全排除后消失的资金线已经可以通过全局排除项里的交易流水恢复来重建
- 人工补充线索还没有编辑、删除、附件证据或关系类型治理

定位：

- [node-detail-analysis-drawer.tsx](../../frontend/src/case-graph/node-detail-analysis-drawer.tsx)
- [relation_service.py](../../src/nanobot_channel_webui/case_graph/relation_service.py)

### 历史步骤目前只支持只读预览

现状：

- 当前关系图状态已经把节点坐标保存到 `graph.layout.nodePositions`
- 刷新页面会优先读取 `case_graphs/{caseId}/{graphId}/graph.json` 的当前投影
- 当前前端已经可以基于 `steps/*.json` 做只读历史预览回放
- 还不能把任意历史步骤恢复/重置成当前图

定位：

- [graph_repository.py](../../src/nanobot_channel_webui/case_graph/graph_repository.py)
- [workbench.tsx](../../frontend/src/case-graph/workbench.tsx)

### 非关系图元和完整 reset 能力未实现

现状：

- 当前保存的是关系图投影、布局位置和步骤快照
- 没有独立的非关系图元编辑/保存/恢复模型
- 没有完整 reset 到任意历史版本的产品入口

影响：

- 当前足够支持关系研判主路径
- 如果未来要在画布上保留标注、自由图元或多版本回滚，需要继续补齐画布层能力

### 新建图时没有带入当前主体基线

现状：

- 当前新建图仍然固定创建空图
- 新建图不会自动携带当前已选主体作为初始分析基线

定位：

- [workbench.tsx](../../frontend/src/case-graph/workbench.tsx:735)

## P2

### 旧主查询兼容字段需要保持边界清晰

现状：

- `excludedTrades` 是当前图的交易排除状态。关系图筛选、交易核查和交易线详情基于事实文件补回的运行时 `tradeFacts` 与资金线 `tradeIds` 重算资金线；旧主查询路径也会沿用该字段作为兼容输入。
- `summarySelectedAccountId / summarySelectedAccountName / excludedAccountName` 仍存在于类型和后端旧主查询链路中，但不属于当前线索扩展、节点取消上图或关系图事实过滤的状态来源。
- 当前产品已经有节点级取消上图和恢复流程，状态落在 `excludedNodes`；线索扩展也已经采用数据库候选发现和选择补充上图，不再补旧 `summarySelected*` 闭环。

维护要求：

- 不把这些兼容字段当作当前图谱主链路的新状态来源。
- 不在后续实现里混用 `excludedAccountName` 和当前 `excludedNodes`。
- 只有在整体清理旧主查询 contract 时，再统一移除或迁移这些字段。

定位：

- [mysql_client.py](../../src/nanobot_channel_webui/case_graph/mysql_client.py)
- [types.ts](../../frontend/src/case-graph/types.ts)
- [relation_service.py](../../src/nanobot_channel_webui/case_graph/relation_service.py)

## 维护约束

- 新增问题前，先确认能否被当前代码、过程文件或产品入口直接坐实。
- 如果某项只是“原版有但当前产品不一定需要”，不要加入本文，先做产品决策。
- 功能完成、移除或产品决策变化时，同步更新 [feature-tracker.md](./feature-tracker.md)。
