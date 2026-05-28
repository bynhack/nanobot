import { ChevronLeft, ChevronRight, FileSearch, History, LocateFixed, MousePointer2, Network, Route, SearchCheck, Settings2, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { Graph as G6Graph } from '@antv/g6';

import { buildCaseGraphViewModel, formatCompactAmount } from './graph-analysis';
import type { CaseGraphNodeRole } from './graph-analysis';
import { computeCaseGraphLayout, type CaseGraphLayoutMode } from './graph-layout';
import { detectCaseGraphCluePatterns, type CaseGraphCluePatternMatch } from './clue-patterns';
import type { CaseGraphConversationFocus, CaseGraphData, CaseGraphExcludedNode, CaseGraphNode, CaseGraphReplayTimeline, CaseGraphTradeCard } from './types';

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
  replayMode?: boolean;
  replayTimeline?: CaseGraphReplayTimeline;
  showCanvasTools?: boolean;
  preferPersistedPositions?: boolean;
  layoutMode?: CaseGraphLayoutMode;
  emptyMessage?: string;
  onChooseInvestigationOrigin: () => void;
  onCompleteGraphRelations: () => void;
  onOpenGraphConfig: () => void;
  onOpenFlowGraph?: () => void;
  onDrillDown: (direction: 'in' | 'out' | 'both', node: CaseGraphNode, tradeCard: CaseGraphTradeCard | null) => void;
  onOpenNodeDetailAnalysis: (node: CaseGraphNode) => void;
  onOpenNodeSummaryAnalysis: (node: CaseGraphNode) => void;
  onOpenGlobalSummaryAnalysis: () => void;
  onOpenManualNode: (position?: { x: number; y: number } | null) => void;
  onOpenManualTrade: (node?: CaseGraphNode | null) => void;
  onOpenRealityRelation: (node?: CaseGraphNode | null) => void;
  onExcludeNode: (node: CaseGraphExcludedNode) => void;
  onExcludeNodes: (nodes: CaseGraphExcludedNode[]) => void;
  onRestoreNode: (nodeId: string) => void;
  onOpenEdgeDetail: (edgeId: string, edgeFocus?: CaseGraphConversationFocus) => void;
  onFocusChange?: (focus: CaseGraphConversationFocus | null) => void;
  onNodePositionsChange?: (positions: Record<string, { x: number; y: number }>, reason: NodePositionsChangeReason) => void;
}

type NodePositionsChangeReason = 'layout' | 'drag';

interface CanvasContextMenuState {
  x: number;
  y: number;
  graphX?: number;
  graphY?: number;
}

interface SelectionToolbarPosition {
  x: number;
  y: number;
}

interface GraphActiveNeighborhood {
  relatedNodeIds: Set<string>;
  relatedEdgeIds: Set<string>;
}

interface NodeContextMenuItem {
  name: string;
  value:
    | 'drill:both'
    | 'drill:in'
    | 'drill:out'
    | 'detail-analysis'
    | 'summary-analysis'
    | 'manual-trade'
    | 'reality-relation'
    | 'exclude'
    | 'restore';
}

type GraphSelectionStates = Record<string, string | string[]>;

interface GraphRenderSnapshot {
  nodePositions: Map<string, { x: number; y: number }>;
  edgeIds: Set<string>;
}

interface GraphRenderTransition {
  shouldAnimate: boolean;
  shouldFitView: boolean;
  newNodeIds: Set<string>;
  newEdgeIds: Set<string>;
  movedNodeIds: Set<string>;
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
const CONTEXT_MENU_WIDTH = 210;
const CONTEXT_MENU_ROW_HEIGHT = 48;
const CONTEXT_MENU_PADDING = 10;
const ONE_HOP_NEIGHBORHOOD_DEGREE = 1;
const HOVER_HIGHLIGHT_STATE = 'highlight';
const HOVER_DIM_STATE = 'dim';
const CLICK_HIGHLIGHT_STATE = 'click-highlight';
const CLICK_DIM_STATE = 'click-dim';
const REVEAL_STATE = 'reveal';
const GRAPH_HOVER_STATES = [HOVER_HIGHLIGHT_STATE, HOVER_DIM_STATE] as const;
const GRAPH_CLICK_STATES = [CLICK_HIGHLIGHT_STATE, CLICK_DIM_STATE] as const;
const GRAPH_INTERACTION_STATES = [...GRAPH_HOVER_STATES, ...GRAPH_CLICK_STATES] as const;
const GRAPH_TRANSIENT_STATES = [...GRAPH_INTERACTION_STATES, REVEAL_STATE] as const;
const GRAPH_DATA_ANIMATION = { duration: 720, easing: 'ease-in-out' };
const GRAPH_VIEWPORT_ANIMATION = { duration: 360, easing: 'ease-in-out' };
const GRAPH_REVEAL_STATE_HOLD_MS = 2200;
const GRAPH_POSITION_EPSILON = 0.5;
const MAX_CLUE_PATTERN_HULLS = 6;
const CLUE_PATTERN_HULL_STYLES = [
  { fill: '#2563eb', stroke: '#2563eb' },
  { fill: '#0f766e', stroke: '#0f766e' },
  { fill: '#b45309', stroke: '#b45309' },
  { fill: '#7c3aed', stroke: '#7c3aed' },
  { fill: '#be123c', stroke: '#be123c' },
  { fill: '#475569', stroke: '#475569' },
] as const;
const GRAPH_NODE_ANIMATION = {
  enter: 'fade',
  update: [{ fields: ['x', 'y'], duration: GRAPH_DATA_ANIMATION.duration, easing: GRAPH_DATA_ANIMATION.easing }],
  exit: 'fade',
};
const GRAPH_EDGE_ANIMATION = {
  enter: 'path-in',
  update: 'path-in',
  exit: 'fade',
};
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
  replayMode = false,
  replayTimeline,
  showCanvasTools = true,
  preferPersistedPositions = true,
  layoutMode = 'investigation',
  emptyMessage,
  onChooseInvestigationOrigin,
  onCompleteGraphRelations,
  onOpenGraphConfig,
  onOpenFlowGraph,
  onOpenEdgeDetail,
  onOpenNodeDetailAnalysis,
  onOpenNodeSummaryAnalysis,
  onOpenGlobalSummaryAnalysis,
  onOpenManualNode,
  onOpenManualTrade,
  onOpenRealityRelation,
  onDrillDown,
  onExcludeNode,
  onExcludeNodes,
  onRestoreNode,
  onFocusChange,
  onNodePositionsChange,
}: GraphCanvasProps) {
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [activeEdgeId, setActiveEdgeId] = useState<string | null>(null);
  const [activeRoleFilter, setActiveRoleFilter] = useState<Exclude<CaseGraphNodeRole, 'peripheral'> | null>(null);
  const [canvasContextMenu, setCanvasContextMenu] = useState<CanvasContextMenuState | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectionToolbarPosition, setSelectionToolbarPosition] = useState<SelectionToolbarPosition | null>(null);
  const [cluePatternsVisible, setCluePatternsVisible] = useState(false);
  const [selectedCluePatternId, setSelectedCluePatternId] = useState<string | null>(null);
  const [graphReadyNonce, setGraphReadyNonce] = useState(0);
  const [graphViewport, setGraphViewport] = useState({ width: GRAPH_WIDTH, height: GRAPH_HEIGHT });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const selectionToolbarRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<G6Graph | null>(null);
  const graphHostRef = useRef<HTMLDivElement | null>(null);
  const renderCycleRef = useRef(0);
  const graphRenderedRef = useRef(false);
  const graphRenderSnapshotRef = useRef<GraphRenderSnapshot>(createEmptyGraphRenderSnapshot());
  const revealClearTimeoutRef = useRef<number | null>(null);
  const officialInteractionSuppressedRef = useRef(false);
  const onOpenEdgeDetailRef = useRef(onOpenEdgeDetail);
  const onOpenNodeDetailAnalysisRef = useRef(onOpenNodeDetailAnalysis);
  const onOpenNodeSummaryAnalysisRef = useRef(onOpenNodeSummaryAnalysis);
  const onOpenGlobalSummaryAnalysisRef = useRef(onOpenGlobalSummaryAnalysis);
  const onOpenManualNodeRef = useRef(onOpenManualNode);
  const onOpenManualTradeRef = useRef(onOpenManualTrade);
  const onOpenRealityRelationRef = useRef(onOpenRealityRelation);
  const onFocusChangeRef = useRef(onFocusChange);
  const onNodePositionsChangeRef = useRef(onNodePositionsChange);
  const replayModeRef = useRef(replayMode);
  const replayTimelineRef = useRef(replayTimeline);
  const lastEmittedFocusKeyRef = useRef<string | null>(null);
  const suppressNextCanvasClickRef = useRef(false);
  const selectionToolbarFrameRef = useRef<number | null>(null);
  const nodesLengthRef = useRef(0);
  const activeNodeIdRef = useRef<string | null>(null);
  const selectedNodeIdsRef = useRef<string[]>([]);
  const hoverStateActiveRef = useRef(false);
  const contextMenuNodeIdRef = useRef<string | null>(null);
  const contextMenuSelectionIdsRef = useRef<string[]>([]);
  const nodeLookupRef = useRef<Map<string, CaseGraphData['nodes'][number]>>(new Map());
  const edgeLookupRef = useRef<Map<string, CaseGraphData['edges'][number]>>(new Map());
  const tradeCardByNodeIdRef = useRef<Map<string, CaseGraphTradeCard>>(new Map());
  const drilldownLoadingRef = useRef(drilldownLoading);
  const excludingRef = useRef(excluding);
  const onDrillDownRef = useRef(onDrillDown);
  const onExcludeNodeRef = useRef(onExcludeNode);
  const onExcludeNodesRef = useRef(onExcludeNodes);
  const onRestoreNodeRef = useRef(onRestoreNode);
  const activeEdgeIdRef = useRef<string | null>(null);
  const activeNeighborhoodRef = useRef<GraphActiveNeighborhood | null>(null);
  const graphFocusDrawCycleRef = useRef(0);
  const cluePatternFocusCycleRef = useRef(0);

  const nodes = graphData?.nodes ?? [];
  const edges = graphData?.edges ?? [];
  const realityEdges = useMemo<CaseGraphData['edges']>(
    () => (graphData?.realityRelations ?? []).map((relation) => {
      const source = String(relation.source || relation.sourceNodeId || '').trim();
      const target = String(relation.target || relation.targetNodeId || '').trim();
      return {
        id: String(relation.id || `reality:${source}->${target}:${relation.relationType}`),
        from: source,
        to: target,
        source,
        target,
        tradeCount: 0,
        tradeAmount: 0,
        count: 0,
        amount: 0,
        edgeKind: 'reality' as const,
        relationType: relation.relationType,
        label: relation.label || relation.relationType,
      };
    }).filter((edge) => edge.source && edge.target && edge.source !== edge.target),
    [graphData?.realityRelations],
  );
  const renderEdges = useMemo(() => [...edges, ...realityEdges], [edges, realityEdges]);
  const nodeLookup = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const edgeLookup = useMemo(() => new Map(renderEdges.map((edge) => [resolveEdgeId(edge), edge])), [renderEdges]);
  const parallelOffsets = useMemo(() => computeParallelEdgeOffsets(renderEdges), [renderEdges]);
  const graphView = useMemo(
    () =>
      buildCaseGraphViewModel(graphData, {
        focusAccountIds,
        focusLabels,
      }),
    [focusAccountIds, focusLabels, graphData],
  );
  const cluePatternMatches = useMemo(
    () => detectCaseGraphCluePatterns(graphData, graphView),
    [graphData, graphView],
  );
  const activeCluePatternHulls = useMemo<Array<CaseGraphCluePatternMatch | null>>(() => {
    const hulls = Array<CaseGraphCluePatternMatch | null>(MAX_CLUE_PATTERN_HULLS).fill(null);
    if (!cluePatternsVisible || !selectedCluePatternId) return hulls;
    const index = cluePatternMatches.findIndex((match) => match.id === selectedCluePatternId);
    if (index >= 0 && index < MAX_CLUE_PATTERN_HULLS) {
      hulls[index] = cluePatternMatches[index];
    }
    return hulls;
  }, [cluePatternMatches, cluePatternsVisible, selectedCluePatternId]);
  const selectedCluePattern = useMemo(
    () => cluePatternMatches.find((match) => match.id === selectedCluePatternId) ?? null,
    [cluePatternMatches, selectedCluePatternId],
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
        preferPersistedPositions,
        layoutMode,
        viewModel: graphView,
      },
    );
  }, [focusAccountIds, focusLabels, graphContent, graphData, graphView, graphViewport.height, graphViewport.width, layoutMode, preferPersistedPositions]);

  const activeNeighborhood = useMemo(() => {
    if (cluePatternsVisible && selectedCluePattern) {
      return {
        relatedNodeIds: new Set(selectedCluePattern.nodeIds),
        relatedEdgeIds: new Set(selectedCluePattern.edgeIds),
      };
    }
    if (activeRoleFilter) {
      return buildRoleNeighborhood(activeRoleFilter, nodes, edges, graphView.nodeMetricsById);
    }
    if (!activeNodeId && !activeEdgeId) {
      return null;
    }
    if (activeEdgeId) {
      const activeEdge = edgeLookup.get(activeEdgeId);
      if (activeEdge) {
        const relatedNodeIds = new Set<string>();
        const relatedEdgeIds = new Set<string>();
        relatedEdgeIds.add(activeEdgeId);
        relatedNodeIds.add(activeEdge.source);
        relatedNodeIds.add(activeEdge.target);
        return { relatedNodeIds, relatedEdgeIds };
      }
    }
    return null;
  }, [activeEdgeId, activeNodeId, activeRoleFilter, cluePatternsVisible, edgeLookup, edges, graphView.nodeMetricsById, nodes, selectedCluePattern]);

  const selectedNode = activeNodeId ? nodeLookup.get(activeNodeId) ?? null : null;
  const selectedEdge = activeEdgeId ? edgeLookup.get(activeEdgeId) ?? null : null;
  const selectedNodeMetrics = activeNodeId ? graphView.nodeMetricsById.get(activeNodeId) ?? null : null;
  const activeRoleCount = activeRoleFilter ? graphView.roleCounts[activeRoleFilter] : 0;
  const selectedNodes = useMemo(
    () => selectedNodeIds.map((nodeId) => nodeLookup.get(nodeId)).filter((node): node is CaseGraphData['nodes'][number] => Boolean(node)),
    [nodeLookup, selectedNodeIds],
  );
  const replayTimelineView = useMemo(
    () => buildReplayTimelineView(replayTimeline),
    [replayTimeline],
  );

  useEffect(() => {
    onOpenEdgeDetailRef.current = onOpenEdgeDetail;
  }, [onOpenEdgeDetail]);

  useEffect(() => {
    onOpenNodeDetailAnalysisRef.current = onOpenNodeDetailAnalysis;
  }, [onOpenNodeDetailAnalysis]);

  useEffect(() => {
    onOpenNodeSummaryAnalysisRef.current = onOpenNodeSummaryAnalysis;
  }, [onOpenNodeSummaryAnalysis]);

  useEffect(() => {
    onOpenGlobalSummaryAnalysisRef.current = onOpenGlobalSummaryAnalysis;
  }, [onOpenGlobalSummaryAnalysis]);

  useEffect(() => {
    onOpenManualNodeRef.current = onOpenManualNode;
  }, [onOpenManualNode]);

  useEffect(() => {
    onOpenManualTradeRef.current = onOpenManualTrade;
  }, [onOpenManualTrade]);

  useEffect(() => {
    onOpenRealityRelationRef.current = onOpenRealityRelation;
  }, [onOpenRealityRelation]);

  useEffect(() => {
    nodeLookupRef.current = nodeLookup;
    edgeLookupRef.current = edgeLookup;
    tradeCardByNodeIdRef.current = tradeCardByNodeId;
    drilldownLoadingRef.current = drilldownLoading;
    excludingRef.current = excluding;
    onDrillDownRef.current = onDrillDown;
    onExcludeNodeRef.current = onExcludeNode;
    onExcludeNodesRef.current = onExcludeNodes;
    onRestoreNodeRef.current = onRestoreNode;
  }, [drilldownLoading, edgeLookup, excluding, nodeLookup, onDrillDown, onExcludeNode, onExcludeNodes, onRestoreNode, tradeCardByNodeId]);

  useEffect(() => {
    onFocusChangeRef.current = onFocusChange;
  }, [onFocusChange]);

  useEffect(() => {
    onNodePositionsChangeRef.current = onNodePositionsChange;
  }, [onNodePositionsChange]);

  useEffect(() => {
    replayModeRef.current = replayMode;
  }, [replayMode]);

  useEffect(() => {
    replayTimelineRef.current = replayTimeline;
  }, [replayTimeline]);

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
    activeEdgeIdRef.current = activeEdgeId;
    activeNeighborhoodRef.current = activeNeighborhood;
    selectedNodeIdsRef.current = selectedNodeIds;
  }, [activeEdgeId, activeNeighborhood, activeNodeId, selectedNodeIds]);

  useEffect(() => {
    scheduleSelectionToolbarPositionUpdate();
    return () => {
      if (selectionToolbarFrameRef.current != null) {
        window.cancelAnimationFrame(selectionToolbarFrameRef.current);
        selectionToolbarFrameRef.current = null;
      }
    };
  }, [graphReadyNonce, graphViewport.height, graphViewport.width, nodes, selectedNodeIds]);

  const syncOfficialStateClasses = () => {
    window.requestAnimationFrame(() => {
      const graph = graphRef.current;
      const graphHost = graphHostRef.current;
      if (!graph || !graphHost) return;
      hoverStateActiveRef.current = syncG6HtmlNodeStateClasses(graph, graphHost).hasHoverState;
    });
  };

  const clearHoverState = () => {
    const graph = graphRef.current;
    const graphHost = graphHostRef.current;
    if (!graphHost) return;
    if (graph) {
      void clearG6HtmlNodeHoverStates(graph, graphHost);
    } else {
      clearG6HtmlNodeStateClasses(graphHost);
    }
    hoverStateActiveRef.current = false;
  };

  const clearInteractionState = (): Promise<void> => {
    const graph = graphRef.current;
    const graphHost = graphHostRef.current;
    if (!graphHost) return Promise.resolve();
    clearG6HtmlNodeInteractionClasses(graphHost);
    if (graph) {
      return clearG6HtmlNodeInteractionStates(graph, graphHost).finally(() => {
        clearG6HtmlNodeInteractionClasses(graphHost);
        hoverStateActiveRef.current = false;
      });
    }
    clearG6HtmlNodeStateClasses(graphHost);
    hoverStateActiveRef.current = false;
    return Promise.resolve();
  };

  const closeCluePatternPanel = () => {
    cluePatternFocusCycleRef.current += 1;
    setCluePatternsVisible(false);
    setSelectedCluePatternId(null);
  };

  const clearFocusState = (options: { clearRole?: boolean; clearCluePatternPanel?: boolean } = {}) => {
    const shouldClearRole = options.clearRole ?? true;
    const shouldClearCluePatternPanel = options.clearCluePatternPanel ?? true;
    activeNodeIdRef.current = null;
    activeEdgeIdRef.current = null;
    selectedNodeIdsRef.current = [];
    activeNeighborhoodRef.current = null;
    clearG6HtmlNodeFocusClasses(graphHostRef.current);
    setActiveNodeId(null);
    setActiveEdgeId(null);
    if (shouldClearCluePatternPanel) {
      closeCluePatternPanel();
    } else {
      setSelectedCluePatternId(null);
    }
    if (shouldClearRole) {
      setActiveRoleFilter(null);
    }
    setSelectedNodeIds([]);
  };

  const applyGraphFocusState = (
    neighborhood: GraphActiveNeighborhood | null,
    options: {
      activeNodeId?: string | null;
      activeEdgeId?: string | null;
      selectedNodeIds?: string[];
    } = {},
  ): Promise<void> => {
    const graph = graphRef.current;
    if (!graph || !nodes.length || !graphRenderedRef.current) return Promise.resolve();
    const nextActiveNodeId = options.activeNodeId ?? activeNodeIdRef.current;
    const nextActiveEdgeId = options.activeEdgeId ?? activeEdgeIdRef.current;
    const nextSelectedNodeIds = options.selectedNodeIds ?? selectedNodeIdsRef.current;
    graphFocusDrawCycleRef.current += 1;

    graph.updateNodeData(
      nodes.map((node) => ({
        id: node.id,
        data: buildNodeRenderData(
          node,
          graphView.nodeMetricsById.get(node.id),
          Boolean(resolveTradeCard(node, tradeCardByNodeId)),
          nextActiveNodeId,
          nextSelectedNodeIds,
          neighborhood,
        ),
      })),
    );
    graph.updateEdgeData(
      renderEdges.map((edge) => {
        const edgeId = resolveEdgeId(edge);
        const metrics = graphView.edgeMetricsById.get(edgeId);
        return {
          id: edgeId,
          data: buildEdgeRenderData(edge, metrics, neighborhood, parallelOffsets.get(edgeId) ?? 0, nextActiveEdgeId),
        };
      }),
    );
    return graph.draw().catch(() => {});
  };

  const updateSelectionToolbarPosition = () => {
    const selectedIds = selectedNodeIdsRef.current;
    const stage = stageRef.current;
    const graphHost = graphHostRef.current;
    if (!selectedIds.length || !stage || !graphHost) {
      setSelectionToolbarPosition(null);
      return;
    }
    const selectedElements = selectedIds
      .map((nodeId) => findGraphNodeElement(graphHost, nodeId))
      .filter((element): element is HTMLElement => Boolean(element));
    if (!selectedElements.length) {
      setSelectionToolbarPosition(null);
      return;
    }

    const stageBounds = stage.getBoundingClientRect();
    const toolbarWidth = selectionToolbarRef.current?.offsetWidth || 420;
    const toolbarHeight = selectionToolbarRef.current?.offsetHeight || 42;
    const selectedBounds = selectedElements.reduce((bounds, element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: Math.min(bounds.left, rect.left),
        top: Math.min(bounds.top, rect.top),
        right: Math.max(bounds.right, rect.right),
        bottom: Math.max(bounds.bottom, rect.bottom),
      };
    }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
    if (!Number.isFinite(selectedBounds.left) || !Number.isFinite(selectedBounds.top)) {
      setSelectionToolbarPosition(null);
      return;
    }

    const gap = 12;
    const margin = 12;
    const selectedCenterX = (selectedBounds.left + selectedBounds.right) / 2 - stageBounds.left;
    const rawTop = selectedBounds.top - stageBounds.top - toolbarHeight - gap;
    const fallbackTop = selectedBounds.bottom - stageBounds.top + gap;
    const top = rawTop >= margin
      ? rawTop
      : Math.min(
        Math.max(fallbackTop, margin),
        Math.max(margin, stageBounds.height - toolbarHeight - margin),
      );
    const left = clampNumber(
      selectedCenterX - toolbarWidth / 2,
      margin,
      Math.max(margin, stageBounds.width - toolbarWidth - margin),
    );
    setSelectionToolbarPosition({ x: left, y: top });
  };

  const scheduleSelectionToolbarPositionUpdate = () => {
    if (typeof window === 'undefined') return;
    if (selectionToolbarFrameRef.current != null) {
      window.cancelAnimationFrame(selectionToolbarFrameRef.current);
    }
    selectionToolbarFrameRef.current = window.requestAnimationFrame(() => {
      selectionToolbarFrameRef.current = null;
      updateSelectionToolbarPosition();
    });
  };

  const syncSelectedNodeIdsFromGraph = (states: GraphSelectionStates) => {
    const selectedIds = nodes
      .map((node) => node.id)
      .filter((nodeId) => {
        const state = states[nodeId];
        return Array.isArray(state) ? state.includes('selected') : state === 'selected';
      });
    suppressNextCanvasClickRef.current = true;
    window.setTimeout(() => {
      suppressNextCanvasClickRef.current = false;
    }, 150);
    void clearInteractionState();
    if (!selectedIds.length) {
      clearFocusState();
      return;
    }
    clearG6HtmlNodeFocusClasses(graphHostRef.current);
    activeNodeIdRef.current = selectedIds[0] ?? null;
    selectedNodeIdsRef.current = selectedIds;
    activeNeighborhoodRef.current = null;
    setActiveNodeId(selectedIds[0] ?? null);
    setActiveEdgeId(null);
    setActiveRoleFilter(null);
    setSelectedNodeIds(selectedIds);
  };

  useEffect(() => {
    if (!replayMode) {
      return;
    }
    setCluePatternsVisible(false);
    setSelectedCluePatternId(null);
    setCanvasContextMenu(null);
    clearFocusState();
    void clearInteractionState();
  }, [replayMode]);

  useEffect(() => {
    if (!nodes.length && cluePatternsVisible) {
      setCluePatternsVisible(false);
      setSelectedCluePatternId(null);
    }
  }, [cluePatternsVisible, nodes.length]);

  useEffect(() => {
    if (selectedCluePatternId && !cluePatternMatches.some((match) => match.id === selectedCluePatternId)) {
      setSelectedCluePatternId(null);
    }
  }, [cluePatternMatches, selectedCluePatternId]);

  useEffect(() => {
    if (activeRoleFilter && graphView.roleCounts[activeRoleFilter] === 0) {
      setActiveRoleFilter(null);
    }
  }, [activeRoleFilter, graphView.roleCounts]);

  useEffect(() => {
    if (drilldownLoading) {
      officialInteractionSuppressedRef.current = true;
      clearFocusState();
      void clearInteractionState();
      return;
    }
    void clearInteractionState().finally(() => {
      officialInteractionSuppressedRef.current = false;
    });
  }, [drilldownLoading]);

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
    const graphHost = graphHostRef.current;
    if (!graphHost) return;

    const clearWhenOutsideNode = (event: PointerEvent | MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.case-graph-g6-node')) return;
      if (!hoverStateActiveRef.current) return;
      clearHoverState();
    };
    document.addEventListener('pointermove', clearWhenOutsideNode, true);
    document.addEventListener('mousemove', clearWhenOutsideNode, true);
    graphHost.addEventListener('pointerleave', clearHoverState);
    return () => {
      document.removeEventListener('pointermove', clearWhenOutsideNode, true);
      document.removeEventListener('mousemove', clearWhenOutsideNode, true);
      graphHost.removeEventListener('pointerleave', clearHoverState);
    };
  }, []);

  useEffect(() => {
    if (!graphHostRef.current || graphRef.current) return;
    let resizeObserver: ResizeObserver | null = null;
    let disposed = false;
    let createdGraph: G6Graph | null = null;

    void import('@antv/g6').then(({ CanvasEvent, EdgeEvent, Graph, GraphEvent, NodeEvent }) => {
      const graphHost = graphHostRef.current;
      if (!graphHost || disposed) return;

      const initialWidth = graphHost.clientWidth || GRAPH_WIDTH;
      const initialHeight = graphHost.clientHeight || GRAPH_HEIGHT;
      setGraphViewport({ width: initialWidth, height: initialHeight });

      const graph = new Graph({
        container: graphHost,
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
            opacity: 1,
            zIndex: 0,
            innerHTML: (datum: any) => renderNodeMarkup(datum.data),
          },
          animation: GRAPH_NODE_ANIMATION as any,
          state: {
            [HOVER_HIGHLIGHT_STATE]: {
              opacity: 1,
              zIndex: 3,
            },
            [CLICK_HIGHLIGHT_STATE]: {
              opacity: 1,
              zIndex: 3,
            },
            [HOVER_DIM_STATE]: {
              opacity: 0.24,
            },
            [CLICK_DIM_STATE]: {
              opacity: 0.24,
            },
            [REVEAL_STATE]: {
              opacity: 1,
              zIndex: 4,
            },
          },
        },
        edge: {
          type: GRAPH_EDGE_TYPE,
          style: {
            stroke: (datum: any) => getMoneyEdgeStyle(Number(datum?.data?.tradeAmount ?? 0), datum?.data).stroke,
            lineWidth: (datum: any) => getMoneyEdgeStyle(Number(datum?.data?.tradeAmount ?? 0), datum?.data).lineWidth,
            opacity: (datum: any) => getMoneyEdgeStyle(Number(datum?.data?.tradeAmount ?? 0), datum?.data).opacity,
            lineDash: (datum: any) => (datum?.data?.edgeKind === 'reality' ? [6, 7] : datum?.data?.isExcluded ? [8, 6] : []),
            curveOffset: (datum: any) => Number(datum?.data?.curveOffset ?? 0),
            lineCap: 'round',
            lineJoin: 'round',
            endArrow: (datum: any) => datum?.data?.edgeKind !== 'reality',
            cursor: (datum: any) => (datum?.data?.edgeKind === 'reality' ? 'default' : 'pointer'),
            label: true,
            labelAutoRotate: false,
            labelPlacement: 'center',
            labelText: (datum: any) => buildEdgeLabel(datum.data),
            labelFontSize: 11,
            labelFontWeight: 700,
            labelFill: (datum: any) => (datum?.data?.isDimmed ? '#8d98ab' : datum?.data?.edgeKind === 'reality' ? '#6b5b2a' : '#42526b'),
            labelBackground: true,
            labelBackgroundFill: (datum: any) => (datum?.data?.edgeKind === 'reality' ? '#fff8df' : datum?.data?.isActive ? '#f7faff' : '#ffffff'),
            labelBackgroundStroke: (datum: any) => (datum?.data?.edgeKind === 'reality' ? '#e8d28a' : datum?.data?.isActive ? '#7b8fd7' : '#d6deea'),
            labelBackgroundRadius: 8,
            labelPadding: [4, 8],
          },
          animation: GRAPH_EDGE_ANIMATION as any,
          state: {
            [HOVER_HIGHLIGHT_STATE]: {
              stroke: '#1d4ed8',
              lineWidth: 4,
              opacity: 1,
            },
            [CLICK_HIGHLIGHT_STATE]: {
              stroke: '#1d4ed8',
              lineWidth: 4,
              opacity: 1,
            },
            [HOVER_DIM_STATE]: {
              opacity: 0.12,
            },
            [CLICK_DIM_STATE]: {
              opacity: 0.12,
            },
            [REVEAL_STATE]: {
              stroke: '#0f766e',
              lineWidth: 4.8,
              opacity: 1,
            },
          },
        },
        behaviors: buildGraphBehaviors(),
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
          ...buildCluePatternHullPlugins(),
          {
            type: 'contextmenu',
            key: 'case-graph-node-contextmenu',
            className: 'case-graph-g6-context-menu',
            trigger: 'contextmenu',
            offset: [4, 4],
            enable: (event: any) => !replayModeRef.current && event?.targetType === 'node',
            getItems: (event: any) => {
              if (replayModeRef.current) {
                return [];
              }
              closeCluePatternPanel();
              void clearInteractionState();
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
                canRestore: Boolean(node.isExcluded) && !excludingRef.current,
                canDrill: Boolean(resolveTradeCard(node, tradeCardByNodeIdRef.current)) && !node.isExcluded && !drilldownLoadingRef.current,
                canDetailAnalysis: !node.isExcluded && hasIncidentEdges(nodeId, edgeLookupRef.current),
                canSummaryAnalysis: !node.isExcluded && hasNodeAccountEvidence(node, tradeCardByNodeIdRef.current),
                canManualActions: !node.isExcluded,
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
                officialInteractionSuppressedRef.current = true;
                clearFocusState();
                void clearInteractionState();
                onDrillDownRef.current(value.replace('drill:', '') as 'in' | 'out' | 'both', node, tradeCard);
                return;
              }

              if (value === 'detail-analysis') {
                if (node.isExcluded) return;
                officialInteractionSuppressedRef.current = true;
                clearFocusState();
                void clearInteractionState();
                onOpenNodeDetailAnalysisRef.current(node);
                officialInteractionSuppressedRef.current = false;
                return;
              }

              if (value === 'summary-analysis') {
                if (node.isExcluded) return;
                officialInteractionSuppressedRef.current = true;
                clearFocusState();
                void clearInteractionState();
                onOpenNodeSummaryAnalysisRef.current(node);
                officialInteractionSuppressedRef.current = false;
                return;
              }

              if (value === 'manual-trade') {
                if (node.isExcluded) return;
                officialInteractionSuppressedRef.current = true;
                clearFocusState();
                void clearInteractionState();
                onOpenManualTradeRef.current(node);
                officialInteractionSuppressedRef.current = false;
                return;
              }

              if (value === 'reality-relation') {
                if (node.isExcluded) return;
                officialInteractionSuppressedRef.current = true;
                clearFocusState();
                void clearInteractionState();
                onOpenRealityRelationRef.current(node);
                officialInteractionSuppressedRef.current = false;
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
                return;
              }

              if (value === 'restore') {
                if (!node.isExcluded || excludingRef.current) return;
                officialInteractionSuppressedRef.current = true;
                clearFocusState();
                void clearInteractionState();
                onRestoreNodeRef.current(node.id);
              }
            },
          },
        ],
      });

      const syncRenderedOfficialStateClasses = () => {
        const currentGraphHost = graphHostRef.current;
        if (!currentGraphHost || graphRef.current !== graph) return;
        hoverStateActiveRef.current = syncG6HtmlNodeStateClasses(graph, currentGraphHost).hasHoverState;
        scheduleSelectionToolbarPositionUpdate();
      };

      graph.on(GraphEvent.AFTER_DRAW, syncRenderedOfficialStateClasses);
      graph.on(GraphEvent.AFTER_RENDER, syncRenderedOfficialStateClasses);

      graph.on(NodeEvent.CLICK, (event: any) => {
        const nodeId = resolveEventId(event);
        closeCluePatternPanel();
        setCanvasContextMenu(null);
        setActiveRoleFilter(null);
        if (nodeId) {
          const native = event?.nativeEvent ?? event?.originalEvent ?? event;
          setActiveEdgeId(null);
          setActiveNodeId(nodeId);
          setSelectedNodeIds((current) => resolveNextSelectedNodeIds(current, nodeId, native));
        }
      });

      graph.on(EdgeEvent.CLICK, (event: any) => {
        const edgeId = resolveEventId(event);
        closeCluePatternPanel();
        setCanvasContextMenu(null);
        setActiveRoleFilter(null);
        if (edgeId) {
          const edge = edgeLookupRef.current.get(edgeId)
            ?? (graph.getEdgeData(edgeId) as CaseGraphData['edges'][number] | undefined);
          if (edge?.edgeKind === 'reality') {
            setActiveNodeId(null);
            setActiveEdgeId(edgeId);
            setSelectedNodeIds([]);
            return;
          }
          const edgeFocus = buildEdgeFocusPayload(edge, nodeLookupRef.current);
          setActiveNodeId(null);
          setActiveEdgeId(edgeId);
          setSelectedNodeIds([]);
          onOpenEdgeDetailRef.current(edgeId, edgeFocus ?? undefined);
        }
      });

      graph.on(CanvasEvent.CLICK, () => {
        setCanvasContextMenu(null);
        if (suppressNextCanvasClickRef.current) {
          suppressNextCanvasClickRef.current = false;
          return;
        }
        closeCluePatternPanel();
        clearFocusState();
        void clearInteractionState();
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
      if (revealClearTimeoutRef.current) {
        window.clearTimeout(revealClearTimeoutRef.current);
        revealClearTimeoutRef.current = null;
      }
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
    graph.setBehaviors(buildGraphBehaviors({
      onSelectionChange: syncSelectedNodeIdsFromGraph,
      onOfficialStateChange: syncOfficialStateClasses,
      isInteractionSuppressed: () => officialInteractionSuppressedRef.current,
      canBrushSelect: () => !replayModeRef.current,
      canDragElement: () => !replayModeRef.current,
      onDragFinish: () => {
        const positions = collectRenderedNodePositions(graph);
        if (!Object.keys(positions).length) return;
        onNodePositionsChangeRef.current?.(positions, 'drag');
      },
    }));
  }, [graphReadyNonce, nodes]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !graphRenderedRef.current) return;
    applyCluePatternHulls(graph, activeCluePatternHulls);
  }, [activeCluePatternHulls, graphReadyNonce, nodes.length]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;

    const nextSnapshot = createGraphRenderSnapshot(nodes, renderEdges, graphLayout);
    const transition = resolveGraphRenderTransition(graphRenderSnapshotRef.current, nextSnapshot);
    const graphPayload = {
      nodes: nodes.map((node) => {
        const point = graphLayout.get(node.id) ?? { x: NODE_WIDTH / 2, y: NODE_HEIGHT / 2 };
        const seedTradeCard = resolveTradeCard(node, tradeCardByNodeId);
        const metrics = graphView.nodeMetricsById.get(node.id);
        const revealStates = transition.shouldAnimate && transition.newNodeIds.has(node.id) ? [REVEAL_STATE] : undefined;
        return {
          id: node.id,
          style: {
            x: point.x,
            y: point.y,
          },
          ...(revealStates ? { states: revealStates } : {}),
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
      edges: renderEdges.map((edge) => {
        const edgeId = resolveEdgeId(edge);
        const revealStates = transition.shouldAnimate && transition.newEdgeIds.has(edgeId) ? [REVEAL_STATE] : undefined;
        return {
          id: edgeId,
          source: edge.source,
          target: edge.target,
          type: GRAPH_EDGE_TYPE,
          ...(revealStates ? { states: revealStates } : {}),
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
    officialInteractionSuppressedRef.current = true;
    if (revealClearTimeoutRef.current) {
      window.clearTimeout(revealClearTimeoutRef.current);
      revealClearTimeoutRef.current = null;
    }
    hoverStateActiveRef.current = false;
    graph.setOptions({ animation: transition.shouldAnimate ? GRAPH_DATA_ANIMATION : false } as any);
    void (async () => {
      await clearG6HtmlNodeTransientStates(graph, graphHostRef.current);
      clearG6HtmlNodeStateClasses(graphHostRef.current);
      if (
        renderCycleRef.current !== currentRenderCycle ||
        graphRef.current !== graph
      ) {
        return;
      }
      graph.setData(graphPayload);
      await graph.render();
    })()
      .then(async () => {
        if (
          renderCycleRef.current !== currentRenderCycle ||
          graphRef.current !== graph
        ) {
          return;
        }
        graphRenderedRef.current = true;
        graphRenderSnapshotRef.current = nextSnapshot;
        await clearG6HtmlNodeTransientStates(graph, graphHostRef.current);
        clearG6HtmlNodeStateClasses(graphHostRef.current);
        officialInteractionSuppressedRef.current = false;
        if (transition.shouldAnimate) {
          const revealIds = [...transition.newNodeIds, ...transition.newEdgeIds];
          const revealApplied = await applyRevealStates(
            graph,
            revealIds,
            currentRenderCycle,
            renderCycleRef,
            graphRef,
            graphHostRef,
          );
          if (
            !revealApplied ||
            renderCycleRef.current !== currentRenderCycle ||
            graphRef.current !== graph
          ) {
            return;
          }
          scheduleRevealStateClear(
            graph,
            revealIds,
            currentRenderCycle,
            renderCycleRef,
            graphRef,
            graphHostRef,
            revealClearTimeoutRef,
          );
        }
        if (nodes.length && transition.shouldFitView) {
          await graph.fitView(
            { when: 'always', direction: 'both' },
            transition.shouldAnimate ? GRAPH_VIEWPORT_ANIMATION : false,
          );
        }
        applyCluePatternHulls(graph, activeCluePatternHulls);
      })
      .catch(() => {
        if (renderCycleRef.current === currentRenderCycle) {
          graphRenderedRef.current = false;
          officialInteractionSuppressedRef.current = false;
        }
      });
  }, [graphLayout, graphReadyNonce, graphView, nodes, parallelOffsets, renderEdges, tradeCardByNodeId]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !nodes.length || !graphRenderedRef.current) return;
    applyGraphFocusState(activeNeighborhood, {
      activeNodeId,
      activeEdgeId,
      selectedNodeIds,
    });
  }, [activeEdgeId, activeNeighborhood, activeNodeId, graphReadyNonce, graphView, nodes, parallelOffsets, renderEdges, selectedNodeIds, tradeCardByNodeId]);

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

  const primarySelectedNode = selectedNodes[0] ?? null;
  const singleSelectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const singleSelectedTradeCard = singleSelectedNode ? resolveTradeCard(singleSelectedNode, tradeCardByNodeId) : null;
  const canRunSingleDrill = Boolean(singleSelectedNode && singleSelectedTradeCard && !singleSelectedNode.isExcluded && !drilldownLoading);
  const canRunSingleDetailAnalysis = Boolean(singleSelectedNode && !singleSelectedNode.isExcluded && hasIncidentEdges(singleSelectedNode.id, edgeLookup));
  const canRunSingleSummaryAnalysis = Boolean(singleSelectedNode && !singleSelectedNode.isExcluded && hasNodeAccountEvidence(singleSelectedNode, tradeCardByNodeId));
  const selectedRestorableNode = singleSelectedNode?.isExcluded ? singleSelectedNode : null;
  const selectedNodesToExclude = selectedNodes.filter((node) => !node.isExcluded);
  const showSelectionToolbar = Boolean(nodes.length && selectedNodeIds.length && !replayMode);

  const focusCluePattern = (match: CaseGraphCluePatternMatch) => {
    const nextSelectedNodeIds = match.nodeIds.filter((nodeId) => nodeLookupRef.current.has(nodeId));
    if (!nextSelectedNodeIds.length) return;
    const nextNeighborhood = {
      relatedNodeIds: new Set(nextSelectedNodeIds),
      relatedEdgeIds: new Set(match.edgeIds),
    };
    const focusCycle = cluePatternFocusCycleRef.current + 1;
    cluePatternFocusCycleRef.current = focusCycle;
    void (async () => {
      await clearInteractionState();
      if (cluePatternFocusCycleRef.current !== focusCycle) return;
      clearFocusState({ clearCluePatternPanel: false });
      await applyGraphFocusState(null, {
        activeNodeId: null,
        activeEdgeId: null,
        selectedNodeIds: [],
      });
      if (cluePatternFocusCycleRef.current !== focusCycle) return;
      setSelectedCluePatternId(match.id);
      activeNodeIdRef.current = null;
      activeEdgeIdRef.current = null;
      selectedNodeIdsRef.current = [];
      activeNeighborhoodRef.current = nextNeighborhood;
      setActiveRoleFilter(null);
      setActiveEdgeId(null);
      setActiveNodeId(null);
      setSelectedNodeIds([]);
      await applyGraphFocusState(nextNeighborhood, {
        activeNodeId: null,
        activeEdgeId: null,
        selectedNodeIds: [],
      });
    })();
  };

  const runSelectionNodeAction = (value: NodeContextMenuItem['value']) => {
    const node = singleSelectedNode ?? primarySelectedNode;
    if (!node) return;
    setCanvasContextMenu(null);

    if (value === 'drill:both' || value === 'drill:in' || value === 'drill:out') {
      if (!singleSelectedNode || singleSelectedNode.isExcluded || drilldownLoadingRef.current) return;
      const tradeCard = resolveTradeCard(singleSelectedNode, tradeCardByNodeIdRef.current);
      if (!tradeCard) return;
      officialInteractionSuppressedRef.current = true;
      clearFocusState();
      void clearInteractionState();
      onDrillDownRef.current(value.replace('drill:', '') as 'in' | 'out' | 'both', singleSelectedNode, tradeCard);
      return;
    }

    if (value === 'detail-analysis') {
      if (!singleSelectedNode || singleSelectedNode.isExcluded) return;
      officialInteractionSuppressedRef.current = true;
      clearFocusState();
      void clearInteractionState();
      onOpenNodeDetailAnalysisRef.current(singleSelectedNode);
      officialInteractionSuppressedRef.current = false;
      return;
    }

    if (value === 'summary-analysis') {
      if (!singleSelectedNode || singleSelectedNode.isExcluded) return;
      officialInteractionSuppressedRef.current = true;
      clearFocusState();
      void clearInteractionState();
      onOpenNodeSummaryAnalysisRef.current(singleSelectedNode);
      officialInteractionSuppressedRef.current = false;
      return;
    }

    if (value === 'manual-trade') {
      if (!singleSelectedNode || singleSelectedNode.isExcluded) return;
      officialInteractionSuppressedRef.current = true;
      clearFocusState();
      void clearInteractionState();
      onOpenManualTradeRef.current(singleSelectedNode);
      officialInteractionSuppressedRef.current = false;
      return;
    }

    if (value === 'reality-relation') {
      if (!singleSelectedNode || singleSelectedNode.isExcluded) return;
      officialInteractionSuppressedRef.current = true;
      clearFocusState();
      void clearInteractionState();
      onOpenRealityRelationRef.current(singleSelectedNode);
      officialInteractionSuppressedRef.current = false;
      return;
    }

    if (value === 'exclude') {
      if (excludingRef.current) return;
      const nodesToExclude = selectedNodesRefCurrent(nodeLookupRef.current, selectedNodeIdsRef.current)
        .filter((item) => !item.isExcluded)
        .map(buildExcludedNodePayload);
      if (nodesToExclude.length > 1) {
        onExcludeNodesRef.current(nodesToExclude);
      } else if (nodesToExclude[0]) {
        onExcludeNodeRef.current(nodesToExclude[0]);
      }
      return;
    }

    if (value === 'restore') {
      if (!singleSelectedNode?.isExcluded || excludingRef.current) return;
      officialInteractionSuppressedRef.current = true;
      clearFocusState();
      void clearInteractionState();
      onRestoreNodeRef.current(singleSelectedNode.id);
    }
  };

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
                  clearFocusState({ clearRole: false });
                  void clearInteractionState();
                  setActiveRoleFilter((current) => (current === role ? null : role));
                }}
              >
                {label} {graphView.roleCounts[role]}
              </button>
            ))}
          </div>

          {selectedNodeMetrics ? (
            <div
              className="case-graph-active-brief"
              title={`${selectedNodeMetrics.displayName} · ${selectedNodeMetrics.roleLabel} · 收 ${formatCompactAmount(selectedNodeMetrics.receivedAmount)} 元 · 出 ${formatCompactAmount(selectedNodeMetrics.sentAmount)} 元 · ${selectedNodeMetrics.degree} 个关联对象`}
            >
              <strong>{selectedNodeMetrics.displayName}</strong>
              <span>{selectedNodeMetrics.roleLabel}</span>
              <span>收 {formatCompactAmount(selectedNodeMetrics.receivedAmount)} 元</span>
              <span>出 {formatCompactAmount(selectedNodeMetrics.sentAmount)} 元</span>
              <span>{selectedNodeMetrics.degree} 个关联对象</span>
            </div>
          ) : activeRoleFilter ? (
            <div
              className="case-graph-active-brief"
              title={`${ROLE_CHIPS.find((item) => item.role === activeRoleFilter)?.label} · ${activeRoleCount} 个节点 · 已高亮该角色及其一跳资金线 · 再点一次取消`}
            >
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
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
          }
        }}
        onPointerUpCapture={scheduleSelectionToolbarPositionUpdate}
        onWheelCapture={scheduleSelectionToolbarPositionUpdate}
        onContextMenuCapture={(event) => {
          if (!shouldSuppressNativeContextMenu(event.target)) return;
          event.preventDefault();
        }}
        onContextMenu={(event) => {
          if (replayMode) {
            return;
          }
          if ((event.target as HTMLElement).closest('.case-graph-g6-node, .g6-contextmenu, .case-graph-context-menu, .case-graph-canvas-overlay-tools')) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          closeCluePatternPanel();
          const bounds = stageRef.current?.getBoundingClientRect();
          const pointer = {
            x: bounds ? event.clientX - bounds.left : event.clientX,
            y: bounds ? event.clientY - bounds.top : event.clientY,
          };
          const canvasPoint = graphRef.current?.getCanvasByClient?.([event.clientX, event.clientY]);
          const graphPoint = Array.isArray(canvasPoint) || canvasPoint instanceof Float32Array
            ? { x: Number(canvasPoint[0]), y: Number(canvasPoint[1]) }
            : null;
          const menuRows = nodes.length ? 5 : 1;
          const menuPosition = resolveMenuPosition(
            pointer,
            bounds ? { width: bounds.width, height: bounds.height } : { width: graphViewport.width, height: graphViewport.height },
            CONTEXT_MENU_ROW_HEIGHT * menuRows,
          );
          setCanvasContextMenu({
            ...menuPosition,
            ...(graphPoint && Number.isFinite(graphPoint.x) && Number.isFinite(graphPoint.y)
              ? { graphX: graphPoint.x, graphY: graphPoint.y }
              : {}),
          });
        }}
      >
        {hasActiveTab && showCanvasTools ? (
          <div className="case-graph-canvas-overlay-tools" aria-label="图操作">
            <button
              className="case-graph-mini-button"
              type="button"
              disabled={!nodes.length}
              title="重置视图"
              onClick={() => {
                clearFocusState();
                closeCluePatternPanel();
                setCanvasContextMenu(null);
                void clearInteractionState();
                void graphRef.current?.fitView({ when: 'always', direction: 'both' });
              }}
            >
              <LocateFixed size={14} />
              <span>重置视图</span>
            </button>
            <button
              className="case-graph-mini-button"
              type="button"
              disabled={!nodes.length || replayMode || loading || drilldownLoading}
              title="识别异常资金模式"
              onClick={() => {
                setCanvasContextMenu(null);
                if (cluePatternsVisible) {
                  clearFocusState();
                  void clearInteractionState();
                } else {
                  setCluePatternsVisible(true);
                }
              }}
            >
              <SearchCheck size={14} />
              <span>模式{cluePatternMatches.length ? ` ${cluePatternMatches.length}` : ''}</span>
            </button>
            <button
              className="case-graph-mini-button"
              type="button"
              disabled={!nodes.length || replayMode || loading || drilldownLoading}
              title="流向图"
              onClick={() => {
                closeCluePatternPanel();
                setCanvasContextMenu(null);
                onOpenFlowGraph?.();
              }}
            >
              <Route size={14} />
              <span>流向</span>
            </button>
            <button
              className="case-graph-mini-button"
              type="button"
              disabled={!nodes.length || replayMode || loading || drilldownLoading}
              title="分析图上节点关系"
              onClick={() => {
                closeCluePatternPanel();
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
              disabled={replayMode || loading || drilldownLoading}
              aria-label="钻取配置"
              title="钻取配置"
              onClick={() => {
                closeCluePatternPanel();
                setCanvasContextMenu(null);
                onOpenGraphConfig();
              }}
            >
              <Settings2 size={14} />
            </button>
          </div>
        ) : null}

        {cluePatternsVisible && !replayMode ? (
          <div className="case-graph-clue-pattern-panel" aria-label="异常资金模式识别结果">
            <div className="case-graph-clue-pattern-heading">
              <SearchCheck size={14} />
              <span>异常资金模式</span>
              <strong>{cluePatternMatches.length}</strong>
            </div>
            {cluePatternMatches.length ? (
              <div className="case-graph-clue-pattern-list">
                {cluePatternMatches.map((match, index) => (
                  <button
                    type="button"
                    key={match.id}
                    className={`case-graph-clue-pattern-item${selectedCluePatternId === match.id ? ' is-active' : ''}`}
                    onClick={() => focusCluePattern(match)}
                  >
                    <i style={{ background: CLUE_PATTERN_HULL_STYLES[index % CLUE_PATTERN_HULL_STYLES.length].stroke }} />
                    <span>
                      <strong>{match.label}</strong>
                      <em>适用：{match.caseTypes.join('、')}</em>
                      <small>{match.description}</small>
                      <small>{match.nodeIds.length} 个主体 · {match.edgeIds.length} 条资金线</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p>当前图暂未识别到明显的异常资金模式。</p>
            )}
            {selectedCluePatternId ? (
              <div className="case-graph-clue-pattern-advice">
                <strong>核查建议</strong>
                <p>{selectedCluePattern?.suggestion}</p>
              </div>
            ) : (
              <p className="case-graph-clue-pattern-tip">这些结果只是资金形态提示，点击某一项后会在图上圈出对应主体。</p>
            )}
          </div>
        ) : null}

        {replayTimelineView ? (
          <div className={`case-graph-replay-panel${replayMode ? ' is-replaying' : ''}`} aria-label="步骤回放">
            <div className="case-graph-replay-heading">
              <History size={14} />
              <span>步骤回放</span>
              <strong>{replayMode ? '历史预览' : '当前'}</strong>
            </div>
            <div className="case-graph-replay-copy">
              <span>{replayTimelineView.activeStep.label}</span>
              <strong>{replayTimelineView.activeStep.operationLabel}</strong>
              <em>{replayTimelineView.activeStep.nodeCount} 点 · {replayTimelineView.activeStep.edgeCount} 线</em>
              {replayTimelineView.activeStep.addedNodeCount || replayTimelineView.activeStep.addedEdgeCount ? (
                <i>+{replayTimelineView.activeStep.addedNodeCount} 点 / +{replayTimelineView.activeStep.addedEdgeCount} 线</i>
              ) : null}
            </div>
            <div className="case-graph-replay-actions">
              <button
                type="button"
                className="case-graph-mini-button case-graph-mini-button--icon"
                title="上一步"
                aria-label="上一步"
                disabled={!replayTimelineView.previousStep}
                onClick={() => replayTimelineView.previousStep && replayTimeline?.onStepSelect(replayTimelineView.previousStep.stepId)}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                className="case-graph-mini-button case-graph-mini-button--icon"
                title="下一步"
                aria-label="下一步"
                disabled={!replayTimelineView.nextStep}
                onClick={() => replayTimelineView.nextStep && replayTimeline?.onStepSelect(replayTimelineView.nextStep.stepId)}
              >
                <ChevronRight size={14} />
              </button>
              <button
                type="button"
                className="case-graph-mini-button"
                disabled={!replayMode}
                onClick={() => replayTimeline?.onStepSelect(null)}
              >
                当前
              </button>
            </div>
          </div>
        ) : null}

        <div
          className="case-graph-g6-host"
          ref={graphHostRef}
          data-replay-mode={replayMode ? 'true' : 'false'}
          data-has-replay-timeline={replayTimelineView ? 'true' : 'false'}
        />

        {!nodes.length ? (
          <div className="case-graph-empty">
            {loading ? (
              '正在加载图数据...'
            ) : emptyMessage ? (
              emptyMessage
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

        {showSelectionToolbar ? (
          <div
            className="case-graph-selection-toolbar"
            ref={selectionToolbarRef}
            style={selectionToolbarPosition
              ? { left: selectionToolbarPosition.x, top: selectionToolbarPosition.y }
              : { left: 12, top: 12, visibility: 'hidden' }}
          >
            <MousePointer2 size={14} />
            <span>{selectedNodeIds.length === 1 ? nodeDisplayName(primarySelectedNode) : `已选择 ${selectedNodeIds.length} 个主体`}</span>
            {selectedRestorableNode ? (
              <button
                type="button"
                className="case-graph-selection-toolbar-action"
                disabled={excluding}
                onClick={() => runSelectionNodeAction('restore')}
              >
                恢复上图
              </button>
            ) : null}
            {singleSelectedNode && !singleSelectedNode.isExcluded ? (
              <>
                {canRunSingleDrill ? (
                  <>
                    <button
                      type="button"
                      className="case-graph-selection-toolbar-action"
                      disabled={drilldownLoading}
                      onClick={() => runSelectionNodeAction('drill:both')}
                    >
                      双向钻取
                    </button>
                    <button
                      type="button"
                      className="case-graph-selection-toolbar-action"
                      disabled={drilldownLoading}
                      onClick={() => runSelectionNodeAction('drill:in')}
                    >
                      上钻
                    </button>
                    <button
                      type="button"
                      className="case-graph-selection-toolbar-action"
                      disabled={drilldownLoading}
                      onClick={() => runSelectionNodeAction('drill:out')}
                    >
                      下钻
                    </button>
                  </>
                ) : null}
                {canRunSingleDetailAnalysis ? (
                  <button
                    type="button"
                    className="case-graph-selection-toolbar-action"
                    onClick={() => runSelectionNodeAction('detail-analysis')}
                  >
                    交易核查
                  </button>
                ) : null}
                {canRunSingleSummaryAnalysis ? (
                  <button
                    type="button"
                    className="case-graph-selection-toolbar-action"
                    onClick={() => runSelectionNodeAction('summary-analysis')}
                  >
                    线索扩展
                  </button>
                ) : null}
                <button
                  type="button"
                  className="case-graph-selection-toolbar-action"
                  onClick={() => runSelectionNodeAction('manual-trade')}
                >
                  补充资金往来
                </button>
                <button
                  type="button"
                  className="case-graph-selection-toolbar-action"
                  onClick={() => runSelectionNodeAction('reality-relation')}
                >
                  标注现实关系
                </button>
              </>
            ) : null}
            {selectedNodesToExclude.length ? (
              <button
                type="button"
                className="case-graph-selection-toolbar-action case-graph-selection-toolbar-action--danger"
                disabled={excluding}
                onClick={() => runSelectionNodeAction('exclude')}
              >
                {selectedNodesToExclude.length > 1 ? `取消上图 ${selectedNodesToExclude.length} 个` : '取消上图'}
              </button>
            ) : null}
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
            {nodes.length ? (
              <>
                <button
                  type="button"
                  className="case-graph-context-item"
                  disabled={!hasActiveTab || replayMode || loading || drilldownLoading}
                  onClick={() => {
                    const position = canvasContextMenu.graphX != null && canvasContextMenu.graphY != null
                      ? { x: canvasContextMenu.graphX, y: canvasContextMenu.graphY }
                      : null;
                    setCanvasContextMenu(null);
                    clearFocusState();
                    void clearInteractionState();
                    onOpenManualNodeRef.current(position);
                  }}
                >
                  <UserPlus size={14} />
                  <span>创建交易主体</span>
                </button>
                <button
                  type="button"
                  className="case-graph-context-item"
                  disabled={!hasActiveTab || replayMode || loading || drilldownLoading}
                  onClick={() => {
                    setCanvasContextMenu(null);
                    clearFocusState();
                    void clearInteractionState();
                    onOpenGlobalSummaryAnalysisRef.current();
                  }}
                >
                  <FileSearch size={14} />
                  <span>全局线索扩展</span>
                </button>
                <button
                  type="button"
                  className="case-graph-context-item"
                  disabled={!hasActiveTab || replayMode || loading || drilldownLoading}
                  onClick={() => {
                    setCanvasContextMenu(null);
                    clearFocusState();
                    void clearInteractionState();
                    onOpenManualTradeRef.current(null);
                  }}
                >
                  <Route size={14} />
                  <span>补充资金往来</span>
                </button>
                <button
                  type="button"
                  className="case-graph-context-item"
                  disabled={!hasActiveTab || replayMode || loading || drilldownLoading}
                  onClick={() => {
                    setCanvasContextMenu(null);
                    clearFocusState();
                    void clearInteractionState();
                    onOpenRealityRelationRef.current(null);
                  }}
                >
                  <Network size={14} />
                  <span>标注现实关系</span>
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

interface ReplayTimelineView {
  activeStep: CaseGraphReplayTimeline['steps'][number];
  previousStep: CaseGraphReplayTimeline['steps'][number] | null;
  nextStep: CaseGraphReplayTimeline['steps'][number] | null;
}

function buildReplayTimelineView(timeline: CaseGraphReplayTimeline | undefined): ReplayTimelineView | null {
  if (!timeline || timeline.steps.length < 2) {
    return null;
  }
  const activeIndex = resolveReplayTimelineActiveIndex(timeline);
  return {
    activeStep: timeline.steps[activeIndex],
    previousStep: timeline.steps[activeIndex - 1] ?? null,
    nextStep: timeline.steps[activeIndex + 1] ?? null,
  };
}

function resolveReplayTimelineActiveIndex(timeline: Pick<CaseGraphReplayTimeline, 'steps' | 'activeStepId'>): number {
  if (!timeline.steps.length) {
    return -1;
  }
  if (!timeline.activeStepId) {
    return timeline.steps.length - 1;
  }
  const index = timeline.steps.findIndex((step) => step.stepId === timeline.activeStepId);
  return index >= 0 ? index : timeline.steps.length - 1;
}

export function buildReplayTimelineViewForTest(timeline: CaseGraphReplayTimeline | undefined): ReplayTimelineView | null {
  return buildReplayTimelineView(timeline);
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
  const isRelationHighlighted = Boolean(activeNeighborhood?.relatedNodeIds.has(node.id));
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
    isRelationHighlighted,
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
  if (edge.edgeKind === 'reality') {
    return {
      edgeKind: 'reality',
      tradeCount: 0,
      tradeAmount: 0,
      relationType: edge.relationType,
      label: edge.label || edge.relationType || '现实关系',
      strength: 'medium',
      isFocusEdge: false,
      isActive: activeEdgeId === edgeId || Boolean(activeNeighborhood?.relatedEdgeIds.has(edgeId)),
      isDimmed: Boolean(activeNeighborhood && !activeNeighborhood.relatedEdgeIds.has(edgeId)),
      isExcluded: false,
      showLabel: activeNeighborhood ? activeNeighborhood.relatedEdgeIds.has(edgeId) : true,
      curveOffset,
    };
  }
  return {
    edgeKind: 'money',
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

export function resolveGraphRenderTransitionForTest(
  previous: GraphRenderSnapshot,
  next: GraphRenderSnapshot,
): GraphRenderTransition {
  return resolveGraphRenderTransition(previous, next);
}

export function createGraphRenderSnapshotForTest(
  nodes: CaseGraphData['nodes'],
  edges: CaseGraphData['edges'],
  layout: Map<string, { x: number; y: number }>,
): GraphRenderSnapshot {
  return createGraphRenderSnapshot(nodes, edges, layout);
}

export function clearGraphInteractionStatesForTest(states: string[]): string[] {
  return filterG6ElementStates(states, new Set(GRAPH_INTERACTION_STATES));
}

export function clearGraphTransientStatesForTest(states: string[]): string[] {
  return filterG6ElementStates(states, new Set(GRAPH_TRANSIENT_STATES));
}

export function buildGraphBehaviorsForTest(
  interactionSuppressed = false,
  canDragElement = true,
  canBrushSelect = true,
): Array<string | Record<string, unknown>> {
  return buildGraphBehaviors({
    isInteractionSuppressed: () => interactionSuppressed,
    canDragElement: () => canDragElement,
    canBrushSelect: () => canBrushSelect,
  });
}

export function buildNodeContextMenuItemsForTest(input: {
  selectedCount: number;
  canRestore?: boolean;
  canDrill: boolean;
  canDetailAnalysis?: boolean;
  canSummaryAnalysis?: boolean;
  canManualActions?: boolean;
  canExclude: boolean;
}): NodeContextMenuItem[] {
  return buildNodeContextMenuItems({
    ...input,
    canRestore: input.canRestore ?? false,
    canDetailAnalysis: input.canDetailAnalysis ?? false,
    canSummaryAnalysis: input.canSummaryAnalysis ?? false,
    canManualActions: input.canManualActions ?? true,
  });
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
  canRestore: boolean;
  canDrill: boolean;
  canDetailAnalysis: boolean;
  canSummaryAnalysis: boolean;
  canManualActions: boolean;
  canExclude: boolean;
}): NodeContextMenuItem[] {
  const selectedCount = Math.max(1, input.selectedCount);
  if (input.canRestore) {
    return [{ name: '恢复上图', value: 'restore' }];
  }
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
  if (input.canDetailAnalysis) {
    items.push({ name: '交易核查', value: 'detail-analysis' });
  }
  if (input.canSummaryAnalysis) {
    items.push({ name: '线索扩展', value: 'summary-analysis' });
  }
  if (input.canManualActions) {
    items.push({ name: '补充资金往来', value: 'manual-trade' });
    items.push({ name: '标注现实关系', value: 'reality-relation' });
  }
  if (input.canExclude) {
    items.push({ name: '取消上图', value: 'exclude' });
  }
  return items;
}

function selectedNodesRefCurrent(
  nodeLookup: Map<string, CaseGraphData['nodes'][number]>,
  selectedNodeIds: string[],
): CaseGraphData['nodes'] {
  return selectedNodeIds
    .map((nodeId) => nodeLookup.get(nodeId))
    .filter((node): node is CaseGraphData['nodes'][number] => Boolean(node));
}

function nodeDisplayName(node: CaseGraphData['nodes'][number] | null): string {
  if (!node) return '已选择主体';
  return String(node.label || node.name || node.accountName || node.tradeCard || node.id || '已选择主体');
}

function hasIncidentEdges(nodeId: string, edges: Map<string, CaseGraphData['edges'][number]>): boolean {
  for (const edge of edges.values()) {
    if (edge.edgeKind === 'reality') continue;
    if (edge.source === nodeId || edge.target === nodeId || edge.from === nodeId || edge.to === nodeId) {
      return true;
    }
  }
  return false;
}

function hasNodeAccountEvidence(
  node: CaseGraphData['nodes'][number],
  tradeCardByNodeId: Map<string, CaseGraphTradeCard>,
): boolean {
  const ownAccountId = String(node.accountId || '').trim();
  const ownTradeCard = String(node.tradeCard || '').trim();
  if (ownAccountId || ownTradeCard) {
    return true;
  }
  if ((node.accounts ?? []).some((account) => account.accountId || account.tradeCard)) {
    return true;
  }
  return Boolean(tradeCardByNodeId.get(String(node.id || '').trim()));
}

function buildGraphBehaviors(
  callbacks: {
    onSelectionChange?: (states: GraphSelectionStates) => void;
    onOfficialStateChange?: () => void;
    isInteractionSuppressed?: () => boolean;
    canBrushSelect?: () => boolean;
    canDragElement?: () => boolean;
    onDragFinish?: () => void;
  } = {},
): Array<string | Record<string, unknown>> {
  return [
    {
      type: 'drag-canvas',
      enable: (event: any) => isMiddlePointer(event),
    },
    {
      type: 'brush-select',
      state: 'selected',
      enableElements: ['node'],
      trigger: ['drag'],
      animation: false,
      style: {
        lineWidth: 2,
        fill: '#3b82f6',
        stroke: '#2563eb',
        fillOpacity: 0.08,
        opacity: 1,
        radius: 0,
      },
      enable: (event: any) => callbacks.canBrushSelect?.() !== false
        && !callbacks.isInteractionSuppressed?.()
        && event?.targetType === 'canvas'
        && isLeftPointer(event),
      onSelect: callbacks.onSelectionChange,
    },
    {
      type: 'hover-activate',
      enable: (event: any) => !callbacks.isInteractionSuppressed?.() && event?.targetType === 'node',
      degree: 1,
      state: HOVER_HIGHLIGHT_STATE,
      inactiveState: HOVER_DIM_STATE,
      animation: false,
      onHover: (event: any) => {
        event?.view?.setCursor?.('pointer');
        callbacks.onOfficialStateChange?.();
      },
      onHoverEnd: (event: any) => {
        event?.view?.setCursor?.('default');
        callbacks.onOfficialStateChange?.();
      },
    },
    {
      type: 'click-select',
      enable: (event: any) => !callbacks.isInteractionSuppressed?.() && (
        event?.targetType == null || event?.targetType === 'canvas' || event?.targetType === 'node' || event?.targetType === 'edge'
      ),
      multiple: true,
      trigger: ['shift'],
      state: CLICK_HIGHLIGHT_STATE,
      neighborState: CLICK_HIGHLIGHT_STATE,
      unselectedState: CLICK_DIM_STATE,
      degree: ONE_HOP_NEIGHBORHOOD_DEGREE,
      animation: false,
      ...(callbacks.onOfficialStateChange ? { onClick: callbacks.onOfficialStateChange } : {}),
    },
    {
      type: 'drag-element',
      key: 'case-graph-drag-node',
      dropEffect: 'none',
      hideEdge: 'none',
      enable: (event: any) => callbacks.canDragElement?.() !== false
        && (event?.targetType == null || event?.targetType === 'node')
        && isLeftPointer(event),
      onFinish: callbacks.onDragFinish,
    },
    'zoom-canvas',
  ];
}

function buildCluePatternHullPlugins(): Array<Record<string, unknown>> {
  return Array.from({ length: MAX_CLUE_PATTERN_HULLS }, (_, index) => {
    const style = CLUE_PATTERN_HULL_STYLES[index % CLUE_PATTERN_HULL_STYLES.length];
    return {
      type: 'hull',
      key: `case-graph-clue-hull-${index}`,
      members: [],
      padding: 18,
      corner: 'rounded',
      concavity: Infinity,
      fill: style.fill,
      fillOpacity: 0.08,
      stroke: style.stroke,
      strokeOpacity: 0.42,
      lineWidth: 2,
      lineDash: [8, 6],
    };
  });
}

function applyCluePatternHulls(graph: G6Graph, matches: Array<CaseGraphCluePatternMatch | null>): void {
  for (let index = 0; index < MAX_CLUE_PATTERN_HULLS; index += 1) {
    const key = `case-graph-clue-hull-${index}`;
    const members = matches[index]?.nodeIds ?? [];
    const plugin = (graph as any).getPluginInstance?.(key);
    if (plugin?.updateMember) {
      try {
        plugin.updateMember(members);
        continue;
      } catch {
        // G6 hull may not have mounted yet during the first render cycle.
      }
    }
    graph.updatePlugin({ key, members } as any);
  }
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

function createEmptyGraphRenderSnapshot(): GraphRenderSnapshot {
  return {
    nodePositions: new Map(),
    edgeIds: new Set(),
  };
}

function createGraphRenderSnapshot(
  nodes: CaseGraphData['nodes'],
  edges: CaseGraphData['edges'],
  layout: Map<string, { x: number; y: number }>,
): GraphRenderSnapshot {
  const nodePositions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const point = layout.get(node.id) ?? { x: NODE_WIDTH / 2, y: NODE_HEIGHT / 2 };
    nodePositions.set(node.id, { x: point.x, y: point.y });
  }
  return {
    nodePositions,
    edgeIds: new Set(edges.map(resolveEdgeId)),
  };
}

function resolveGraphRenderTransition(
  previous: GraphRenderSnapshot,
  next: GraphRenderSnapshot,
): GraphRenderTransition {
  const newNodeIds = new Set<string>();
  const newEdgeIds = new Set<string>();
  const movedNodeIds = new Set<string>();
  let sharedNodeCount = 0;

  for (const [nodeId, nextPoint] of next.nodePositions.entries()) {
    const previousPoint = previous.nodePositions.get(nodeId);
    if (!previousPoint) {
      newNodeIds.add(nodeId);
      continue;
    }
    sharedNodeCount += 1;
    if (
      Math.abs(previousPoint.x - nextPoint.x) > GRAPH_POSITION_EPSILON ||
      Math.abs(previousPoint.y - nextPoint.y) > GRAPH_POSITION_EPSILON
    ) {
      movedNodeIds.add(nodeId);
    }
  }

  for (const edgeId of next.edgeIds) {
    if (!previous.edgeIds.has(edgeId)) {
      newEdgeIds.add(edgeId);
    }
  }

  const hadPreviousGraph = previous.nodePositions.size > 0 || previous.edgeIds.size > 0;
  const hasNextGraph = next.nodePositions.size > 0 || next.edgeIds.size > 0;
  const hasGraphContinuity = sharedNodeCount > 0;
  const hasMeaningfulChange = newNodeIds.size > 0 || newEdgeIds.size > 0 || movedNodeIds.size > 0;

  return {
    shouldAnimate: hadPreviousGraph && hasNextGraph && hasGraphContinuity && hasMeaningfulChange,
    shouldFitView: !hadPreviousGraph || !hasGraphContinuity,
    newNodeIds,
    newEdgeIds,
    movedNodeIds,
  };
}

function scheduleRevealStateClear(
  graph: G6Graph,
  elementIds: string[],
  renderCycle: number,
  renderCycleRef: MutableRefObject<number>,
  graphRef: MutableRefObject<G6Graph | null>,
  graphHostRef: MutableRefObject<HTMLDivElement | null>,
  timeoutRef: MutableRefObject<number | null>,
): void {
  const revealIds = elementIds.filter(Boolean);
  if (!revealIds.length) return;
  timeoutRef.current = window.setTimeout(() => {
    timeoutRef.current = null;
    if (renderCycleRef.current !== renderCycle || graphRef.current !== graph) return;
    const nextStates: Record<string, string[]> = {};
    for (const elementId of revealIds) {
      const currentStates = graph.getElementState(elementId);
      const filteredStates = currentStates.filter((state) => state !== REVEAL_STATE);
      if (filteredStates.length !== currentStates.length) {
        nextStates[elementId] = filteredStates;
      }
    }
    if (!Object.keys(nextStates).length) return;
    void graph.setElementState(nextStates, false)
      .then(() => {
        const graphHost = graphHostRef.current;
        if (graphHost && graphRef.current === graph) {
          syncG6HtmlNodeStateClasses(graph, graphHost);
        }
      })
      .catch(() => {});
  }, GRAPH_REVEAL_STATE_HOLD_MS);
}

async function applyRevealStates(
  graph: G6Graph,
  elementIds: string[],
  renderCycle: number,
  renderCycleRef: MutableRefObject<number>,
  graphRef: MutableRefObject<G6Graph | null>,
  graphHostRef: MutableRefObject<HTMLDivElement | null>,
): Promise<boolean> {
  const revealIds = elementIds.filter(Boolean);
  if (!revealIds.length) return true;
  if (renderCycleRef.current !== renderCycle || graphRef.current !== graph) {
    return false;
  }
  const nextStates: Record<string, string[]> = {};
  for (const elementId of revealIds) {
    const currentStates = graph.getElementState(elementId);
    if (!currentStates.includes(REVEAL_STATE)) {
      nextStates[elementId] = [...currentStates, REVEAL_STATE];
    }
  }
  if (Object.keys(nextStates).length) {
    await graph.setElementState(nextStates, false);
  }
  if (renderCycleRef.current !== renderCycle || graphRef.current !== graph) {
    await clearRevealStatesById(graph, revealIds);
    return false;
  }
  const graphHost = graphHostRef.current;
  if (graphHost) {
    syncG6HtmlNodeStateClasses(graph, graphHost);
  }
  return true;
}

async function clearRevealStatesById(graph: G6Graph, elementIds: string[]): Promise<void> {
  const nextStates: Record<string, string[]> = {};
  for (const elementId of elementIds) {
    const currentStates = graph.getElementState(elementId);
    const filteredStates = currentStates.filter((state) => state !== REVEAL_STATE);
    if (filteredStates.length !== currentStates.length) {
      nextStates[elementId] = filteredStates;
    }
  }
  if (Object.keys(nextStates).length) {
    await graph.setElementState(nextStates, false).catch(() => {});
  }
}

function syncG6HtmlNodeStateClasses(graph: G6Graph, root: HTMLElement): { hasHoverState: boolean; hasOfficialState: boolean } {
  let hasHoverState = false;
  let hasOfficialState = false;
  const nodeIds = new Set(
    graph.getNodeData()
      .map((node) => String(node.id || '').trim())
      .filter(Boolean),
  );
  const renderedNodes = root.querySelectorAll<HTMLElement>('.case-graph-g6-node[data-node-id]');
  renderedNodes.forEach((nodeElement) => {
    if (nodeElement.closest('.g6-minimap')) return;
    const nodeId = String(nodeElement.dataset.nodeId || '').trim();
    const states = nodeId && nodeIds.has(nodeId) ? graph.getElementState(nodeId) : [];
    const isHoverHighlighted = states.includes(HOVER_HIGHLIGHT_STATE);
    const isHoverDimmed = states.includes(HOVER_DIM_STATE);
    const isClickHighlighted = states.includes(CLICK_HIGHLIGHT_STATE);
    const isClickDimmed = states.includes(CLICK_DIM_STATE);
    const isRevealed = states.includes(REVEAL_STATE);
    const isHighlighted = isHoverHighlighted || isClickHighlighted;
    const isDimmed = isHoverDimmed || isClickDimmed;
    if (isHoverHighlighted || isHoverDimmed) {
      hasHoverState = true;
    }
    if (isHighlighted || isDimmed || isRevealed) {
      hasOfficialState = true;
    }
    nodeElement.classList.remove('is-hover-highlight', 'is-hover-dim');
    nodeElement.classList.toggle('is-g6-highlight', isHighlighted);
    nodeElement.classList.toggle('is-g6-dim', isDimmed && !isHighlighted);
    nodeElement.classList.toggle('is-g6-reveal', isRevealed);
    syncG6HtmlNodeWrapperStyle(nodeElement, {
      opacity: isDimmed && !isHighlighted && !isRevealed ? '0.24' : '1',
      zIndex: isRevealed ? '4' : isHighlighted ? '3' : '0',
    });
  });
  return { hasHoverState, hasOfficialState };
}

function clearG6HtmlNodeHoverStates(graph: G6Graph, root: HTMLElement | null): Promise<void> {
  return clearG6ElementStates(graph, root, GRAPH_HOVER_STATES);
}

function clearG6HtmlNodeInteractionStates(graph: G6Graph, root: HTMLElement | null): Promise<void> {
  return clearG6ElementStates(graph, root, GRAPH_INTERACTION_STATES);
}

function clearG6HtmlNodeTransientStates(graph: G6Graph, root: HTMLElement | null): Promise<void> {
  return clearG6ElementStates(graph, root, GRAPH_TRANSIENT_STATES);
}

function clearG6ElementStates(
  graph: G6Graph,
  root: HTMLElement | null,
  statesToClear: readonly string[],
): Promise<void> {
  const statesToClearSet = new Set(statesToClear);
  const nextStates: Record<string, string[]> = {};
  for (const datum of [...graph.getNodeData(), ...graph.getEdgeData()]) {
    const id = String(datum.id || '').trim();
    if (!id) continue;
    const currentStates = graph.getElementState(id);
    const filteredStates = filterG6ElementStates(currentStates, statesToClearSet);
    if (filteredStates.length !== currentStates.length) {
      nextStates[id] = filteredStates;
    }
  }
  if (Object.keys(nextStates).length) {
    return graph.setElementState(nextStates, false)
      .then(() => {
        if (root) {
          syncG6HtmlNodeStateClasses(graph, root);
        }
      })
      .catch(() => {});
  }
  if (root) {
    syncG6HtmlNodeStateClasses(graph, root);
  }
  return Promise.resolve();
}

function filterG6ElementStates(currentStates: string[], statesToClear: ReadonlySet<string>): string[] {
  return currentStates.filter((state) => !statesToClear.has(state));
}

function clearG6HtmlNodeInteractionClasses(root: HTMLElement | null): void {
  root
    ?.querySelectorAll<HTMLElement>('.case-graph-g6-node')
    .forEach((nodeElement) => {
      nodeElement.classList.remove('is-g6-highlight', 'is-g6-dim', 'is-hover-highlight', 'is-hover-dim');
      syncG6HtmlNodeWrapperStyle(nodeElement, { opacity: '1', zIndex: '0' });
    });
}

function clearG6HtmlNodeFocusClasses(root: HTMLElement | null): void {
  root
    ?.querySelectorAll<HTMLElement>('.case-graph-g6-node')
    .forEach((nodeElement) => {
      nodeElement.classList.remove('is-active', 'is-selected', 'is-dimmed');
    });
}

function clearG6HtmlNodeStateClasses(root: HTMLElement | null): void {
  root
    ?.querySelectorAll<HTMLElement>('.case-graph-g6-node')
    .forEach((nodeElement) => {
      nodeElement.classList.remove('is-g6-highlight', 'is-g6-dim', 'is-g6-reveal', 'is-hover-highlight', 'is-hover-dim');
      syncG6HtmlNodeWrapperStyle(nodeElement, { opacity: '1', zIndex: '0' });
    });
}

function syncG6HtmlNodeWrapperStyle(
  nodeElement: HTMLElement,
  style: { opacity: string; zIndex: string },
): void {
  const wrapper = nodeElement.parentElement;
  if (!wrapper) return;
  wrapper.style.opacity = style.opacity;
  wrapper.style.zIndex = style.zIndex;
}

function resolvePointerButton(event: any): number {
  return Number(event?.button ?? event?.nativeEvent?.button ?? event?.originalEvent?.button ?? 0);
}

function resolvePointerButtons(event: any): number {
  return Number(event?.buttons ?? event?.nativeEvent?.buttons ?? event?.originalEvent?.buttons ?? 0);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function findGraphNodeElement(graphHost: HTMLElement, nodeId: string): HTMLElement | null {
  let bestElement: HTMLElement | null = null;
  let bestArea = 0;
  for (const element of graphHost.querySelectorAll<HTMLElement>('.case-graph-g6-node')) {
    if (element.dataset.nodeId !== nodeId) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (!bestElement || area > bestArea) {
      bestElement = element;
      bestArea = area;
    }
  }
  return bestElement;
}

function isLeftPointer(event: any): boolean {
  const button = resolvePointerButton(event);
  const buttons = resolvePointerButtons(event);
  return button === 0 && (buttons === 0 || (buttons & 1) === 1);
}

function isMiddlePointer(event: any): boolean {
  const button = resolvePointerButton(event);
  const buttons = resolvePointerButtons(event);
  return button === 1 || (buttons & 4) === 4;
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

function renderNodeMarkup(data: {
  nodeId: string;
  title: string;
  subtitle: string;
  isSeed: boolean;
  isFocus: boolean;
  isActive: boolean;
  isRelationHighlighted: boolean;
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
    <div class="case-graph-g6-node role-${escapeClassName(data.role)}${data.isSeed ? ' is-seed' : ''}${data.isFocus ? ' is-focus' : ''}${data.isActive ? ' is-active' : ''}${data.isRelationHighlighted ? ' is-relation-highlight' : ''}${data.isSelected ? ' is-selected' : ''}${data.isDimmed ? ' is-dimmed' : ''}${data.isExcluded ? ' is-excluded' : ''}" data-node-id="${escapeHtml(data.nodeId)}">
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
    edgeKind?: string;
    strength?: 'weak' | 'medium' | 'strong';
    isActive?: boolean;
    isDimmed?: boolean;
    isExcluded?: boolean;
  },
): { stroke: string; lineWidth: number; opacity: number } {
  if (data?.edgeKind === 'reality') {
    return {
      stroke: data.isActive ? '#b7791f' : '#d09a2d',
      lineWidth: data.isActive ? 2.4 : 1.8,
      opacity: data.isDimmed ? 0.24 : 0.86,
    };
  }
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
    edgeKind?: string;
    label?: string;
    relationType?: string;
    tradeCount?: number;
    tradeAmount?: number;
    showLabel?: boolean;
  } | undefined,
): string {
  if (data?.edgeKind === 'reality') {
    return data.showLabel ? String(data.label || data.relationType || '现实关系') : '';
  }
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
