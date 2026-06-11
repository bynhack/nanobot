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
- 关系图一跳查询、图内关系查询、全局候选主体和交易事实回填已经统一基于 `trade_info` 事实视图读取交易流水，默认排除无效流水，并用账户/嫌疑人信息补齐交易主体姓名。
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
  - 按当前图谱交易事实排除交易流水
  - 按当前图谱交易事实恢复已排除交易流水
  - 查询候选主体并把符合条件的主体加入当前图
  - 创建当前图上的人工交易主体
  - 补充不入数据库、只用于当前图谱的资金往来
  - 标注两个图上主体之间的现实关系
  - 补全当前图上关系
- 交易流水类对话动作不是打开交易核查或交易线详情面板，而是把“排除/保留/恢复哪段流水”的自然语言意图转成可确认执行的业务动作；前端按主体、交易对手、方向、金额、时间和关键词在当前图谱事实中定位流水
- 候选主体类对话动作不是打开候选主体管理面板，而是把“把哪些候选主体加入图”的自然语言意图转成可确认执行的业务动作；前端先查询数据库候选，再按金额、交易次数、时间、关键词和方向筛选后应用到图
- 人工补充类对话动作不是打开创建主体、补充资金往来或现实关系面板，而是把自然语言里的新主体、交易两端、金额、时间、交易方式和现实关系转成可确认执行的业务动作；前端确认后复用人工 UI 对应的前端函数和后端接口
- skill 仍然不能直接修改图谱文件或调用图谱后端接口，必须由前端确认后执行

后续需要：

- 扩展异常模式选择、批量动作和更复杂的组合动作
- 增加多轮歧义澄清，例如同名主体、多账号主体和缺少焦点时的确认
- 继续保持 `graph.json` 与 `steps/*.json` 为事实来源，不允许 skill 直接改写图谱状态

定位：

- [workbench.tsx](../../frontend/src/case-graph/workbench.tsx)
- [chat-action-protocol.ts](../../frontend/src/case-graph/chat-action-protocol.ts)
- `~/.casework/workspace/skills/case-graph-analyst/scripts/case_graph_analyst.py`
- `~/.casework/workspace/skills/case-graph-operator/SKILL.md`

### 研判组体验仍可继续增强

现状：

- 多选主体后已经可以创建研判组，用来标记已基本确认的成员、账号或控制关系。
- 研判组使用 G6 官方 combo 承载组边界，支持收起、展开、整体拆分、从组内移出单个主体和批量移出多个成员。
- 节点操作条在画布已有分组时会提供“添加到组”，可选择目标研判组并把当前选中主体加入其中。
- 研判组操作会保存到当前图状态和步骤快照，新建组默认收起；收起位置取成员包围盒中心，展开和拆组优先恢复组内原节点位置。
- 研判组的分组、收起、展开、拆分和移出成员属于画布整理操作，不自动触发右侧副驾联动。
- 收起态组卡片已经展示组名、成员数、流入和流出金额；点击组可打开组详情卡，查看组内主体、对外资金线、关键对手方和流入/流出统计，并可编辑组名、组类型和研判说明。

后续需要：

- 扩展对话触发研判组操作。

定位：

- [graph-canvas.tsx](../../frontend/src/case-graph/graph-canvas.tsx)
- [relation_service.py](../../src/nanobot_channel_webui/case_graph/relation_service.py)

### 交易线明细和交易流水动作的证据链输出仍可增强

现状：

- 独立节点“交易核查”入口已移除，避免它和点击交易线查看明细形成重复入口。
- 交易线详情支持条件筛选、表头排序、勾选排除、当前结果全选、保留中流水单笔排除和已排除流水恢复，并通过当前图上的交易流水编号重算资金线；交易线详情暂不做前端假分页。
- 交易流水类对话动作会按主体、交易对手、方向、金额、时间和关键词定位当前图谱事实中的流水，再生成可确认的排除、保留或恢复动作。
- 后端“交易核查”步骤能力仍保留，用于基于已沉淀事实重算受影响边；交易事实已经从 `graph.json` 和步骤快照拆到 `facts/trades.jsonl`，并保留摘要/备注、流水号、借贷标志、渠道、机构、IP、MAC、设备、商户和订单等后续分析字段
- 办案人员可在已有案件图和图上主体基础上人工补充不入库的办案事实；独立创建只存在于当前图谱的交易主体能力仍保留，可记录银行卡号或账号、发现原因、来源材料和情况说明，但画布空白右键入口已暂时断开
- 补充资金往来和标注现实关系需要从当前图上主体中选择两端对象；选择控件支持输入筛选，适配图上主体较多的场景
- 补充资金往来会进入当前图的事实文件、`manualEdges` 和步骤快照；现实关系进入 `realityRelations`，不参与资金统计
- 当前还没有独立的证据导出文件和交易引用编号视图；完全排除后消失的资金线已经可以通过全局排除项里的交易流水恢复来重建
- 人工补充线索还没有编辑、删除、附件证据或关系类型治理

定位：

- [node-detail-analysis-drawer.tsx](../../frontend/src/case-graph/node-detail-analysis-drawer.tsx)
- [relation_service.py](../../src/nanobot_channel_webui/case_graph/relation_service.py)

### 历史步骤目前只支持只读预览

现状：

- 当前关系图状态已经把节点坐标保存到 `graph.layout.nodePositions`，并通过 `positionMeta` 与 `groupLayout` 保存位置来源、手动锁定和分组布局状态
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
- `summarySelectedAccountId / summarySelectedAccountName / excludedAccountName` 仍存在于类型和后端旧主查询链路中，但不属于当前候选主体管理、节点取消上图或关系图事实过滤的状态来源。
- 当前产品已经有节点级取消上图和恢复流程，状态落在 `excludedNodes`；候选主体管理也已经采用数据库候选发现，支持加入图、取消上图和恢复上图，不再补旧 `summarySelected*` 闭环。

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
