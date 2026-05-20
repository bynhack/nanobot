import { ArrowDownToLine, ArrowUpToLine, LocateFixed } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Graph as G6Graph } from '@antv/g6';

import { buildCaseGraphViewModel, formatCompactAmount } from './graph-analysis';
import type { CaseGraphNodeRole } from './graph-analysis';
import { computeCaseGraphLayout } from './graph-layout';
import type { CaseGraphConversationFocus, CaseGraphData, CaseGraphTradeCard } from './types';

interface GraphCanvasProps {
  graphData: CaseGraphData | null;
  graphContent?: string | null;
  tradeCards: CaseGraphTradeCard[];
  focusAccountIds: string[];
  focusLabels: string[];
  loading: boolean;
  drilldownLoading: boolean;
  hasActiveTab: boolean;
  onDrillDown: (direction: 'in' | 'out' | 'both', tradeCard: CaseGraphTradeCard) => void;
  onOpenEdgeDetail: (edgeId: string) => void;
  onFocusChange?: (focus: CaseGraphConversationFocus | null) => void;
}

interface ContextMenuState {
  nodeId: string;
  x: number;
  y: number;
}

const GRAPH_WIDTH = 1028;
const GRAPH_HEIGHT = 620;
const NODE_WIDTH = 248;
const NODE_HEIGHT = 84;
const COLUMN_GAP = 126;
const ROW_GAP = 88;
const GRAPH_PADDING: [number, number, number, number] = [24, 24, 132, 24];
const MINIMAP_SIZE: [number, number] = [176, 108];
const GRAPH_EDGE_TYPE = 'quadratic';
const ROLE_CHIPS: Array<{ role: Exclude<CaseGraphNodeRole, 'peripheral'>; label: string; className: string }> = [
  { role: 'upstream', label: '来款', className: 'is-upstream' },
  { role: 'core', label: '核心', className: 'is-core' },
  { role: 'bridge', label: '桥接', className: 'is-bridge' },
  { role: 'downstream', label: '去向', className: 'is-downstream' },
  { role: 'transit', label: '中转', className: 'is-transit' },
];

export function GraphCanvas({
  graphData,
  graphContent,
  tradeCards,
  focusAccountIds,
  focusLabels,
  loading,
  drilldownLoading,
  hasActiveTab,
  onOpenEdgeDetail,
  onDrillDown,
  onFocusChange,
}: GraphCanvasProps) {
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [activeRoleFilter, setActiveRoleFilter] = useState<Exclude<CaseGraphNodeRole, 'peripheral'> | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [graphReadyNonce, setGraphReadyNonce] = useState(0);
  const [graphViewport, setGraphViewport] = useState({ width: GRAPH_WIDTH, height: GRAPH_HEIGHT });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<G6Graph | null>(null);
  const graphHostRef = useRef<HTMLDivElement | null>(null);
  const renderCycleRef = useRef(0);
  const graphRenderedRef = useRef(false);
  const onOpenEdgeDetailRef = useRef(onOpenEdgeDetail);
  const onFocusChangeRef = useRef(onFocusChange);
  const nodesLengthRef = useRef(0);
  const activeNodeIdRef = useRef<string | null>(null);
  const activeNeighborhoodRef = useRef<{
    relatedNodeIds: Set<string>;
    relatedEdgeIds: Set<string>;
  } | null>(null);

  const nodes = graphData?.nodes ?? [];
  const edges = graphData?.edges ?? [];
  const nodeLookup = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const parallelOffsets = useMemo(() => computeParallelEdgeOffsets(edges), [edges]);
  const graphView = useMemo(
    () =>
      buildCaseGraphViewModel(graphData, {
        focusAccountIds,
        focusLabels,
      }),
    [focusAccountIds, focusLabels, graphData],
  );

  const tradeCardByNodeId = useMemo(() => {
    const map = new Map<string, CaseGraphTradeCard>();
    for (const tradeCard of tradeCards) {
      const tradeCardValue = String(tradeCard.tradeCard || '').trim();
      const accountId = String(tradeCard.accountId || '').trim();
      if (tradeCardValue) map.set(tradeCardValue, tradeCard);
      if (accountId) map.set(accountId, tradeCard);
    }
    return map;
  }, [tradeCards]);

  const graphLayout = useMemo(() => {
    return computeCaseGraphLayout(
        graphData,
        {
          graphContent,
          graphWidth: graphViewport.width,
          graphHeight: graphViewport.height,
          nodeWidth: NODE_WIDTH,
          nodeHeight: NODE_HEIGHT,
          columnGap: COLUMN_GAP,
        rowGap: ROW_GAP,
        focusAccountIds,
        focusLabels,
        preferPersistedPositions: false,
        viewModel: graphView,
      },
    );
  }, [focusAccountIds, focusLabels, graphContent, graphData, graphView, graphViewport.height, graphViewport.width]);

  const activeNeighborhood = useMemo(() => {
    if (activeRoleFilter) {
      return buildRoleNeighborhood(activeRoleFilter, nodes, edges, graphView.nodeMetricsById);
    }
    if (!activeNodeId) {
      return null;
    }
    const relatedNodeIds = new Set<string>([activeNodeId]);
    const relatedEdgeIds = new Set<string>();
    for (const edge of edges) {
      if (edge.source === activeNodeId || edge.target === activeNodeId) {
        relatedNodeIds.add(edge.source);
        relatedNodeIds.add(edge.target);
        relatedEdgeIds.add(resolveEdgeId(edge));
      }
    }
    return { relatedNodeIds, relatedEdgeIds };
  }, [activeNodeId, activeRoleFilter, edges, graphView.nodeMetricsById, nodes]);

  const selectedNode = activeNodeId ? nodeLookup.get(activeNodeId) ?? null : null;
  const selectedTradeCard = selectedNode ? resolveTradeCard(selectedNode, tradeCardByNodeId) : null;
  const selectedNodeMetrics = activeNodeId ? graphView.nodeMetricsById.get(activeNodeId) ?? null : null;
  const activeRoleCount = activeRoleFilter ? graphView.roleCounts[activeRoleFilter] : 0;

  useEffect(() => {
    onOpenEdgeDetailRef.current = onOpenEdgeDetail;
  }, [onOpenEdgeDetail]);

  useEffect(() => {
    onFocusChangeRef.current = onFocusChange;
  }, [onFocusChange]);

  useEffect(() => {
    nodesLengthRef.current = nodes.length;
  }, [nodes.length]);

  useEffect(() => {
    activeNodeIdRef.current = activeNodeId;
    activeNeighborhoodRef.current = activeNeighborhood;
  }, [activeNeighborhood, activeNodeId]);

  useEffect(() => {
    if (activeRoleFilter && graphView.roleCounts[activeRoleFilter] === 0) {
      setActiveRoleFilter(null);
    }
  }, [activeRoleFilter, graphView.roleCounts]);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  useEffect(() => {
    if (!graphHostRef.current || graphRef.current) return;
    let resizeObserver: ResizeObserver | null = null;
    let disposed = false;
    let createdGraph: G6Graph | null = null;

    void import('@antv/g6').then(({ Graph }) => {
      if (!graphHostRef.current || disposed) return;

      const initialWidth = graphHostRef.current.clientWidth || GRAPH_WIDTH;
      const initialHeight = graphHostRef.current.clientHeight || GRAPH_HEIGHT;
      setGraphViewport({ width: initialWidth, height: initialHeight });

      const graph = new Graph({
        container: graphHostRef.current,
        width: initialWidth,
        height: initialHeight,
        animation: false,
        padding: GRAPH_PADDING,
        data: { nodes: [], edges: [] },
        node: {
          type: 'html',
          style: {
            size: [NODE_WIDTH, NODE_HEIGHT],
            dx: -NODE_WIDTH / 2,
            dy: -NODE_HEIGHT / 2,
            innerHTML: (datum: any) => renderNodeMarkup(datum.data),
          },
        },
        edge: {
          type: GRAPH_EDGE_TYPE,
          style: {
            stroke: (datum: any) => getMoneyEdgeStyle(Number(datum?.data?.tradeAmount ?? 0), datum?.data).stroke,
            lineWidth: (datum: any) => getMoneyEdgeStyle(Number(datum?.data?.tradeAmount ?? 0), datum?.data).lineWidth,
            opacity: (datum: any) => getMoneyEdgeStyle(Number(datum?.data?.tradeAmount ?? 0), datum?.data).opacity,
            curveOffset: (datum: any) => Number(datum?.data?.curveOffset ?? 0),
            lineCap: 'round',
            lineJoin: 'round',
            endArrow: true,
            cursor: 'pointer',
            label: true,
            labelAutoRotate: false,
            labelPlacement: 'center',
            labelText: (datum: any) => buildEdgeLabel(datum.data),
            labelFontSize: 11,
            labelFontWeight: 700,
            labelFill: (datum: any) => (datum?.data?.isDimmed ? '#8d98ab' : '#42526b'),
            labelBackground: true,
            labelBackgroundFill: (datum: any) => (datum?.data?.isActive ? '#f7faff' : '#ffffff'),
            labelBackgroundStroke: (datum: any) => (datum?.data?.isActive ? '#7b8fd7' : '#d6deea'),
            labelBackgroundRadius: 8,
            labelPadding: [4, 8],
          },
        },
        behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
        plugins: [
          {
            type: 'minimap',
            key: 'case-graph-minimap',
            size: MINIMAP_SIZE,
            position: 'right-bottom',
            padding: 6,
            containerStyle: {
              border: '1px solid #d6deea',
              background: 'rgba(255, 255, 255, 0.96)',
              borderRadius: '8px',
              boxShadow: '0 10px 28px rgba(15, 23, 42, 0.12)',
            },
            maskStyle: {
              border: '1px solid #6b7ea6',
              background: 'rgba(107, 126, 166, 0.14)',
            },
          },
        ],
      });

      graph.on('node:click', (event: any) => {
        const nodeId = resolveEventId(event);
        setContextMenu(null);
        setActiveRoleFilter(null);
        if (nodeId) {
          setActiveNodeId(nodeId);
        }
      });

      graph.on('node:contextmenu', (event: any) => {
        event.preventDefault?.();
        event.originalEvent?.preventDefault?.();
        const nodeId = resolveEventId(event);
        if (!nodeId) return;
        const bounds = stageRef.current?.getBoundingClientRect();
        const { x, y } = resolvePointerPosition(event);
        setActiveRoleFilter(null);
        setActiveNodeId(nodeId);
        setContextMenu({
          nodeId,
          x: bounds ? x - bounds.left : x,
          y: bounds ? y - bounds.top : y,
        });
      });

      graph.on('edge:click', (event: any) => {
        const edgeId = resolveEventId(event);
        setContextMenu(null);
        if (edgeId) onOpenEdgeDetailRef.current(edgeId);
      });

      graph.on('canvas:click', () => {
        setContextMenu(null);
      });

      graphRef.current = graph;
      graphRenderedRef.current = false;
      createdGraph = graph;
      setGraphReadyNonce((value) => value + 1);

      resizeObserver = new ResizeObserver(() => {
        if (!graphRef.current || !graphHostRef.current) return;
        const nextWidth = graphHostRef.current.clientWidth || GRAPH_WIDTH;
        const nextHeight = graphHostRef.current.clientHeight || GRAPH_HEIGHT;
        setGraphViewport((current) => (
          current.width === nextWidth && current.height === nextHeight
            ? current
            : { width: nextWidth, height: nextHeight }
        ));
        graphRef.current.resize(nextWidth, nextHeight);
        if (nodesLengthRef.current && graphRenderedRef.current) {
          void graphRef.current.fitView({ when: 'always', direction: 'both' });
        }
      });
      resizeObserver.observe(graphHostRef.current);
    });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      graphRenderedRef.current = false;
      renderCycleRef.current += 1;
      createdGraph?.destroy();
      graphRef.current = null;
    };
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;

    const graphPayload = {
      nodes: nodes.map((node) => {
        const point = graphLayout.get(node.id) ?? { x: NODE_WIDTH / 2, y: NODE_HEIGHT / 2 };
        const seedTradeCard = resolveTradeCard(node, tradeCardByNodeId);
        const metrics = graphView.nodeMetricsById.get(node.id);
        return {
          id: node.id,
          style: {
            x: point.x,
            y: point.y,
          },
          data: buildNodeRenderData(
            node,
            metrics,
            Boolean(seedTradeCard),
            activeNodeIdRef.current,
            activeNeighborhoodRef.current,
          ),
        };
      }),
      edges: edges.map((edge) => {
        const edgeId = resolveEdgeId(edge);
        return {
          id: edgeId,
          source: edge.source,
          target: edge.target,
          type: GRAPH_EDGE_TYPE,
          data: buildEdgeRenderData(
            edge,
            graphView.edgeMetricsById.get(edgeId),
            activeNeighborhoodRef.current,
            parallelOffsets.get(edgeId) ?? 0,
          ),
        };
      }),
    };

    const currentRenderCycle = renderCycleRef.current + 1;
    renderCycleRef.current = currentRenderCycle;
    graphRenderedRef.current = false;
    graph.setData(graphPayload);
    void graph.render()
      .then(async () => {
        if (
          renderCycleRef.current !== currentRenderCycle ||
          graphRef.current !== graph
        ) {
          return;
        }
        graphRenderedRef.current = true;
        if (nodes.length) {
          await graph.fitView({ when: 'always', direction: 'both' });
        }
      })
      .catch(() => {
        if (renderCycleRef.current === currentRenderCycle) {
          graphRenderedRef.current = false;
        }
      });
  }, [edges, graphLayout, graphReadyNonce, graphView, nodes, parallelOffsets, tradeCardByNodeId]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !nodes.length || !graphRenderedRef.current) return;

    graph.updateNodeData(
      nodes.map((node) => ({
        id: node.id,
        data: buildNodeRenderData(
          node,
          graphView.nodeMetricsById.get(node.id),
          Boolean(resolveTradeCard(node, tradeCardByNodeId)),
          activeNodeId,
          activeNeighborhood,
        ),
      })),
    );
    graph.updateEdgeData(
      edges.map((edge) => {
        const edgeId = resolveEdgeId(edge);
        const metrics = graphView.edgeMetricsById.get(edgeId);
        return {
          id: edgeId,
          data: buildEdgeRenderData(edge, metrics, activeNeighborhood, parallelOffsets.get(edgeId) ?? 0),
        };
      }),
    );
    void graph.draw().catch(() => {});
  }, [activeNeighborhood, activeNodeId, edges, graphReadyNonce, graphView, nodes, parallelOffsets, tradeCardByNodeId]);

  useEffect(() => {
    if (activeNodeId && !nodeLookup.has(activeNodeId)) {
      setActiveNodeId(null);
      setContextMenu(null);
    }
  }, [activeNodeId, nodeLookup]);

  useEffect(() => {
    if (!onFocusChangeRef.current) {
      return;
    }
    if (selectedNode) {
      onFocusChangeRef.current({
        type: 'node',
        graphId: '',
        caseId: '',
        graphName: '',
        nodeId: String(selectedNode.id || '').trim(),
        label: selectedNode.label || selectedNode.name,
        accountId: selectedNode.accountId ?? null,
        accountName: selectedNode.accountName || selectedNode.label || selectedNode.name,
        tradeCard: selectedNode.tradeCard || undefined,
      });
      return;
    }
    onFocusChangeRef.current(null);
  }, [selectedNode]);

  return (
    <section className="case-graph-canvas" aria-label="主图画布">
      {nodes.length ? (
        <div className="case-graph-insight-strip case-graph-insight-strip--compact" aria-label="判读摘要">
            <div className="case-graph-role-chip-row">
            {ROLE_CHIPS.map(({ role, label, className }) => (
              <button
                key={role}
                type="button"
                className={`case-graph-role-chip ${className}${activeRoleFilter === role ? ' is-selected' : ''}`}
                aria-pressed={activeRoleFilter === role}
                disabled={graphView.roleCounts[role] === 0}
                onClick={() => {
                  setContextMenu(null);
                  setActiveNodeId(null);
                  setActiveRoleFilter((current) => (current === role ? null : role));
                }}
              >
                {label} {graphView.roleCounts[role]}
              </button>
            ))}
          </div>

          {selectedNodeMetrics ? (
            <div className="case-graph-active-brief">
              <strong>{selectedNodeMetrics.displayName}</strong>
              <span>{selectedNodeMetrics.roleLabel}</span>
              <span>收 {formatCompactAmount(selectedNodeMetrics.receivedAmount)} 元</span>
              <span>出 {formatCompactAmount(selectedNodeMetrics.sentAmount)} 元</span>
              <span>{selectedNodeMetrics.degree} 个关联对象</span>
            </div>
          ) : activeRoleFilter ? (
            <div className="case-graph-active-brief">
              <strong>{ROLE_CHIPS.find((item) => item.role === activeRoleFilter)?.label}</strong>
              <span>{activeRoleCount} 个节点</span>
              <span>已高亮该角色及其一跳资金线</span>
              <span>再点一次取消</span>
            </div>
          ) : (
            <p className="case-graph-insight-hint">点击节点聚焦主体，或点击上方角色标签高亮同类节点。</p>
          )}
        </div>
      ) : null}

      <div className="case-graph-canvas-stage case-graph-canvas-stage--full" ref={stageRef}>
        {nodes.length ? (
          <div className="case-graph-canvas-overlay-tools">
            <button
              className="case-graph-mini-button"
              type="button"
              onClick={() => {
                setActiveNodeId(null);
                setActiveRoleFilter(null);
                setContextMenu(null);
                void graphRef.current?.fitView({ when: 'always', direction: 'both' });
              }}
            >
              <LocateFixed size={14} />
              <span>重置视图</span>
            </button>
          </div>
        ) : null}

        <div className={`case-graph-g6-host${nodes.length ? '' : ' is-hidden'}`} ref={graphHostRef} />

        {!nodes.length ? (
          <div className="case-graph-empty">
            {loading ? '正在加载图数据...' : hasActiveTab ? '先在左侧选择主体，再点击分析上图。' : '先点击新增，创建图形页签。'}
          </div>
        ) : null}

        {contextMenu && selectedTradeCard ? (
          <div
            className="case-graph-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" className="case-graph-context-item is-disabled" disabled>
              <LocateFixed size={14} />
              <span>定位到此处</span>
            </button>
            <button type="button" className="case-graph-context-item is-disabled" disabled>
              <span>取消上图</span>
            </button>
            <button type="button" className="case-graph-context-item is-disabled" disabled>
              <span>取消群组</span>
            </button>
            <button
              type="button"
              className="case-graph-context-item"
              disabled={drilldownLoading}
              onClick={() => {
                onDrillDown('both', selectedTradeCard);
                setContextMenu(null);
              }}
            >
              <span>双向钻取</span>
            </button>
            <button
              type="button"
              className="case-graph-context-item"
              disabled={drilldownLoading}
              onClick={() => {
                onDrillDown('in', selectedTradeCard);
                setContextMenu(null);
              }}
            >
              <ArrowDownToLine size={14} />
              <span>上钻</span>
            </button>
            <button
              type="button"
              className="case-graph-context-item"
              disabled={drilldownLoading}
              onClick={() => {
                onDrillDown('out', selectedTradeCard);
                setContextMenu(null);
              }}
            >
              <ArrowUpToLine size={14} />
              <span>下钻</span>
            </button>
            <button type="button" className="case-graph-context-item is-disabled" disabled>
              <span>明细分析</span>
            </button>
            <button type="button" className="case-graph-context-item is-disabled" disabled>
              <span>汇总分析</span>
            </button>
            <button type="button" className="case-graph-context-item is-disabled" disabled>
              <span>资金关系图</span>
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function resolveTradeCard(
  node: CaseGraphData['nodes'][number],
  tradeCardByNodeId: Map<string, CaseGraphTradeCard>,
): CaseGraphTradeCard | null {
  return (
    tradeCardByNodeId.get(String(node.tradeCard || '').trim()) ||
    tradeCardByNodeId.get(String(node.accountId || '').trim()) ||
    tradeCardByNodeId.get(String(node.id || '').trim()) ||
    (node.tradeCard || node.accountId || node.id
      ? {
          accountId: node.accountId ?? null,
          tradeCard: node.tradeCard || undefined,
          accountName: node.accountName || node.label || node.name,
        }
      : null) ||
    null
  );
}

function buildNodeRenderData(
  node: CaseGraphData['nodes'][number],
  metrics: ReturnType<typeof buildCaseGraphViewModel>['nodeMetricsById'] extends Map<string, infer T> ? T : never,
  isSeed: boolean,
  activeNodeId: string | null,
  activeNeighborhood: {
    relatedNodeIds: Set<string>;
    relatedEdgeIds: Set<string>;
  } | null,
) {
  return {
    title: node.name || node.label || node.accountName || node.tradeCard || node.accountId || node.id,
    subtitle: node.tradeCard || node.accountId || node.id,
    role: metrics?.role ?? 'peripheral',
    roleLabel: metrics?.roleLabel ?? '外围',
    roleBadge: resolveRoleBadge(metrics?.role),
    receivedText: `收 ${formatCompactAmount(metrics?.receivedAmount ?? 0)} 元`,
    sentText: `出 ${formatCompactAmount(metrics?.sentAmount ?? 0)} 元`,
    isSeed,
    isFocus: Boolean(metrics?.isFocus),
    isActive: activeNodeId === node.id,
    isDimmed: Boolean(activeNeighborhood && !activeNeighborhood.relatedNodeIds.has(node.id)),
  };
}

function buildEdgeRenderData(
  edge: CaseGraphData['edges'][number],
  metrics: ReturnType<typeof buildCaseGraphViewModel>['edgeMetricsById'] extends Map<string, infer T> ? T : never,
  activeNeighborhood: {
    relatedNodeIds: Set<string>;
    relatedEdgeIds: Set<string>;
  } | null,
  curveOffset = 0,
) {
  const edgeId = resolveEdgeId(edge);
  return {
    tradeCount: edge.tradeCount,
    tradeAmount: edge.tradeAmount,
    strength: metrics?.strength ?? 'medium',
    isFocusEdge: metrics?.isFocusEdge ?? false,
    isActive: Boolean(activeNeighborhood?.relatedEdgeIds.has(edgeId)),
    isDimmed: Boolean(activeNeighborhood && !activeNeighborhood.relatedEdgeIds.has(edgeId)),
    showLabel: activeNeighborhood
      ? activeNeighborhood.relatedEdgeIds.has(edgeId)
      : (metrics?.strength ?? 'medium') !== 'weak',
    curveOffset,
  };
}

const PARALLEL_EDGE_OFFSET = 28;

function computeParallelEdgeOffsets(edges: CaseGraphData['edges']): Map<string, number> {
  const groups = new Map<string, CaseGraphData['edges']>();
  for (const edge of edges) {
    const source = String(edge.source ?? edge.from ?? '').trim();
    const target = String(edge.target ?? edge.to ?? '').trim();
    if (!source || !target) continue;
    const key = source < target ? `${source}::${target}` : `${target}::${source}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(edge);
    else groups.set(key, [edge]);
  }

  const offsets = new Map<string, number>();
  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue;
    if (bucket.length === 2) {
      const [left, right] = bucket;
      const leftSource = String(left.source ?? left.from ?? '').trim();
      const leftTarget = String(left.target ?? left.to ?? '').trim();
      const rightSource = String(right.source ?? right.from ?? '').trim();
      const rightTarget = String(right.target ?? right.to ?? '').trim();
      const isBidirectionalPair =
        leftSource === rightTarget &&
        leftTarget === rightSource &&
        leftSource !== leftTarget;

      if (isBidirectionalPair) {
        offsets.set(resolveEdgeId(left), PARALLEL_EDGE_OFFSET);
        offsets.set(resolveEdgeId(right), PARALLEL_EDGE_OFFSET);
        continue;
      }

      offsets.set(resolveEdgeId(left), -PARALLEL_EDGE_OFFSET / 2);
      offsets.set(resolveEdgeId(right), PARALLEL_EDGE_OFFSET / 2);
      continue;
    }
    // Rare: more than 2 parallel edges. Spread them symmetrically.
    const step = PARALLEL_EDGE_OFFSET;
    const start = -((bucket.length - 1) / 2) * step;
    bucket.forEach((edge, index) => {
      offsets.set(resolveEdgeId(edge), start + index * step);
    });
  }
  return offsets;
}

export function computeParallelEdgeOffsetsForTest(edges: CaseGraphData['edges']): Map<string, number> {
  return computeParallelEdgeOffsets(edges);
}

export function resolveEdgeTypeForTest(): string {
  return GRAPH_EDGE_TYPE;
}

function resolveEdgeId(edge: CaseGraphData['edges'][number]): string {
  return String(edge.id || `${edge.source}->${edge.target}`).trim();
}

function buildRoleNeighborhood(
  role: Exclude<CaseGraphNodeRole, 'peripheral'>,
  nodes: CaseGraphData['nodes'],
  edges: CaseGraphData['edges'],
  nodeMetricsById: ReturnType<typeof buildCaseGraphViewModel>['nodeMetricsById'],
): {
  relatedNodeIds: Set<string>;
  relatedEdgeIds: Set<string>;
} | null {
  const selectedNodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeMetricsById.get(node.id)?.role === role) {
      selectedNodeIds.add(node.id);
    }
  }

  if (!selectedNodeIds.size) {
    return null;
  }

  const relatedNodeIds = new Set<string>(selectedNodeIds);
  const relatedEdgeIds = new Set<string>();
  for (const edge of edges) {
    if (!selectedNodeIds.has(edge.source) && !selectedNodeIds.has(edge.target)) {
      continue;
    }
    relatedNodeIds.add(edge.source);
    relatedNodeIds.add(edge.target);
    relatedEdgeIds.add(resolveEdgeId(edge));
  }

  return { relatedNodeIds, relatedEdgeIds };
}

function renderNodeMarkup(data: {
  title: string;
  subtitle: string;
  isSeed: boolean;
  isFocus: boolean;
  isActive: boolean;
  isDimmed: boolean;
  role: string;
  roleLabel: string;
  roleBadge: string;
  receivedText: string;
  sentText: string;
}): string {
  return `
    <div class="case-graph-g6-node role-${escapeClassName(data.role)}${data.isSeed ? ' is-seed' : ''}${data.isFocus ? ' is-focus' : ''}${data.isActive ? ' is-active' : ''}${data.isDimmed ? ' is-dimmed' : ''}">
      <div class="case-graph-g6-node-badge">
        <span>${escapeHtml(data.roleBadge)}</span>
      </div>
      <div class="case-graph-g6-node-copy">
        <div class="case-graph-g6-node-head">
          <strong>${escapeHtml(data.title)}</strong>
          <span class="case-graph-g6-node-role">${escapeHtml(data.roleLabel)}</span>
        </div>
        <p>${escapeHtml(data.subtitle)}</p>
        <div class="case-graph-g6-node-meta">
          <span>${escapeHtml(data.receivedText)}</span>
          <span>${escapeHtml(data.sentText)}</span>
        </div>
      </div>
    </div>
  `;
}

function resolveEventId(event: any): string | null {
  const id = event?.target?.id ?? event?.target?.config?.id ?? null;
  return id ? String(id) : null;
}

function resolvePointerPosition(event: any): { x: number; y: number } {
  const native = event?.nativeEvent ?? event?.originalEvent ?? event;
  return {
    x: Number(native?.clientX ?? native?.x ?? 0),
    y: Number(native?.clientY ?? native?.y ?? 0),
  };
}

function escapeClassName(value: string): string {
  return value.replace(/[^a-z0-9_-]/giu, '-');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function resolveRoleBadge(role: string | undefined): string {
  switch (role) {
    case 'core':
      return '核';
    case 'bridge':
      return '桥';
    case 'upstream':
      return '来';
    case 'downstream':
      return '去';
    case 'transit':
      return '转';
    default:
      return '外';
  }
}

function getMoneyEdgeStyle(
  amount: number,
  data?: {
    strength?: 'weak' | 'medium' | 'strong';
    isActive?: boolean;
    isDimmed?: boolean;
  },
): { stroke: string; lineWidth: number; opacity: number } {
  const strength = data?.strength ?? 'medium';
  let stroke = '#6b7ea6';
  let lineWidth = 2.4;
  let opacity = 0.82;

  if (strength === 'strong') {
    stroke = amount >= 100_000 ? '#3658b5' : '#4b6fd4';
    lineWidth = amount >= 100_000 ? 5.3 : 4.1;
    opacity = 0.94;
  } else if (strength === 'weak') {
    stroke = '#9eaec9';
    lineWidth = 1.6;
    opacity = 0.34;
  }

  if (data?.isActive) {
    stroke = '#1d4ed8';
    lineWidth += 0.8;
    opacity = 1;
  } else if (data?.isDimmed) {
    opacity *= 0.26;
  }

  return { stroke, lineWidth, opacity };
}
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function buildEdgeLabel(
  data: {
    tradeCount?: number;
    tradeAmount?: number;
    showLabel?: boolean;
  } | undefined,
): string {
  const tradeCount = Number(data?.tradeCount ?? 0);
  const tradeAmount = Number(data?.tradeAmount ?? 0);
  if (!data?.showLabel || (!tradeCount && !tradeAmount)) {
    return '';
  }
  return `转账${tradeCount}笔 ${formatEdgeAmount(tradeAmount)}元`;
}

function formatEdgeAmount(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return rounded.toFixed(2);
}
