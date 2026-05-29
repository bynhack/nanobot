# Jingzhen Workbench Design

## Goal

Add an economic-crime investigation workbench to `nanobot-channel-webui` without changing any `nanobot` core code.

The workbench must fit the plugin's existing WebUI shell, but its interaction model should follow the proven behavior in `Ga-web` rather than a generic dashboard layout.

The target product shape is:

- a `案件池 + 当前案件` entry model
- a `对话模式 / 工作台模式` dual-mode shell
- a workbench whose main surface is an interactive transaction graph
- graph interactions centered on `节点右键钻取` and `边点击查看交易明细`

## Hard Constraints

This design must respect the following constraints:

1. Only files inside `nanobot-channel-webui` may be changed.
2. `nanobot/` core code must remain untouched.
3. The plugin must remain installable and runnable through the current `nanobot gateway` path.
4. The workbench should reuse the plugin's current shell, auth, session, and detail-preview architecture where reasonable.
5. Real business querying should align with the existing local MySQL connector skill and the established case-scoped data model.

## Product Definition

In this plugin, the new workbench means:

> A case-centered investigation surface where users can switch between conversational analysis and graph-driven transaction analysis while keeping one shared case context.

It is not:

- a marketing-style analytics page
- a standalone BI dashboard
- a file explorer
- a generic knowledge graph toy
- a separate application disconnected from chat sessions

## Business Inputs We Must Respect

From user clarification, the workbench must follow these product decisions:

1. `双模切换型`
   - chat mode and workbench mode are peer views
   - both share the same case context

2. `案件池 + 当前案件`
   - users enter from a case list / case pool
   - then analyze inside one current case

3. `组合视图，但主视图是交易流向图`
   - the primary graph is transaction flow
   - relation and timeline views are secondary expansions

4. `按主体钻取`
   - drill behavior is centered on entities, not BI metrics

5. `双重方式连接对话`
   - selected graph context should automatically feed chat context
   - explicit shortcut actions should also remain available

6. `交易列表双角色`
   - it acts both as graph evidence detail and as a case ledger / evidence table

7. `工作台模式交互优先级`
   - drill actions appear on node right click
   - clicking an edge first shows the detailed transactions between the two sides of that edge

## External Reference Systems

This design is grounded in two existing systems already available locally.

### 1. Local MySQL Connector Skill

The skill at:

- `~/.nanobot/workspace/skills/mysql-connector/`

already provides case-scoped querying against the economic-crime schema:

- `ga_case`
- `ga_trade_{caseId}`
- `ga_account_{caseId}`
- `ga_suspect_{caseId}`
- `ga_call_{caseId}`

It also already exposes investigation-oriented operations such as:

- case summary
- suspect analysis
- fast in / fast out detection
- self-loop detection
- large-amount detection
- common-relation analysis
- transaction network analysis

This means the plugin does not need to invent a brand-new analytical backend for first release.

### 2. `Ga-web` Frontend Interaction Model

The real front-end project at:

- `/Users/brian/Documents/Project/公安系统/Ga-web`

proves the intended graph interaction model.

Key evidence:

- `src/views/analysis/flow/Node.vue`
  - node uses `el-dropdown` with `trigger="contextmenu"`
  - right-click menu includes `上钻`, `下钻`, `上下钻设置`, `全部流向`, `明细分析`, `汇总分析`

- `src/views/analysis/flow/customizeNode.vue`
  - registers edge click interaction
  - edge click assembles `payerCards`, `payeeCards`, `excludedTrades`, amount, count
  - calls detailed edge analysis

- `src/views/analysis/upper/index.vue`
  - uses `POST /api/data/trade/target/detail`
  - shows edge-focused drawer with payer, payee, amount, count, start/end time, and per-trade rows

This is the interaction language we should preserve.

## Chosen Product Shape

Use a plugin-owned `经侦工作台` inside the existing WebUI app with two primary views:

1. `对话模式`
2. `工作台模式`

The workbench view should have three stable regions:

1. left case rail
2. center graph canvas
3. right evidence / detail rail

Unlike a generic assistant app, the center graph canvas becomes the operational surface, not a decorative side panel.

## Information Architecture

### Left Rail

The left rail should remain stable across workbench interactions.

It should contain:

- current case identity
- case pool switcher
- global filters
- saved graph list
- compact case metrics

This rail is not where drill actions live.

### Center Canvas

The center canvas is the primary workbench surface.

It should contain:

- interactive transaction flow graph
- graph toolbar for global actions only
- optional graph-adjacent summary hints

The center graph surface itself should be preserved as the key professional interaction zone. We may simplify or redesign the surrounding shell, but we should not flatten the graph area into a generic dashboard card or replace its interaction grammar with passive chart behavior.

Allowed global actions:

- undo
- redo
- save graph
- export image
- print
- zoom / pan mode
- open full transaction list

Disallowed global actions:

- putting `上钻/下钻` in the page toolbar as the main interaction

Those actions belong to nodes.

### Right Rail

The right rail is the context-sensitive evidence panel.

It should switch based on current selection:

- node selected -> `主体详情`
- edge selected -> `边汇总 + 边明细`
- explicit switch -> `案件总交易列表`
- optional future -> `操作记录`

The right rail is not a generic preview pane. It is the investigation evidence pane.

## Core Interaction Model

### 1. Node Interaction

Default node behaviors:

- single click: select and focus the node
- right click: open the node context menu

The node context menu should include at least:

- `定位到此处`
- `取消上图`
- `上钻`
- `下钻`
- `上下钻设置`
- `全部流向`
- `主体明细分析`
- `主体汇总分析`
- `资金关系图`

Optional later actions:

- group / ungroup
- set as center node
- custom tag / marker

The main rule is:

> Drill is a node action, not a toolbar action.

### 2. Edge Interaction

Default edge behavior:

- single click: highlight the edge and show trade details between the two sides

On edge click, the UI should:

1. highlight the selected edge
2. resolve source and target node identities
3. expand group nodes into concrete account sets if needed
4. assemble a query with:
   - `caseId`
   - `payerCards`
   - `payeeCards`
   - `excludedTrades`
   - amount and count summary
   - active filter window
5. render edge summary and per-trade detail in the right rail

The main rule is:

> Edge click should open the two-sided transaction evidence first.

### 3. Chat Linkage

The graph must integrate with chat in two ways:

1. implicit context sync
   - when a node or edge is selected, the current chat context gains that selection

2. explicit quick actions
   - analyze this subject's upstream/downstream anomalies
   - summarize relationship to current case core subjects
   - generate an investigation note into chat
   - continue discussing this selected edge / entity in chat

This preserves the user's requested `双重方式`.

## View Types

### Primary View: Transaction Flow Graph

This is the default workbench graph.

It should not be implemented as a pure textbook Sankey chart.

Reason:

- the graph must support right-click node menus
- edge-level evidence drill
- graph history
- group operations
- selection and manipulation behavior

So the target is:

> a graph-analysis canvas with flow semantics, not a passive chart

### Secondary Expansions

The workbench may later expose:

- relation graph
- time-sequence transaction view
- common-relation analysis
- IP / MAC relation view

But these should remain secondary to the primary transaction-flow graph in phase 1.

## Shared State Model

The two modes should share a single case-scoped state model.

Recommended shape:

```ts
type WorkbenchState = {
  caseId: number | null
  graphId: string | null
  mode: 'chat' | 'workbench'
  graphType: 'flow' | 'relation'
  selectedNodeId: string | null
  selectedEdgeId: string | null
  selectedNodePayload: unknown | null
  selectedEdgePayload: unknown | null
  filters: {
    minAmount: number | null
    maxAmount: number | null
    startTime: string | null
    endTime: string | null
  }
  excludedTrades: string[]
  groupMap: Record<string, unknown>
  drillConfig: {
    drillNums: number
    drillType: number
    minAmount: number | null
    maxAmount: number | null
  }
}
```

This state should live in plugin frontend state, not inside ad hoc component-local islands.

## Data Contract Alignment

We should align with the `skyable-cloud` contract vocabulary because it already matches the business model.

Key request shapes to preserve:

### Flow Graph Query

Compatible with `QueryTradeDTO` ideas:

- `caseId`
- `graphId`
- `tradeCards`
- `groupMap`
- `excludedTrades`
- `excludedAccountId`
- `summarySelectedAccountId`
- `minAmount`
- `maxAmount`
- `startTime`
- `endTime`

### Drill Query

Compatible with `QueryTradeDrillDTO` ideas:

- `caseId`
- `tradeCard`
- `limit`
- `drillType`
- `minAmount`
- `maxAmount`
- `startTime`
- `endTime`
- `excludedCards`
- `excludedTrades`

### Edge Detail Query

Compatible with `target/detail` ideas:

- `caseId`
- `payerCards`
- `payeeCards`
- `excludedTrades`
- `minAmount`
- `maxAmount`
- `startTime`
- `endTime`

## Phase 1 Scope

Phase 1 should deliver only the smallest coherent workbench.

In scope:

1. case pool entry
2. chat/workbench dual-mode switch
3. transaction flow graph as primary workbench view
4. node right-click menu with drill actions
5. edge click -> right-rail edge detail
6. right-rail node detail view
7. global graph toolbar
8. shared chat context injection from graph selection
9. transaction list view linked to current selection

Out of scope:

- manual line drawing for custom hierarchy
- full group merge/split authoring UX
- advanced multi-layout switching
- complete operation replay timeline
- collaborative multi-client graph updates
- audit-grade print/export polish
- IP / MAC graph mode
- call-record relationship mode

## UI Guidance

The workbench should visually remain a quiet operations tool:

- dense but readable
- restrained color
- graph is dominant, not surrounded by decorative cards
- right rail behaves like evidence inspection, not a marketing sidebar
- toolbars use icon-first actions
- hover and focus reveal secondary controls

The graph canvas should feel operational:

- visible pan / zoom states
- clear selection states
- obvious context menus
- immediate edge highlight feedback

## Implementation Strategy

### Frontend

Primary write scope:

- `frontend/src/app.tsx`
- `frontend/src/components/chat/*`
- new workbench-specific modules under `frontend/src/components/workbench/`

Recommended additions:

- `frontend/src/components/workbench/WorkbenchShell.tsx`
- `frontend/src/components/workbench/WorkbenchCanvas.tsx`
- `frontend/src/components/workbench/WorkbenchDetailPane.tsx`
- `frontend/src/components/workbench/WorkbenchCaseRail.tsx`
- `frontend/src/components/workbench/graph/*`

Important note:

Do not try to mimic `Ga-web` one-to-one at the code level. Reuse only the validated interaction semantics.

### Backend

Primary write scope:

- `src/nanobot_channel_webui/channel.py`
- plugin-local API helpers
- any new plugin routes that feed workbench state and graph detail

Backend responsibilities for phase 1:

- expose case list and current case
- expose flow graph query endpoint
- expose drill endpoint
- expose edge detail endpoint
- expose node detail endpoint
- bridge graph selection context into chat-facing state if needed

## Risks

### 1. Wrong Technical Primitive

If we implement the main graph as a simple chart library first, we will likely block:

- node context menus
- edge evidence interactions
- history
- selection tooling

This would create rewrite pressure immediately.

### 2. Over-copying `Ga-web`

`Ga-web` is a full business frontend with accumulated complexity.

If we copy too much of its behavior in phase 1, we will pull in:

- group authoring complexity
- too many dialogs
- brittle graph state

We should take the interaction grammar, not the entire surface area.

### 3. Breaking the Chat-First Shell

If the workbench is added as a parallel app instead of a mode inside the existing shell, shared context will become awkward and the plugin will feel split-brain.

## Success Criteria

Phase 1 is successful when:

1. A user can choose a case and enter workbench mode.
2. The main graph shows transaction flow for the current case and selection set.
3. Right-clicking a node exposes drill actions.
4. Clicking an edge shows transactions between its two sides.
5. The right rail clearly distinguishes node detail from edge detail.
6. The user can carry graph context into the chat workflow without losing the current case.
7. The feature ships without any `nanobot` core changes.
