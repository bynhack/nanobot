import { LocateFixed, MousePointer2, Network, Scan, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { Graph as G6Graph } from '@antv/g6';

import { buildCaseGraphViewModel, formatCompactAmount } from './graph-analysis';
import type { CaseGraphNodeRole } from './graph-analysis';
import { computeCaseGraphLayout } from './graph-layout';
import type { CaseGraphConversationFocus, CaseGraphData, CaseGraphExcludedNode, CaseGraphNode, CaseGraphTradeCard } from './types';

interface GraphCanvasProps {
  graphData: CaseGraphData | null;
  graphContent?: string | null;
  tradeCards: CaseGraphTradeCard[];
  focusAccountIds: string[];
  focusLabels: string[];
  loading: boolean;
  drilldownLoading: boolean;
  excluding: boolean;
  hasActiveTab: boolean;
  onChooseInvestigationOrigin: () => void;
  onCompleteGraphRelations: () => void;
  onOpenGraphConfig: () => void;
  onDrillDown: (direction: 'in' | 'out' | 'both', node: CaseGraphNode, tradeCard: CaseGraphTradeCard | null) => void;
  onExcludeNode: (node: CaseGraphExcludedNode) => void;
  onExcludeNodes: (nodes: CaseGraphExcludedNode[]) => void;
  onOpenEdgeDetail: (edgeId: string, edgeFocus?: CaseGraphConversationFocus) => void;
  onFocusChange?: (focus: CaseGraphConversationFocus | null) => void;
  onNodePositionsChange?: (positions: Record<string, { x: number; y: number }>, reason: NodePositionsChangeReason) => void;
}

type NodePositionsChangeReason = 'layout' | 'drag';

interface CanvasContextMenuState {
  x: number;
  y: number;
}

interface BrushSelectionState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface NodeContextMenuItem {
  name: string;
  value: 'drill:both' | 'drill:in' | 'drill:out' | 'exclude';
}

type GraphSelectionStates = Record<string, string | string[]>;

const GRAPH_WIDTH = 1028;
const GRAPH_HEIGHT = 620;
const NODE_WIDTH = 248;
const NODE_HEIGHT = 84;
const COLUMN_GAP = 126;
const ROW_GAP = 88;
const GRAPH_PADDING: [number, number, number, number] = [24, 24, 132, 24];
const MINIMAP_SIZE: [number, number] = [176, 108];
const GRAPH_EDGE_TYPE = 'quadratic';
const CONTEXT_MENU_WIDTH = 210;
const CONTEXT_MENU_ROW_HEIGHT = 48;
const CONTEXT_MENU_PADDING = 10;
const BRUSH_MIN_DISTANCE = 6;
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
  excluding,
  hasActiveTab,
  onChooseInvestigationOrigin,
  onCompleteGraphRelations,
  onOpenGraphConfig,
  onOpenEdgeDetail,
  onDrillDown,
  onExcludeNode,
  onExcludeNodes,
  onFocusChange,
  onNodePositionsChange,
}: GraphCanvasProps) {
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [activeEdgeId, setActiveEdgeId] = useState<string | null>(null);
  const [activeRoleFilter, setActiveRoleFilter] = useState<Exclude<CaseGraphNodeRole, 'peripheral'> | null>(null);
  const [canvasContextMenu, setCanvasContextMenu] = useState<CanvasContextMenuState | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [brushMode, setBrushMode] = useState(false);
  const [brushSelection, setBrushSelection] = useState<BrushSelectionState | null>(null);
  const [graphReadyNonce, setGraphReadyNonce] = useState(0);
  const [graphViewport, setGraphViewport] = useState({ width: GRAPH_WIDTH, height: GRAPH_HEIGHT });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<G6Graph | null>(null);
  const graphHostRef = useRef<HTMLDivElement | null>(null);
  const renderCycleRef = useRef(0);
  const graphRenderedRef = useRef(false);
  const onOpenEdgeDetailRef = useRef(onOpenEdgeDetail);
  const onFocusChangeRef = useRef(onFocusChange);
  const onNodePositionsChangeRef = useRef(onNodePositionsChange);
  const lastEmittedFocusKeyRef = useRef<string | null>(null);
  const brushSelectionRef = useRef<BrushSelectionState | null>(null);
  const nodesLengthRef = useRef(0);
  const activeNodeIdRef = useRef<string | null>(null);
  const selectedNodeIdsRef = useRef<string[]>([]);
  const contextMenuNodeIdRef = useRef<string | null>(null);
  const contextMenuSelectionIdsRef = useRef<string[]>([]);
  const nodeLookupRef = useRef<Map<string, CaseGraphData['nodes'][number]>>(new Map());
  const tradeCardByNodeIdRef = useRef<Map<string, CaseGraphTradeCard>>(new Map());
  const drilldownLoadingRef = useRef(drilldownLoading);
  const excludingRef = useRef(excluding);
  const onDrillDownRef = useRef(onDrillDown);
  const onExcludeNodeRef = useRef(onExcludeNode);
  const onExcludeNodesRef = useRef(onExcludeNodes);
  const activeNeighborhoodRef = useRef<{
    relatedNodeIds: Set<string>;
    relatedEdgeIds: Set<string>;
  } | null>(null);

  const nodes = graphData?.nodes ?? [];
  const edges = graphData?.edges ?? [];
  const nodeLookup = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const edgeLookup = useMemo(() => new Map(edges.map((edge) => [resolveEdgeId(edge), edge])), [edges]);
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
        viewModel: graphView,
      },
    );
  }, [focusAccountIds, focusLabels, graphContent, graphData, graphView, graphViewport.height, graphViewport.width]);

  const activeNeighborhood = useMemo(() => {
    if (activeRoleFilter) {
      return buildRoleNeighborhood(activeRoleFilter, nodes, edges, graphView.nodeMetricsById);
    }
    if (!activeNodeId && !activeEdgeId) {
      return null;
    }
    const relatedNodeIds = new Set<string>(activeNodeId ? [activeNodeId] : []);
    const relatedEdgeIds = new Set<string>();
    if (activeEdgeId) {
      const activeEdge = edgeLookup.get(activeEdgeId);
      if (activeEdge) {
        relatedEdgeIds.add(activeEdgeId);
        relatedNodeIds.add(activeEdge.source);
        relatedNodeIds.add(activeEdge.target);
      }
    }
    for (const edge of edges) {
      if (activeNodeId && (edge.source === activeNodeId || edge.target === activeNodeId)) {
        relatedNodeIds.add(edge.source);
        relatedNodeIds.add(edge.target);
        relatedEdgeIds.add(resolveEdgeId(edge));
      }
    }
    return { relatedNodeIds, relatedEdgeIds };
  }, [activeEdgeId, activeNodeId, activeRoleFilter, edgeLookup, edges, graphView.nodeMetricsById, nodes]);

  const selectedNode = activeNodeId ? nodeLookup.get(activeNodeId) ?? null : null;
  const selectedEdge = activeEdgeId ? edgeLookup.get(activeEdgeId) ?? null : null;
  const selectedNodeMetrics = activeNodeId ? graphView.nodeMetricsById.get(activeNodeId) ?? null : null;
  const activeRoleCount = activeRoleFilter ? graphView.roleCounts[activeRoleFilter] : 0;
  const selectedNodes = useMemo(
    () => selectedNodeIds.map((nodeId) => nodeLookup.get(nodeId)).filter((node): node is CaseGraphData['nodes'][number] => Boolean(node)),
    [nodeLookup, selectedNodeIds],
  );

  useEffect(() => {
    onOpenEdgeDetailRef.current = onOpenEdgeDetail;
  }, [onOpenEdgeDetail]);

  useEffect(() => {
    nodeLookupRef.current = nodeLookup;
    tradeCardByNodeIdRef.current = tradeCardByNodeId;
    drilldownLoadingRef.current = drilldownLoading;
    excludingRef.current = excluding;
    onDrillDownRef.current = onDrillDown;
    onExcludeNodeRef.current = onExcludeNode;
    onExcludeNodesRef.current = onExcludeNodes;
  }, [drilldownLoading, excluding, nodeLookup, onDrillDown, onExcludeNode, onExcludeNodes, tradeCardByNodeId]);

  useEffect(() => {
    onFocusChangeRef.current = onFocusChange;
  }, [onFocusChange]);

  useEffect(() => {
    onNodePositionsChangeRef.current = onNodePositionsChange;
  }, [onNodePositionsChange]);

  useEffect(() => {
    if (!onNodePositionsChange || !graphLayout.size) {
      return;
    }
    const positions: Record<string, { x: number; y: number }> = {};
    for (const [nodeId, point] of graphLayout) {
      positions[nodeId] = { x: point.x, y: point.y };
    }
    onNodePositionsChange(positions, 'layout');
  }, [graphLayout, onNodePositionsChange]);

  useEffect(() => {
    nodesLengthRef.current = nodes.length;
  }, [nodes.length]);

  useEffect(() => {
    activeNodeIdRef.current = activeNodeId;
    activeNeighborhoodRef.current = activeNeighborhood;
    selectedNodeIdsRef.current = selectedNodeIds;
  }, [activeNeighborhood, activeNodeId, selectedNodeIds]);

  useEffect(() => {
    brushSelectionRef.current = brushSelection;
  }, [brushSelection]);

  const syncSelectedNodeIdsFromGraph = (states: GraphSelectionStates) => {
    const selectedIds = nodes
      .map((node) => node.id)
      .filter((nodeId) => {
        const state = states[nodeId];
        return Array.isArray(state) ? state.includes('selected') : state === 'selected';
      });
    setSelectedNodeIds(selectedIds);
    setActiveNodeId(selectedIds[0] ?? null);
    setActiveEdgeId(null);
    setActiveRoleFilter(null);
  };

  useEffect(() => {
    if (activeRoleFilter && graphView.roleCounts[activeRoleFilter] === 0) {
      setActiveRoleFilter(null);
    }
  }, [activeRoleFilter, graphView.roleCounts]);

  useEffect(() => {
    const closeMenu = () => {
      setCanvasContextMenu(null);
    };
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const suppressNativeContextMenu = (event: MouseEvent) => {
      if (!shouldSuppressNativeContextMenu(event.target)) return;
      event.preventDefault();
    };
    stage.addEventListener('contextmenu', suppressNativeContextMenu, { capture: true });
    return () => {
      stage.removeEventListener('contextmenu', suppressNativeContextMenu, { capture: true });
    };
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
            lineDash: (datum: any) => (datum?.data?.isExcluded ? [8, 6] : []),
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
        behaviors: buildGraphBehaviors(false),
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
          {
            type: 'contextmenu',
            key: 'case-graph-node-contextmenu',
            className: 'case-graph-g6-context-menu',
            trigger: 'contextmenu',
            offset: [4, 4],
            enable: (event: any) => event?.targetType === 'node',
            getItems: (event: any) => {
              const nodeId = resolveEventId(event);
              const node = nodeId ? nodeLookupRef.current.get(nodeId) ?? null : null;
              setCanvasContextMenu(null);
              contextMenuNodeIdRef.current = nodeId;
              if (!nodeId || !node) {
                contextMenuSelectionIdsRef.current = [];
                return [];
              }

              const currentSelection = selectedNodeIdsRef.current;
              const actionNodeIds = currentSelection.includes(nodeId) && currentSelection.length > 1
                ? currentSelection
                : [nodeId];
              contextMenuSelectionIdsRef.current = actionNodeIds;
              setActiveRoleFilter(null);
              setActiveEdgeId(null);
              setActiveNodeId(nodeId);
              setSelectedNodeIds(actionNodeIds);

              const actionNodes = actionNodeIds
                .map((id) => nodeLookupRef.current.get(id))
                .filter((item): item is CaseGraphData['nodes'][number] => Boolean(item));
              return buildNodeContextMenuItems({
                selectedCount: Math.max(actionNodes.length, 1),
                canDrill: Boolean(resolveTradeCard(node, tradeCardByNodeIdRef.current)) && !node.isExcluded && !drilldownLoadingRef.current,
                canExclude: actionNodes.some((item) => !item.isExcluded) && !excludingRef.current,
              });
            },
            onClick: (value: string) => {
              const nodeId = contextMenuNodeIdRef.current;
              const node = nodeId ? nodeLookupRef.current.get(nodeId) ?? null : null;
              if (!node) return;

              if (value === 'drill:both' || value === 'drill:in' || value === 'drill:out') {
                if (node.isExcluded || drilldownLoadingRef.current) return;
                const tradeCard = resolveTradeCard(node, tradeCardByNodeIdRef.current);
                if (!tradeCard) return;
                onDrillDownRef.current(value.replace('drill:', '') as 'in' | 'out' | 'both', node, tradeCard);
                return;
              }

              if (value === 'exclude') {
                if (excludingRef.current) return;
                const nodesToExclude = contextMenuSelectionIdsRef.current
                  .map((id) => nodeLookupRef.current.get(id))
                  .filter((item): item is CaseGraphData['nodes'][number] => Boolean(item) && !item.isExcluded)
                  .map(buildExcludedNodePayload);
                if (nodesToExclude.length > 1) {
                  onExcludeNodesRef.current(nodesToExclude);
                } else if (nodesToExclude[0]) {
                  onExcludeNodeRef.current(nodesToExclude[0]);
                }
              }
            },
          },
        ],
      });

      graph.on('node:click', (event: any) => {
        const nodeId = resolveEventId(event);
        setCanvasContextMenu(null);
        setActiveRoleFilter(null);
        if (nodeId) {
          const native = event?.nativeEvent ?? event?.originalEvent ?? event;
          setActiveEdgeId(null);
          setActiveNodeId(nodeId);
          setSelectedNodeIds((current) => resolveNextSelectedNodeIds(current, nodeId, native));
        }
      });

      graph.on('edge:click', (event: any) => {
        const edgeId = resolveEventId(event);
        setCanvasContextMenu(null);
        setActiveRoleFilter(null);
        if (edgeId) {
          const edgeFocus = buildEdgeFocusPayload(edgeLookup.get(edgeId), nodeLookup);
          setActiveNodeId(null);
          setActiveEdgeId(edgeId);
          setSelectedNodeIds([]);
          onOpenEdgeDetailRef.current(edgeId, edgeFocus ?? undefined);
        }
      });

      graph.on('canvas:click', () => {
        setCanvasContextMenu(null);
        if (!brushSelectionRef.current) {
          setSelectedNodeIds([]);
        }
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
    graph.setBehaviors(buildGraphBehaviors(brushMode, {
      onSelectionChange: syncSelectedNodeIdsFromGraph,
      onDragFinish: () => {
        const positions = collectRenderedNodePositions(graph);
        if (!Object.keys(positions).length) return;
        onNodePositionsChangeRef.current?.(positions, 'drag');
      },
    }));
  }, [brushMode, graphReadyNonce, nodes]);

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
            selectedNodeIdsRef.current,
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
          selectedNodeIds,
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
          data: buildEdgeRenderData(edge, metrics, activeNeighborhood, parallelOffsets.get(edgeId) ?? 0, activeEdgeId),
        };
      }),
    );
    void graph.draw().catch(() => {});
  }, [activeEdgeId, activeNeighborhood, activeNodeId, edges, graphReadyNonce, graphView, nodes, parallelOffsets, tradeCardByNodeId]);

  useEffect(() => {
    if (activeNodeId && !nodeLookup.has(activeNodeId)) {
      setActiveNodeId(null);
    }
    if (activeEdgeId && !edgeLookup.has(activeEdgeId)) {
      setActiveEdgeId(null);
    }
  }, [activeEdgeId, activeNodeId, edgeLookup, nodeLookup]);

  useEffect(() => {
    if (!onFocusChangeRef.current) {
      return;
    }
    let nextFocus: CaseGraphConversationFocus | null = null;
    if (selectedEdge) {
      const sourceNode = nodeLookup.get(selectedEdge.source);
      const targetNode = nodeLookup.get(selectedEdge.target);
      nextFocus = {
        type: 'edge',
        graphId: '',
        caseId: '',
        graphName: '',
        from: selectedEdge.source,
        to: selectedEdge.target,
        fromName: sourceNode?.accountName || sourceNode?.label || sourceNode?.name || selectedEdge.source,
        toName: targetNode?.accountName || targetNode?.label || targetNode?.name || selectedEdge.target,
      };
    } else if (selectedNode) {
      nextFocus = {
        type: 'node',
        graphId: '',
        caseId: '',
        graphName: '',
        nodeId: String(selectedNode.id || '').trim(),
        label: selectedNode.label || selectedNode.name,
        accountId: selectedNode.accountId ?? null,
        accountName: selectedNode.accountName || selectedNode.label || selectedNode.name,
        tradeCard: selectedNode.tradeCard || undefined,
      };
    }
    const nextKey = focusIdentityKey(nextFocus);
    if (lastEmittedFocusKeyRef.current === nextKey) {
      return;
    }
    lastEmittedFocusKeyRef.current = nextKey;
    onFocusChangeRef.current(nextFocus);
  }, [nodeLookup, selectedEdge, selectedNode]);

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
                  setCanvasContextMenu(null);
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

      <div
        className="case-graph-canvas-stage case-graph-canvas-stage--full"
        ref={stageRef}
        onContextMenuCapture={(event) => {
          if (!shouldSuppressNativeContextMenu(event.target)) return;
          event.preventDefault();
        }}
        onContextMenu={(event) => {
          if ((event.target as HTMLElement).closest('.case-graph-g6-node, .g6-contextmenu, .case-graph-context-menu, .case-graph-canvas-overlay-tools')) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          const bounds = stageRef.current?.getBoundingClientRect();
          const pointer = {
            x: bounds ? event.clientX - bounds.left : event.clientX,
            y: bounds ? event.clientY - bounds.top : event.clientY,
          };
          setCanvasContextMenu(
            resolveMenuPosition(
              pointer,
              bounds ? { width: bounds.width, height: bounds.height } : { width: graphViewport.width, height: graphViewport.height },
              CONTEXT_MENU_ROW_HEIGHT,
            ),
          );
        }}
      >
        {hasActiveTab ? (
          <div className="case-graph-canvas-overlay-tools" aria-label="图操作">
            <button
              className="case-graph-mini-button"
              type="button"
              disabled={!nodes.length}
              title="重置视图"
              onClick={() => {
                setActiveNodeId(null);
                setActiveRoleFilter(null);
                setCanvasContextMenu(null);
                setBrushSelection(null);
                setBrushMode(false);
                void graphRef.current?.fitView({ when: 'always', direction: 'both' });
              }}
            >
              <LocateFixed size={14} />
              <span>重置视图</span>
            </button>
            <button
              className={`case-graph-mini-button${brushMode ? ' is-active' : ''}`}
              type="button"
              aria-pressed={brushMode}
              disabled={!nodes.length}
              title={brushMode ? '退出框选' : '框选节点'}
              onClick={() => {
                setCanvasContextMenu(null);
                setBrushSelection(null);
                setBrushMode((current) => !current);
              }}
            >
              <Scan size={14} />
              <span>{brushMode ? '退出框选' : '框选节点'}</span>
            </button>
            <button
              className="case-graph-mini-button"
              type="button"
              disabled={!nodes.length || loading || drilldownLoading}
              title="分析图上节点关系"
              onClick={() => {
                setCanvasContextMenu(null);
                onCompleteGraphRelations();
              }}
            >
              <Network size={14} />
              <span>{drilldownLoading ? '分析中' : '关系'}</span>
            </button>
            <button
              className="case-graph-mini-button case-graph-mini-button--icon"
              type="button"
              disabled={loading || drilldownLoading}
              aria-label="钻取配置"
              title="钻取配置"
              onClick={() => {
                setCanvasContextMenu(null);
                onOpenGraphConfig();
              }}
            >
              <Settings2 size={14} />
            </button>
          </div>
        ) : null}

        <div
          className={`case-graph-g6-host${nodes.length ? '' : ' is-hidden'}`}
          ref={graphHostRef}
          data-brush-mode={brushMode ? 'true' : 'false'}
        />

        {!nodes.length ? (
          <div className="case-graph-empty">
            {loading ? (
              '正在加载图数据...'
            ) : hasActiveTab ? (
              <div className="case-graph-empty-action">
                <strong>空白图已创建</strong>
                <span>右键空白处，或点击下面按钮选择侦办起点。</span>
                <button className="case-graph-primary-button" type="button" onClick={onChooseInvestigationOrigin}>
                  选择侦办起点
                </button>
              </div>
            ) : (
              '先点击新增，创建图形页签。'
            )}
          </div>
        ) : null}

        {nodes.length && selectedNodeIds.length > 1 ? (
          <div className="case-graph-selection-toolbar">
            <MousePointer2 size={14} />
            <span>已选择 {selectedNodeIds.length} 个节点</span>
            <button
              type="button"
              disabled={excluding || selectedNodes.every((node) => node.isExcluded)}
              onClick={() => onExcludeNodes(selectedNodes.filter((node) => !node.isExcluded).map(buildExcludedNodePayload))}
            >
              取消上图
            </button>
          </div>
        ) : null}

        {canvasContextMenu ? (
          <div
            className="case-graph-context-menu case-graph-context-menu--canvas"
            style={{ left: canvasContextMenu.x, top: canvasContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="case-graph-context-item"
              disabled={!hasActiveTab || loading || drilldownLoading}
              onClick={() => {
                setCanvasContextMenu(null);
                onChooseInvestigationOrigin();
              }}
            >
              <LocateFixed size={14} />
              <span>选择侦办起点</span>
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

function buildExcludedNodePayload(node: CaseGraphData['nodes'][number]): CaseGraphExcludedNode {
  const accounts = Array.isArray(node.accounts) ? node.accounts : [];
  const accountIds = accounts
    .map((account) => String(account.accountId || '').trim())
    .filter(Boolean);
  const tradeCards = accounts
    .map((account) => String(account.tradeCard || '').trim())
    .filter(Boolean);
  const ownAccountId = String(node.accountId || '').trim();
  const ownTradeCard = String(node.tradeCard || '').trim();
  return {
    nodeId: String(node.id || '').trim(),
    label: String(node.label || node.name || node.accountName || node.tradeCard || node.id || '').trim(),
    type: String(node.type || (node.isGroup ? 'subject' : 'account')).trim(),
    accountIds: [...new Set([...accountIds, ownAccountId].filter(Boolean))],
    tradeCards: [...new Set([...tradeCards, ownTradeCard].filter(Boolean))],
    reason: 'manual',
  };
}

function buildNodeRenderData(
  node: CaseGraphData['nodes'][number],
  metrics: ReturnType<typeof buildCaseGraphViewModel>['nodeMetricsById'] extends Map<string, infer T> ? T : never,
  isSeed: boolean,
  activeNodeId: string | null,
  selectedNodeIds: string[],
  activeNeighborhood: {
    relatedNodeIds: Set<string>;
    relatedEdgeIds: Set<string>;
  } | null,
) {
  return {
    nodeId: node.id,
    title: node.name || node.label || node.accountName || node.tradeCard || node.accountId || node.id,
    subtitle: resolveNodeSubtitle(node),
    role: metrics?.role ?? 'peripheral',
    roleLabel: metrics?.roleLabel ?? '外围',
    roleBadge: resolveRoleBadge(metrics?.role),
    receivedText: `收 ${formatCompactAmount(metrics?.receivedAmount ?? 0)} 元`,
    sentText: `出 ${formatCompactAmount(metrics?.sentAmount ?? 0)} 元`,
    isSeed,
    isFocus: Boolean(metrics?.isFocus),
    isActive: activeNodeId === node.id,
    isSelected: selectedNodeIds.includes(node.id),
    isDimmed: Boolean(activeNeighborhood && !activeNeighborhood.relatedNodeIds.has(node.id)),
    isExcluded: Boolean(node.isExcluded),
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
  activeEdgeId: string | null = null,
) {
  const edgeId = resolveEdgeId(edge);
  return {
    tradeCount: edge.tradeCount,
    tradeAmount: edge.tradeAmount,
    strength: metrics?.strength ?? 'medium',
    isFocusEdge: metrics?.isFocusEdge ?? false,
    isActive: activeEdgeId === edgeId || Boolean(activeNeighborhood?.relatedEdgeIds.has(edgeId)),
    isDimmed: Boolean(edge.isExcluded || (activeNeighborhood && !activeNeighborhood.relatedEdgeIds.has(edgeId))),
    isExcluded: Boolean(edge.isExcluded),
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

export function resolveGraphCanvasLayoutForTest(graphData: CaseGraphData): Map<string, { x: number; y: number }> {
  return computeCaseGraphLayout(graphData, {
    graphWidth: GRAPH_WIDTH,
    graphHeight: GRAPH_HEIGHT,
    nodeWidth: NODE_WIDTH,
    nodeHeight: NODE_HEIGHT,
    columnGap: COLUMN_GAP,
    rowGap: ROW_GAP,
  });
}

export function buildGraphBehaviorsForTest(brushMode: boolean): Array<string | Record<string, unknown>> {
  return buildGraphBehaviors(brushMode);
}

export function buildNodeContextMenuItemsForTest(input: {
  selectedCount: number;
  canDrill: boolean;
  canExclude: boolean;
}): NodeContextMenuItem[] {
  return buildNodeContextMenuItems(input);
}

export function resolveNextSelectedNodeIdsForTest(
  current: string[],
  nodeId: string,
  native: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
): string[] {
  return resolveNextSelectedNodeIds(current, nodeId, native);
}

export function shouldSuppressNativeContextMenuForTest(className: string): boolean {
  return shouldSuppressNativeContextMenu({ classList: { contains: (value: string) => className.split(/\s+/).includes(value) } } as unknown as EventTarget);
}

export function shouldStopNativeContextMenuPropagationForTest(): boolean {
  return shouldStopNativeContextMenuPropagation();
}

export function resolveMenuPositionForTest(
  pointer: { x: number; y: number },
  stage: { width: number; height: number },
  menuHeight: number,
): { x: number; y: number } {
  return resolveMenuPosition(pointer, stage, menuHeight);
}

export function shouldEmitFocusChangeForTest(previous: unknown, next: unknown): boolean {
  return focusIdentityKey(previous as CaseGraphConversationFocus | null) !== focusIdentityKey(next as CaseGraphConversationFocus | null);
}

export function resolveNodeSubtitleForTest(node: Partial<CaseGraphData['nodes'][number]>): string {
  return resolveNodeSubtitle(node as CaseGraphData['nodes'][number]);
}

function focusIdentityKey(focus: CaseGraphConversationFocus | null): string {
  if (!focus) {
    return 'none';
  }
  if (focus.type === 'node') {
    return `node:${focus.nodeId || focus.accountId || focus.tradeCard || ''}`;
  }
  if (focus.type === 'edge') {
    return `edge:${focus.from || ''}->${focus.to || ''}`;
  }
  return 'graph';
}

function resolveNodeSubtitle(node: CaseGraphData['nodes'][number]): string {
  const accountIds = collectNodeAccountIds(node);
  const rawId = String(node.id || '').trim();
  if (node.type === 'subject' || rawId.startsWith('subject:')) {
    const suspectMatch = rawId.match(/^subject:suspect:(.+)$/);
    if (suspectMatch?.[1]) {
      return accountIds.length > 1
        ? `主体编号 ${suspectMatch[1]} · ${accountIds.length} 个账号`
        : `主体编号 ${suspectMatch[1]}`;
    }
    if (accountIds.length > 1) {
      return `合并主体 · ${accountIds.length} 个账号`;
    }
    if (accountIds[0]) {
      return `主体账号 ${accountIds[0]}`;
    }
    return '主体';
  }
  if (accountIds[0]) {
    return `账号 ${accountIds[0]}`;
  }
  const tradeCard = String(node.tradeCard || node.accounts?.[0]?.tradeCard || '').trim();
  if (tradeCard) {
    return '交易账户';
  }
  return '图谱节点';
}

function collectNodeAccountIds(node: CaseGraphData['nodes'][number]): string[] {
  const values = [
    node.accountId,
    ...(node.accountIds ?? []),
    ...((node.accounts ?? []).map((account) => account.accountId)),
  ];
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function resolveEdgeId(edge: CaseGraphData['edges'][number]): string {
  return String(edge.id || `${edge.source}->${edge.target}`).trim();
}

function buildEdgeFocusPayload(
  edge: CaseGraphData['edges'][number] | undefined,
  nodeLookup: Map<string, CaseGraphData['nodes'][number]>,
): CaseGraphConversationFocus | null {
  if (!edge) {
    return null;
  }
  const source = String(edge.source || edge.from || '').trim();
  const target = String(edge.target || edge.to || '').trim();
  if (!source || !target) {
    return null;
  }
  const sourceNode = nodeLookup.get(source);
  const targetNode = nodeLookup.get(target);
  return {
    type: 'edge',
    graphId: '',
    caseId: '',
    graphName: '',
    from: source,
    to: target,
    fromName: sourceNode?.accountName || sourceNode?.label || sourceNode?.name || source,
    toName: targetNode?.accountName || targetNode?.label || targetNode?.name || target,
  };
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

function toggleId(current: string[], id: string): string[] {
  return current.includes(id)
    ? current.filter((item) => item !== id)
    : [...current, id];
}

function resolveNextSelectedNodeIds(
  current: string[],
  nodeId: string,
  native: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
): string[] {
  if (native.shiftKey || native.ctrlKey || native.metaKey) {
    return toggleId(current, nodeId);
  }
  return [nodeId];
}

function buildNodeContextMenuItems(input: {
  selectedCount: number;
  canDrill: boolean;
  canExclude: boolean;
}): NodeContextMenuItem[] {
  const selectedCount = Math.max(1, input.selectedCount);
  if (selectedCount > 1) {
    return input.canExclude
      ? [{ name: `取消上图 ${selectedCount} 个`, value: 'exclude' }]
      : [];
  }
  const items: NodeContextMenuItem[] = [];
  if (input.canDrill) {
    items.push(
      { name: '双向钻取', value: 'drill:both' },
      { name: '上钻', value: 'drill:in' },
      { name: '下钻', value: 'drill:out' },
    );
  }
  if (input.canExclude) {
    items.push({ name: '取消上图', value: 'exclude' });
  }
  return items;
}

function buildGraphBehaviors(
  brushMode: boolean,
  callbacks: {
    onSelectionChange?: (states: GraphSelectionStates) => void;
    onDragFinish?: () => void;
  } = {},
): Array<string | Record<string, unknown>> {
  return [
    ...(brushMode
      ? [
          {
            type: 'brush-select',
            state: 'selected',
            enableElements: ['node'],
            trigger: [],
            animation: false,
            onSelect: callbacks.onSelectionChange,
          },
        ]
      : [
          'drag-canvas',
          {
            type: 'click-select',
            multiple: true,
            trigger: ['shift'],
            state: 'selected',
            onClick: callbacks.onSelectionChange,
          },
          {
            type: 'drag-element',
            key: 'case-graph-drag-node',
            dropEffect: 'none',
            hideEdge: 'none',
            enable: (event: any) => (event?.targetType == null || event?.targetType === 'node') && resolvePointerButton(event) === 0,
            onFinish: callbacks.onDragFinish,
          },
        ]),
    'zoom-canvas',
  ];
}

function collectRenderedNodePositions(graph: G6Graph): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of graph.getNodeData()) {
    const nodeId = String(node.id || '').trim();
    const x = finiteNumber((node as any)?.style?.x);
    const y = finiteNumber((node as any)?.style?.y);
    if (!nodeId || x == null || y == null) continue;
    positions[nodeId] = { x, y };
  }
  return positions;
}

function resolvePointerButton(event: any): number {
  return Number(event?.button ?? event?.nativeEvent?.button ?? event?.originalEvent?.button ?? 0);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function shouldSuppressNativeContextMenu(target: EventTarget | null): boolean {
  const canUseElement = typeof Element !== 'undefined';
  if (!canUseElement || !(target instanceof Element)) {
    const maybeElement = target as { classList?: { contains?: (value: string) => boolean } } | null;
    return Boolean(
      maybeElement?.classList?.contains?.('case-graph-g6-node') ||
      maybeElement?.classList?.contains?.('case-graph-g6-host') ||
      maybeElement?.classList?.contains?.('case-graph-canvas-stage') ||
      maybeElement?.classList?.contains?.('case-graph-context-menu') ||
      maybeElement?.classList?.contains?.('g6-contextmenu'),
    );
  }
  return Boolean(target.closest('.case-graph-canvas-stage, .case-graph-g6-host, .case-graph-g6-node, .case-graph-context-menu, .g6-contextmenu'));
}

function shouldStopNativeContextMenuPropagation(): boolean {
  return false;
}

function getContextMenuHeight(selectedCount: number): number {
  return CONTEXT_MENU_ROW_HEIGHT * (selectedCount > 1 ? 5 : 5);
}

function resolveMenuPosition(
  pointer: { x: number; y: number },
  stage: { width: number; height: number },
  menuHeight: number,
): { x: number; y: number } {
  const maxX = Math.max(CONTEXT_MENU_PADDING, stage.width - CONTEXT_MENU_WIDTH - CONTEXT_MENU_PADDING);
  const maxY = Math.max(CONTEXT_MENU_PADDING, stage.height - menuHeight - CONTEXT_MENU_PADDING);
  return {
    x: Math.min(maxX, Math.max(CONTEXT_MENU_PADDING, pointer.x)),
    y: Math.min(maxY, Math.max(CONTEXT_MENU_PADDING, pointer.y)),
  };
}

function normalizeBrushRect(brush: BrushSelectionState): { left: number; top: number; width: number; height: number; right: number; bottom: number } {
  const left = Math.min(brush.startX, brush.currentX);
  const top = Math.min(brush.startY, brush.currentY);
  const right = Math.max(brush.startX, brush.currentX);
  const bottom = Math.max(brush.startY, brush.currentY);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function brushSelectionStyle(brush: BrushSelectionState): CSSProperties {
  const rect = normalizeBrushRect(brush);
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function isNodeInsideBrush(
  node: CaseGraphData['nodes'][number],
  rect: { left: number; top: number; right: number; bottom: number },
  stage: HTMLDivElement | null,
): boolean {
  if (!stage) return false;
  const nodeElement = stage.querySelector<HTMLElement>(
    `.case-graph-g6-node[data-node-id="${cssEscapeValue(node.id)}"]`,
  );
  if (!nodeElement) return false;
  const stageBounds = stage.getBoundingClientRect();
  const nodeBounds = nodeElement.getBoundingClientRect();
  const nodeCenter = {
    x: nodeBounds.left + nodeBounds.width / 2 - stageBounds.left,
    y: nodeBounds.top + nodeBounds.height / 2 - stageBounds.top,
  };
  return nodeCenter.x >= rect.left && nodeCenter.x <= rect.right && nodeCenter.y >= rect.top && nodeCenter.y <= rect.bottom;
}

function renderNodeMarkup(data: {
  nodeId: string;
  title: string;
  subtitle: string;
  isSeed: boolean;
  isFocus: boolean;
  isActive: boolean;
  isSelected: boolean;
  isDimmed: boolean;
  role: string;
  roleLabel: string;
  roleBadge: string;
  receivedText: string;
  sentText: string;
  isExcluded: boolean;
}): string {
  return `
    <div class="case-graph-g6-node role-${escapeClassName(data.role)}${data.isSeed ? ' is-seed' : ''}${data.isFocus ? ' is-focus' : ''}${data.isActive ? ' is-active' : ''}${data.isSelected ? ' is-selected' : ''}${data.isDimmed ? ' is-dimmed' : ''}${data.isExcluded ? ' is-excluded' : ''}" data-node-id="${escapeHtml(data.nodeId)}">
      <div class="case-graph-g6-node-badge">
        <span>${escapeHtml(data.isExcluded ? '排' : data.roleBadge)}</span>
      </div>
      <div class="case-graph-g6-node-copy">
        <div class="case-graph-g6-node-head">
          <strong>${escapeHtml(data.isExcluded ? `已排除 · ${data.title}` : data.title)}</strong>
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

function cssEscapeValue(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
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
    isExcluded?: boolean;
  },
): { stroke: string; lineWidth: number; opacity: number } {
  if (data?.isExcluded) {
    return { stroke: '#9aa4b2', lineWidth: 1.6, opacity: 0.38 };
  }
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
