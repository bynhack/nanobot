import { ChevronLeft, ChevronRight, Download, FileSearch, History, Layers, LocateFixed, MousePointer2, Network, Route, SearchCheck, Settings2, UserPlus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
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
  onDrillDown: (direction: 'in' | 'out' | 'both', node: CaseGraphNode, tradeCard: CaseGraphTradeCard | null) => void;
  onOpenNodeSummaryAnalysis: (node: CaseGraphNode) => void;
  onOpenGlobalSummaryAnalysis: () => void;
  onOpenManualNode: (position?: { x: number; y: number } | null) => void;
  onOpenManualTrade: (node?: CaseGraphNode | null) => void;
  onOpenRealityRelation: (node?: CaseGraphNode | null) => void;
  onExcludeNode: (node: CaseGraphExcludedNode) => void;
  onExcludeNodes: (nodes: CaseGraphExcludedNode[]) => void;
  onRestoreNode: (nodeId: string) => void;
  onCreateInvestigationGroup: (nodes: CaseGraphNode[]) => void;
  onToggleInvestigationGroup: (groupId: string, collapsed: boolean) => void;
  onUpdateInvestigationGroup: (groupId: string, input: { name: string; groupType?: string; note?: string }) => void;
  onUngroupInvestigationGroup: (groupId: string) => void;
  onRemoveInvestigationGroupMember: (groupId: string, nodeId: string) => void;
  onRemoveInvestigationGroupMembers: (groupId: string, nodeIds: string[]) => void;
  onAddInvestigationGroupMembers: (groupId: string, nodeIds: string[]) => void;
  groupOperationLoading?: boolean;
  onOpenEdgeDetail: (edgeId: string, edgeFocus?: CaseGraphConversationFocus, edgeOverride?: CaseGraphData['edges'][number]) => void;
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
    | 'summary-analysis'
    | 'manual-trade'
    | 'reality-relation'
    | 'create-group'
    | 'add-to-group'
    | 'remove-from-group'
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

interface ExportBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

interface ExportNodeCard {
  id: string;
  x: number;
  y: number;
  data: GraphNodeRenderData;
}

interface GraphNodeRenderData {
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
}

interface InvestigationGroupDetailForm {
  name: string;
  groupType: string;
  note: string;
}

interface InvestigationGroupSummary {
  groupId: string;
  memberCount: number;
  incomingAmount: number;
  outgoingAmount: number;
  incomingCount: number;
  outgoingCount: number;
  internalAmount: number;
  internalCount: number;
  externalEdgeCount: number;
  counterpartCount: number;
  counterpartRows: InvestigationGroupCounterpartRow[];
}

interface InvestigationGroupCounterpartRow {
  nodeId: string;
  name: string;
  direction: 'in' | 'out' | 'both';
  amount: number;
  count: number;
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
const ADD_TO_GROUP_POPOVER_WIDTH = 360;
const NODE_RIGHT_CLICK_CONTEXT_MENU_ENABLED = false;
const EXPORT_PNG_PADDING = 40;
const EXPORT_PNG_BACKGROUND = '#ffffff';
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
const EXPORT_NODE_ROLE_PALETTE: Record<string, { color: string; border: string; fill: string }> = {
  core: { color: '#315fd1', border: '#8fb0ff', fill: '#eef4ff' },
  bridge: { color: '#147867', border: '#79c6b7', fill: '#edf8f6' },
  upstream: { color: '#476aa9', border: '#90abd8', fill: '#f0f5ff' },
  downstream: { color: '#a4662b', border: '#d7b086', fill: '#fff5ea' },
  transit: { color: '#64748b', border: '#b8c3d3', fill: '#f4f6f9' },
  peripheral: { color: '#7b8798', border: '#d5deec', fill: '#ffffff' },
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
  onOpenEdgeDetail,
  onOpenNodeSummaryAnalysis,
  onOpenGlobalSummaryAnalysis,
  onOpenManualNode,
  onOpenManualTrade,
  onOpenRealityRelation,
  onDrillDown,
  onExcludeNode,
  onExcludeNodes,
  onRestoreNode,
  onCreateInvestigationGroup,
  onToggleInvestigationGroup,
  onUpdateInvestigationGroup,
  onUngroupInvestigationGroup,
  onRemoveInvestigationGroupMember,
  onRemoveInvestigationGroupMembers,
  onAddInvestigationGroupMembers,
  groupOperationLoading = false,
  onFocusChange,
  onNodePositionsChange,
}: GraphCanvasProps) {
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [activeEdgeId, setActiveEdgeId] = useState<string | null>(null);
  const [activeRoleFilter, setActiveRoleFilter] = useState<Exclude<CaseGraphNodeRole, 'peripheral'> | null>(null);
  const [canvasContextMenu, setCanvasContextMenu] = useState<CanvasContextMenuState | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectionToolbarPosition, setSelectionToolbarPosition] = useState<SelectionToolbarPosition | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [groupDetailForm, setGroupDetailForm] = useState<InvestigationGroupDetailForm>({ name: '', groupType: '', note: '' });
  const [groupSelectedMemberIds, setGroupSelectedMemberIds] = useState<string[]>([]);
  const [addToGroupOpen, setAddToGroupOpen] = useState(false);
  const [addToGroupPopoverPosition, setAddToGroupPopoverPosition] = useState<SelectionToolbarPosition | null>(null);
  const [cluePatternsVisible, setCluePatternsVisible] = useState(false);
  const [selectedCluePatternId, setSelectedCluePatternId] = useState<string | null>(null);
  const [exportingPng, setExportingPng] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [graphReadyNonce, setGraphReadyNonce] = useState(0);
  const [graphViewport, setGraphViewport] = useState({ width: GRAPH_WIDTH, height: GRAPH_HEIGHT });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const selectionToolbarRef = useRef<HTMLDivElement | null>(null);
  const addToGroupButtonRef = useRef<HTMLButtonElement | null>(null);
  const addToGroupPopoverRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<G6Graph | null>(null);
  const graphHostRef = useRef<HTMLDivElement | null>(null);
  const renderCycleRef = useRef(0);
  const graphRenderedRef = useRef(false);
  const graphRenderSnapshotRef = useRef<GraphRenderSnapshot>(createEmptyGraphRenderSnapshot());
  const groupMemberSnapshotRef = useRef<Map<string, string>>(new Map());
  const revealClearTimeoutRef = useRef<number | null>(null);
  const officialInteractionSuppressedRef = useRef(false);
  const onOpenEdgeDetailRef = useRef(onOpenEdgeDetail);
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
  const onCreateInvestigationGroupRef = useRef(onCreateInvestigationGroup);
  const onToggleInvestigationGroupRef = useRef(onToggleInvestigationGroup);
  const onUpdateInvestigationGroupRef = useRef(onUpdateInvestigationGroup);
  const onUngroupInvestigationGroupRef = useRef(onUngroupInvestigationGroup);
  const onRemoveInvestigationGroupMemberRef = useRef(onRemoveInvestigationGroupMember);
  const onRemoveInvestigationGroupMembersRef = useRef(onRemoveInvestigationGroupMembers);
  const onAddInvestigationGroupMembersRef = useRef(onAddInvestigationGroupMembers);
  const groupOperationLoadingRef = useRef(groupOperationLoading);
  const activeEdgeIdRef = useRef<string | null>(null);
  const activeNeighborhoodRef = useRef<GraphActiveNeighborhood | null>(null);
  const graphFocusDrawCycleRef = useRef(0);
  const cluePatternFocusCycleRef = useRef(0);

  const nodes = graphData?.nodes ?? [];
  const edges = graphData?.edges ?? [];
  const nodeLookup = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const investigationGroups = useMemo(() => graphData?.investigationGroups ?? [], [graphData?.investigationGroups]);
  const investigationGroupLookup = useMemo(
    () => new Map(investigationGroups.map((group) => [group.id, group])),
    [investigationGroups],
  );
  const investigationGroupByNodeId = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of investigationGroups) {
      for (const nodeId of group.memberNodeIds ?? []) {
        if (nodeLookup.has(nodeId) && !map.has(nodeId)) {
          map.set(nodeId, group.id);
        }
      }
    }
    return map;
  }, [investigationGroups, nodeLookup]);
  const renderMoneyEdges = useMemo(
    () => buildCollapsedInvestigationGroupRenderEdges(edges, investigationGroups, nodeLookup),
    [edges, investigationGroups, nodeLookup],
  );
  const investigationGroupSummaries = useMemo(
    () => buildInvestigationGroupSummaries(investigationGroups, nodes, edges),
    [edges, investigationGroups, nodes],
  );
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
  const renderEdges = useMemo(() => [...renderMoneyEdges, ...realityEdges], [realityEdges, renderMoneyEdges]);
  const edgeLookup = useMemo(() => new Map(renderEdges.map((edge) => [resolveEdgeId(edge), edge])), [renderEdges]);
  const renderNodeLookup = useMemo(
    () => buildRenderNodeLookup(nodeLookup, investigationGroups),
    [investigationGroups, nodeLookup],
  );
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
      return buildRoleNeighborhood(activeRoleFilter, nodes, renderEdges, graphView.nodeMetricsById);
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
  }, [activeEdgeId, activeNodeId, activeRoleFilter, cluePatternsVisible, edgeLookup, graphView.nodeMetricsById, nodes, renderEdges, selectedCluePattern]);

  const selectedNode = activeNodeId ? nodeLookup.get(activeNodeId) ?? null : null;
  const selectedEdge = activeEdgeId ? edgeLookup.get(activeEdgeId) ?? null : null;
  const selectedNodeMetrics = activeNodeId ? graphView.nodeMetricsById.get(activeNodeId) ?? null : null;
  const activeRoleCount = activeRoleFilter ? graphView.roleCounts[activeRoleFilter] : 0;
  const selectedNodes = useMemo(
    () => selectedNodeIds.map((nodeId) => nodeLookup.get(nodeId)).filter((node): node is CaseGraphData['nodes'][number] => Boolean(node)),
    [nodeLookup, selectedNodeIds],
  );
  const activeGroup = activeGroupId ? investigationGroupLookup.get(activeGroupId) ?? null : null;
  const activeGroupSummary = activeGroupId ? investigationGroupSummaries.get(activeGroupId) ?? null : null;
  const activeGroupMemberNodes = useMemo(
    () => activeGroup
      ? (activeGroup.memberNodeIds ?? []).map((nodeId) => nodeLookup.get(nodeId)).filter((node): node is CaseGraphData['nodes'][number] => Boolean(node))
      : [],
    [activeGroup, nodeLookup],
  );
  const primarySelectedNode = selectedNodes[0] ?? selectedNode ?? null;
  const singleSelectedNode = selectedNodeIds.length === 1 ? selectedNodes[0] ?? null : null;
  const selectedGroupForSingleNode = singleSelectedNode ? investigationGroupByNodeId.get(singleSelectedNode.id) ?? null : null;
  const replayTimelineView = useMemo(
    () => buildReplayTimelineView(replayTimeline),
    [replayTimeline],
  );

  useEffect(() => {
    onOpenEdgeDetailRef.current = onOpenEdgeDetail;
  }, [onOpenEdgeDetail]);

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
    nodeLookupRef.current = renderNodeLookup;
    edgeLookupRef.current = edgeLookup;
    tradeCardByNodeIdRef.current = tradeCardByNodeId;
    drilldownLoadingRef.current = drilldownLoading;
    excludingRef.current = excluding;
    onDrillDownRef.current = onDrillDown;
    onExcludeNodeRef.current = onExcludeNode;
    onExcludeNodesRef.current = onExcludeNodes;
    onRestoreNodeRef.current = onRestoreNode;
    onCreateInvestigationGroupRef.current = onCreateInvestigationGroup;
    onToggleInvestigationGroupRef.current = onToggleInvestigationGroup;
    onUpdateInvestigationGroupRef.current = onUpdateInvestigationGroup;
    onUngroupInvestigationGroupRef.current = onUngroupInvestigationGroup;
    onRemoveInvestigationGroupMemberRef.current = onRemoveInvestigationGroupMember;
    onRemoveInvestigationGroupMembersRef.current = onRemoveInvestigationGroupMembers;
    onAddInvestigationGroupMembersRef.current = onAddInvestigationGroupMembers;
    groupOperationLoadingRef.current = groupOperationLoading;
  }, [
    drilldownLoading,
    edgeLookup,
    excluding,
    groupOperationLoading,
    onCreateInvestigationGroup,
    onDrillDown,
    onExcludeNode,
    onExcludeNodes,
    onRemoveInvestigationGroupMember,
    onRemoveInvestigationGroupMembers,
    onAddInvestigationGroupMembers,
    onRestoreNode,
    onToggleInvestigationGroup,
    onUpdateInvestigationGroup,
    onUngroupInvestigationGroup,
    renderNodeLookup,
    tradeCardByNodeId,
  ]);

  useEffect(() => {
    if (!activeGroup) {
      setGroupDetailForm({ name: '', groupType: '', note: '' });
      setGroupSelectedMemberIds([]);
      return;
    }
    setGroupDetailForm({
      name: activeGroup.name || '研判组',
      groupType: activeGroup.groupType || '',
      note: activeGroup.note || '',
    });
    setGroupSelectedMemberIds((current) => current.filter((nodeId) => (activeGroup.memberNodeIds ?? []).includes(nodeId)));
  }, [activeGroup?.id, activeGroup?.name, activeGroup?.groupType, activeGroup?.note]);

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

  useEffect(() => {
    if (!addToGroupOpen) {
      setAddToGroupPopoverPosition(null);
      return;
    }
    const frame = window.requestAnimationFrame(updateAddToGroupPopoverPosition);
    return () => window.cancelAnimationFrame(frame);
  }, [addToGroupOpen, selectionToolbarPosition, graphViewport.height, graphViewport.width]);

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
    setActiveGroupId(null);
    setGroupSelectedMemberIds([]);
    setAddToGroupOpen(false);
    setAddToGroupPopoverPosition(null);
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
      if (addToGroupOpen) {
        updateAddToGroupPopoverPosition();
      }
    });
  };

  const updateAddToGroupPopoverPosition = () => {
    const stage = stageRef.current;
    const button = addToGroupButtonRef.current;
    if (!stage || !button) {
      setAddToGroupPopoverPosition(null);
      return;
    }
    const stageBounds = stage.getBoundingClientRect();
    const buttonBounds = button.getBoundingClientRect();
    const popoverWidth = addToGroupPopoverRef.current?.offsetWidth || ADD_TO_GROUP_POPOVER_WIDTH;
    const margin = 12;
    const left = clampNumber(
      buttonBounds.right - stageBounds.left - popoverWidth,
      margin,
      Math.max(margin, stageBounds.width - popoverWidth - margin),
    );
    const top = clampNumber(
      buttonBounds.bottom - stageBounds.top + 10,
      margin,
      Math.max(margin, stageBounds.height - margin),
    );
    setAddToGroupPopoverPosition({ x: left, y: top });
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
        data: { nodes: [], edges: [], combos: [] },
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
        combo: {
          type: 'rect',
          style: {
            padding: [18, 22, 24, 22],
            radius: 12,
            fill: '#eff6ff',
            fillOpacity: 0.5,
            stroke: '#6b95f8',
            lineWidth: 1.2,
            lineDash: [7, 6],
            collapsedSize: [220, 84],
            collapsedRadius: 16,
            collapsedFill: '#f8fbff',
            collapsedFillOpacity: 0.98,
            collapsedStroke: '#6f8ee8',
            collapsedLineWidth: 1.6,
            collapsedLineDash: 0,
            collapsedShadowColor: 'rgba(31, 59, 104, 0.18)',
            collapsedShadowBlur: 14,
            collapsedShadowOffsetY: 6,
            collapsedMarker: false,
            labelText: (datum: any) => {
              const data = datum?.data ?? {};
              const name = String(data.name || '研判组').trim();
              const count = Number(data.memberCount || 0);
              const isCollapsed = Boolean(data.collapsed ?? datum?.style?.collapsed);
              if (!isCollapsed) {
                return `${name} · ${count} 个主体`;
              }
              const incomingAmount = Number(data.incomingAmount || 0);
              const outgoingAmount = Number(data.outgoingAmount || 0);
              return `${name} · ${count} 个主体\n入 ${formatCompactAmount(incomingAmount)} / 出 ${formatCompactAmount(outgoingAmount)}`;
            },
            labelFill: '#1f3b68',
            labelFontSize: (datum: any) => {
              const data = datum?.data ?? {};
              return Boolean(data.collapsed ?? datum?.style?.collapsed) ? 15 : 13;
            },
            labelFontWeight: 700,
            labelLineHeight: 22,
            labelPlacement: (datum: any) => {
              const data = datum?.data ?? {};
              return Boolean(data.collapsed ?? datum?.style?.collapsed) ? 'center' : 'top';
            },
            labelOffsetY: (datum: any) => {
              const data = datum?.data ?? {};
              return Boolean(data.collapsed ?? datum?.style?.collapsed) ? 0 : -8;
            },
            labelWordWrap: true,
            labelMaxWidth: (datum: any) => {
              const data = datum?.data ?? {};
              return Boolean(data.collapsed ?? datum?.style?.collapsed) ? '94%' : '200%';
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
            enable: (event: any) => NODE_RIGHT_CLICK_CONTEXT_MENU_ENABLED && !replayModeRef.current && event?.targetType === 'node',
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
        setActiveGroupId(null);
        if (nodeId) {
          const native = event?.nativeEvent ?? event?.originalEvent ?? event;
          setActiveEdgeId(null);
          setActiveNodeId(nodeId);
          setSelectedNodeIds((current) => resolveNextSelectedNodeIds(current, nodeId, native));
        }
      });

      graph.on('combo:click' as any, (event: any) => {
        const groupId = resolveEventId(event);
        closeCluePatternPanel();
        setCanvasContextMenu(null);
        setActiveRoleFilter(null);
        setActiveNodeId(null);
        setActiveEdgeId(null);
        setSelectedNodeIds([]);
        if (groupId) {
          suppressNextCanvasClickRef.current = true;
          setActiveGroupId(groupId);
        }
      });

      graph.on(EdgeEvent.CLICK, (event: any) => {
        const edgeId = resolveEventId(event);
        closeCluePatternPanel();
        setCanvasContextMenu(null);
        setActiveRoleFilter(null);
        setActiveGroupId(null);
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
          onOpenEdgeDetailRef.current(edgeId, edgeFocus ?? undefined, edge);
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
        const groupId = investigationGroupByNodeId.get(node.id);
        return {
          id: node.id,
          ...(groupId ? { combo: groupId } : {}),
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
      combos: investigationGroups.map((group) => {
        const memberNodeIds = (group.memberNodeIds ?? []).filter((nodeId) => nodeLookup.has(nodeId));
        const summary = investigationGroupSummaries.get(group.id);
        return {
          id: group.id,
          style: {
            collapsed: Boolean(group.collapsed),
          },
          data: {
            ...group,
            memberNodeIds,
            memberCount: memberNodeIds.length,
            incomingAmount: summary?.incomingAmount ?? 0,
            outgoingAmount: summary?.outgoingAmount ?? 0,
            incomingCount: summary?.incomingCount ?? 0,
            outgoingCount: summary?.outgoingCount ?? 0,
            externalEdgeCount: summary?.externalEdgeCount ?? 0,
          },
        };
      }).filter((group) => group.data.memberCount >= 2),
    };
    const nextGroupMemberSnapshot = createInvestigationGroupMemberSnapshot(graphPayload.combos);
    const groupsWithMemberChanges = resolveInvestigationGroupMemberChanges(
      groupMemberSnapshotRef.current,
      nextGroupMemberSnapshot,
    );

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
      await expandRenderedInvestigationGroups(graph, groupsWithMemberChanges);
      graph.setData(graphPayload);
      await graph.render();
      await syncInvestigationGroupCollapseState(graph, investigationGroups);
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
        groupMemberSnapshotRef.current = nextGroupMemberSnapshot;
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
  }, [graphLayout, graphReadyNonce, graphView, investigationGroupByNodeId, investigationGroupSummaries, investigationGroups, nodeLookup, nodes, parallelOffsets, renderEdges, tradeCardByNodeId]);

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
    if (activeGroupId && !investigationGroupLookup.has(activeGroupId)) {
      setActiveGroupId(null);
    }
  }, [activeEdgeId, activeGroupId, activeNodeId, edgeLookup, investigationGroupLookup, nodeLookup]);

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

  const singleSelectedTradeCard = singleSelectedNode ? resolveTradeCard(singleSelectedNode, tradeCardByNodeId) : null;
  const canRunSingleDrill = Boolean(singleSelectedNode && singleSelectedTradeCard && !singleSelectedNode.isExcluded && !drilldownLoading);
  const canRunSingleSummaryAnalysis = Boolean(singleSelectedNode && !singleSelectedNode.isExcluded && hasNodeAccountEvidence(singleSelectedNode, tradeCardByNodeId));
  const selectedRestorableNode = singleSelectedNode?.isExcluded ? singleSelectedNode : null;
  const selectedNodesToExclude = selectedNodes.filter((node) => !node.isExcluded);
  const selectedNodesToGroup = selectedNodes.filter((node) => !node.isExcluded);
  const selectedNodesToAddToGroup = selectedNodes.filter((node) => !node.isExcluded);
  const addableInvestigationGroups = useMemo(
    () => investigationGroups
      .map((group) => ({
        group,
        newMemberCount: selectedNodesToAddToGroup.filter((node) => !(group.memberNodeIds ?? []).includes(node.id)).length,
      }))
      .filter((item) => item.newMemberCount > 0),
    [investigationGroups, selectedNodesToAddToGroup],
  );
  const showSelectionToolbar = Boolean(nodes.length && selectedNodeIds.length && !replayMode);

  const handleExportPng = async () => {
    const graph = graphRef.current;
    if (!graph || !nodes.length || exportingPng) {
      return;
    }
    setExportError(null);
    setExportingPng(true);
    try {
      closeCluePatternPanel();
      setCanvasContextMenu(null);
      const dataUrl = await graph.toDataURL({ mode: 'overall', type: 'image/png' });
      const exportDataUrl = await mergeGraphPngWithHtmlNodes(graph, dataUrl);
      downloadDataUrl(exportDataUrl, buildGraphPngFilename());
    } catch (error) {
      console.error('导出关系图失败', error);
      setExportError('导出 PNG 失败，请稍后重试');
    } finally {
      setExportingPng(false);
    }
  };

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

    if (value === 'create-group') {
      const groupNodes = selectedNodesRefCurrent(nodeLookupRef.current, selectedNodeIdsRef.current)
        .filter((item) => !item.isExcluded);
      if (groupNodes.length < 2 || groupOperationLoadingRef.current) return;
      onCreateInvestigationGroupRef.current(groupNodes);
      return;
    }

    if (value === 'add-to-group') {
      if (groupOperationLoadingRef.current) return;
      setAddToGroupOpen((current) => !current);
      return;
    }

    if (value === 'remove-from-group') {
      if (!singleSelectedNode || !selectedGroupForSingleNode || groupOperationLoadingRef.current) return;
      onRemoveInvestigationGroupMemberRef.current(selectedGroupForSingleNode, singleSelectedNode.id);
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

  const groupDetailDirty = Boolean(activeGroup && (
    groupDetailForm.name.trim() !== (activeGroup.name || '').trim()
    || groupDetailForm.groupType.trim() !== (activeGroup.groupType || '').trim()
    || groupDetailForm.note.trim() !== (activeGroup.note || '').trim()
  ));
  const removableSelectedGroupMemberIds = groupSelectedMemberIds.filter((nodeId) =>
    activeGroupMemberNodes.some((node) => node.id === nodeId),
  );
  const canRemoveSelectedGroupMembers = Boolean(
    activeGroup
    && removableSelectedGroupMemberIds.length
    && activeGroupMemberNodes.length - removableSelectedGroupMemberIds.length >= 2
    && !groupOperationLoading,
  );

  const handleSaveActiveGroupDetail = () => {
    if (!activeGroup || groupOperationLoading || !groupDetailDirty) return;
    const name = groupDetailForm.name.trim() || activeGroup.name || '研判组';
    onUpdateInvestigationGroupRef.current(activeGroup.id, {
      name,
      groupType: groupDetailForm.groupType.trim(),
      note: groupDetailForm.note.trim(),
    });
  };

  const handleRemoveSelectedGroupMembers = () => {
    if (!activeGroup || !canRemoveSelectedGroupMembers) return;
    onRemoveInvestigationGroupMembersRef.current(activeGroup.id, removableSelectedGroupMemberIds);
    setGroupSelectedMemberIds([]);
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
              disabled={!nodes.length || loading || exportingPng}
              title="导出完整关系图为 PNG"
              onClick={() => {
                void handleExportPng();
              }}
            >
              <Download size={14} />
              <span>{exportingPng ? '导出中' : '导出 PNG'}</span>
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
            {exportError ? (
              <div className="case-graph-export-error" role="alert">
                {exportError}
              </div>
            ) : null}
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

        {activeGroup && typeof document !== 'undefined' ? createPortal(
          <div
            className="case-graph-modal-mask case-graph-modal-mask--detail"
            role="presentation"
            onClick={() => setActiveGroupId(null)}
          >
            <section
              className="case-graph-group-detail-popover"
              role="dialog"
              aria-modal="true"
              aria-label="研判组详情"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="case-graph-group-detail-header">
              <div className="case-graph-group-detail-title">
                <Layers size={16} />
                <div>
                  <strong>{activeGroup.name || '研判组'}</strong>
                  <span>{activeGroup.groupType || '未标注类型'} · {activeGroupSummary?.memberCount ?? activeGroupMemberNodes.length} 个主体</span>
                </div>
              </div>
              <button
                type="button"
                className="case-graph-mini-button case-graph-mini-button--icon"
                title="关闭"
                aria-label="关闭研判组详情"
                onClick={() => setActiveGroupId(null)}
              >
                <X size={14} />
              </button>
              </header>

              <div className="case-graph-group-detail-body">
                <div className="case-graph-group-detail-stats">
                  <div>
                    <span>流入</span>
                    <strong>{formatCompactAmount(activeGroupSummary?.incomingAmount ?? 0)}元</strong>
                    <em>{activeGroupSummary?.incomingCount ?? 0} 笔</em>
                  </div>
                  <div>
                    <span>流出</span>
                    <strong>{formatCompactAmount(activeGroupSummary?.outgoingAmount ?? 0)}元</strong>
                    <em>{activeGroupSummary?.outgoingCount ?? 0} 笔</em>
                  </div>
                  <div>
                    <span>对外线</span>
                    <strong>{activeGroupSummary?.externalEdgeCount ?? 0} 条</strong>
                    <em>{activeGroupSummary?.counterpartCount ?? 0} 个对手方</em>
                  </div>
                </div>

                <div className="case-graph-group-detail-fields">
                  <label>
                    <span>组名</span>
                    <input
                      value={groupDetailForm.name}
                      disabled={groupOperationLoading}
                      onChange={(event) => setGroupDetailForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="研判组名称"
                    />
                  </label>
                  <label>
                    <span>类型</span>
                    <select
                      value={groupDetailForm.groupType}
                      disabled={groupOperationLoading}
                      onChange={(event) => setGroupDetailForm((current) => ({ ...current, groupType: event.target.value }))}
                    >
                      <option value="">未标注类型</option>
                      <option value="团伙成员">团伙成员</option>
                      <option value="关联账号">关联账号</option>
                      <option value="控制关系">控制关系</option>
                      <option value="资金中转">资金中转</option>
                      <option value="其他">其他</option>
                    </select>
                  </label>
                  <label className="case-graph-group-detail-note">
                    <span>研判说明</span>
                    <textarea
                      value={groupDetailForm.note}
                      disabled={groupOperationLoading}
                      onChange={(event) => setGroupDetailForm((current) => ({ ...current, note: event.target.value }))}
                      placeholder="记录成组依据，例如共同控制、同案成员、资金中转等。"
                    />
                  </label>
                </div>

                <div className="case-graph-group-detail-section">
                  <div className="case-graph-group-detail-section-title">
                    <strong>组内主体</strong>
                    <button
                      type="button"
                      className="case-graph-row-link-button"
                      disabled={!canRemoveSelectedGroupMembers}
                      onClick={handleRemoveSelectedGroupMembers}
                    >
                      移出所选
                    </button>
                  </div>
                  <div className="case-graph-group-member-list">
                    {activeGroupMemberNodes.map((node) => (
                      <div className="case-graph-group-member-row" key={node.id}>
                        <input
                          type="checkbox"
                          aria-label={`选择${nodeDisplayName(node)}`}
                          checked={groupSelectedMemberIds.includes(node.id)}
                          disabled={groupOperationLoading}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setGroupSelectedMemberIds((current) => checked
                              ? [...new Set([...current, node.id])]
                              : current.filter((nodeId) => nodeId !== node.id));
                          }}
                        />
                        <span>{nodeDisplayName(node)}</span>
                        <small>{node.tradeCard || node.accountId || node.type || '图上主体'}</small>
                        <button
                          type="button"
                          className="case-graph-row-link-button"
                          disabled={groupOperationLoading || activeGroupMemberNodes.length <= 2}
                          onClick={() => onRemoveInvestigationGroupMemberRef.current(activeGroup.id, node.id)}
                        >
                          移出
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="case-graph-group-detail-section">
                  <div className="case-graph-group-detail-section-title">
                    <strong>关键对手方</strong>
                    <span>{activeGroupSummary?.counterpartRows.length ?? 0} 个</span>
                  </div>
                  <div className="case-graph-group-counterpart-list">
                    {(activeGroupSummary?.counterpartRows ?? []).slice(0, 4).map((row) => (
                      <div className="case-graph-group-counterpart-row" key={row.nodeId}>
                        <span>{row.name}</span>
                        <small>{resolveGroupCounterpartDirectionLabel(row.direction)} · {row.count} 笔 · {formatCompactAmount(row.amount)}元</small>
                      </div>
                    ))}
                    {!activeGroupSummary?.counterpartRows.length ? (
                      <span className="case-graph-group-detail-empty">暂无对外资金线</span>
                    ) : null}
                  </div>
                </div>
              </div>

            <footer className="case-graph-group-detail-actions">
              <button
                type="button"
                className="case-graph-secondary-button"
                disabled={groupOperationLoading || !groupDetailDirty}
                onClick={handleSaveActiveGroupDetail}
              >
                保存信息
              </button>
              <button
                type="button"
                className="case-graph-secondary-button"
                disabled={groupOperationLoading}
                onClick={() => {
                  const nextCollapsed = !activeGroup.collapsed;
                  setActiveGroupId(null);
                  onToggleInvestigationGroupRef.current(activeGroup.id, nextCollapsed);
                }}
              >
                {activeGroup.collapsed ? '展开' : '收起'}
              </button>
              <button
                type="button"
                className="case-graph-secondary-button case-graph-secondary-button--danger"
                disabled={groupOperationLoading}
                onClick={() => {
                  setActiveGroupId(null);
                  onUngroupInvestigationGroupRef.current(activeGroup.id);
                }}
              >
                拆分
              </button>
            </footer>
            </section>
          </div>,
          document.body,
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
                {canRunSingleSummaryAnalysis ? (
                  <button
                    type="button"
                    className="case-graph-selection-toolbar-action"
                    onClick={() => runSelectionNodeAction('summary-analysis')}
                  >
                    综合筛选
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
                {selectedGroupForSingleNode ? (
                  <button
                    type="button"
                    className="case-graph-selection-toolbar-action"
                    disabled={groupOperationLoading}
                    onClick={() => runSelectionNodeAction('remove-from-group')}
                  >
                    移出研判组
                  </button>
                ) : null}
              </>
            ) : null}
            {selectedNodesToAddToGroup.length && addableInvestigationGroups.length ? (
              <button
                type="button"
                ref={addToGroupButtonRef}
                className="case-graph-selection-toolbar-action"
                disabled={groupOperationLoading}
                onClick={() => runSelectionNodeAction('add-to-group')}
              >
                添加到组
              </button>
            ) : null}
            {selectedNodesToGroup.length > 1 ? (
              <button
                type="button"
                className="case-graph-selection-toolbar-action"
                disabled={groupOperationLoading}
                onClick={() => runSelectionNodeAction('create-group')}
              >
                归并成组
              </button>
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

        {showSelectionToolbar && addToGroupOpen && addToGroupPopoverPosition && addableInvestigationGroups.length ? (
          <div
            className="case-graph-add-to-group-popover"
            ref={addToGroupPopoverRef}
            style={{
              left: addToGroupPopoverPosition.x,
              top: addToGroupPopoverPosition.y,
            }}
          >
            <div className="case-graph-add-to-group-title">
              <strong>添加到组</strong>
              <span>已选择 {selectedNodesToAddToGroup.length} 个主体</span>
            </div>
            <div className="case-graph-add-to-group-list">
              {addableInvestigationGroups.map(({ group, newMemberCount }) => (
                <button
                  type="button"
                  key={group.id}
                  disabled={groupOperationLoading || newMemberCount <= 0}
                  onClick={() => {
                    const nodeIds = selectedNodesToAddToGroup
                      .map((node) => node.id)
                      .filter((nodeId) => !(group.memberNodeIds ?? []).includes(nodeId));
                    if (!nodeIds.length) return;
                    setAddToGroupOpen(false);
                    clearFocusState({ clearRole: false });
                    void clearInteractionState();
                    onAddInvestigationGroupMembersRef.current(group.id, nodeIds);
                  }}
                >
                  <span>{group.name || '研判组'}</span>
                  <small>{(group.memberNodeIds ?? []).length} 个主体 · 新增 {newMemberCount} 个</small>
                </button>
              ))}
            </div>
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
                  <span>全局综合筛选</span>
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

function buildGraphPngFilename(date = new Date()): string {
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join('');
  return `资金关系图-${stamp}.png`;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, content] = dataUrl.split(',');
  const contentType = head?.match(/:(.*?);/)?.[1] || 'image/png';
  const binary = globalThis.atob(content || '');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: contentType });
}

async function mergeGraphPngWithHtmlNodes(graph: G6Graph, graphDataUrl: string): Promise<string> {
  const image = await loadImageFromDataUrl(graphDataUrl);
  const nodeCards = buildExportNodeCards(graph);
  if (!nodeCards.length) {
    return graphDataUrl;
  }
  const graphBounds = resolveGraphRenderBounds(graph) ?? createBounds(0, 0, image.naturalWidth || image.width, image.naturalHeight || image.height);
  const nodeBounds = mergeBounds(nodeCards.map((card) => createNodeCardBounds(card.x, card.y)));
  const totalBounds = expandBounds(
    mergeBounds([graphBounds, nodeBounds].filter(Boolean) as ExportBounds[]) ?? graphBounds,
    EXPORT_PNG_PADDING,
  );
  const scale = graphBounds.width > 0 ? (image.naturalWidth || image.width) / graphBounds.width : (globalThis.devicePixelRatio || 1);
  const width = Math.max(1, Math.ceil(totalBounds.width * scale));
  const height = Math.max(1, Math.ceil(totalBounds.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    return graphDataUrl;
  }
  context.fillStyle = EXPORT_PNG_BACKGROUND;
  context.fillRect(0, 0, width, height);
  context.drawImage(
    image,
    (graphBounds.minX - totalBounds.minX) * scale,
    (graphBounds.minY - totalBounds.minY) * scale,
  );
  context.save();
  context.scale(scale, scale);
  for (const card of nodeCards) {
    drawExportNodeCard(context, card, totalBounds);
  }
  context.restore();
  return canvas.toDataURL('image/png');
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片导出数据读取失败'));
    image.src = dataUrl;
  });
}

function buildExportNodeCards(graph: G6Graph): ExportNodeCard[] {
  return graph.getNodeData()
    .map((datum: any) => {
      const id = String(datum?.id || '').trim();
      const data = datum?.data as GraphNodeRenderData | undefined;
      const position = id ? resolveGraphElementPosition(graph, id) : null;
      if (!id || !data || !position) return null;
      return { id, x: position.x, y: position.y, data };
    })
    .filter((card): card is ExportNodeCard => Boolean(card));
}

function resolveGraphElementPosition(graph: G6Graph, id: string): { x: number; y: number } | null {
  try {
    const position = graph.getElementPosition(id) as unknown;
    const x = Array.isArray(position) || position instanceof Float32Array
      ? Number(position[0])
      : Number((position as { x?: number } | null)?.x);
    const y = Array.isArray(position) || position instanceof Float32Array
      ? Number(position[1])
      : Number((position as { y?: number } | null)?.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  } catch {
    return null;
  }
}

function resolveGraphRenderBounds(graph: G6Graph): ExportBounds | null {
  const ids = [...graph.getNodeData(), ...graph.getEdgeData()]
    .map((datum: any) => String(datum?.id || '').trim())
    .filter(Boolean);
  const bounds = ids
    .map((id) => {
      try {
        return aabbToBounds(graph.getElementRenderBounds(id));
      } catch {
        return null;
      }
    })
    .filter((bound): bound is ExportBounds => Boolean(bound));
  return mergeBounds(bounds);
}

function aabbToBounds(aabb: any): ExportBounds | null {
  const min = aabb?.min;
  const max = aabb?.max;
  const minX = Array.isArray(min) || min instanceof Float32Array ? Number(min[0]) : Number(min?.x);
  const minY = Array.isArray(min) || min instanceof Float32Array ? Number(min[1]) : Number(min?.y);
  const maxX = Array.isArray(max) || max instanceof Float32Array ? Number(max[0]) : Number(max?.x);
  const maxY = Array.isArray(max) || max instanceof Float32Array ? Number(max[1]) : Number(max?.y);
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    return null;
  }
  return createBounds(minX, minY, maxX, maxY);
}

function createNodeCardBounds(centerX: number, centerY: number): ExportBounds {
  return createBounds(
    centerX - NODE_WIDTH / 2,
    centerY - NODE_HEIGHT / 2,
    centerX + NODE_WIDTH / 2,
    centerY + NODE_HEIGHT / 2,
  );
}

function mergeBounds(bounds: ExportBounds[]): ExportBounds | null {
  if (!bounds.length) return null;
  const minX = Math.min(...bounds.map((bound) => bound.minX));
  const minY = Math.min(...bounds.map((bound) => bound.minY));
  const maxX = Math.max(...bounds.map((bound) => bound.maxX));
  const maxY = Math.max(...bounds.map((bound) => bound.maxY));
  return createBounds(minX, minY, maxX, maxY);
}

function expandBounds(bounds: ExportBounds, padding: number): ExportBounds {
  const safePadding = Math.max(0, padding);
  return createBounds(
    bounds.minX - safePadding,
    bounds.minY - safePadding,
    bounds.maxX + safePadding,
    bounds.maxY + safePadding,
  );
}

function createBounds(minX: number, minY: number, maxX: number, maxY: number): ExportBounds {
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function drawExportNodeCard(context: CanvasRenderingContext2D, card: ExportNodeCard, exportBounds: ExportBounds): void {
  const data = card.data;
  const x = card.x - exportBounds.minX - NODE_WIDTH / 2;
  const y = card.y - exportBounds.minY - NODE_HEIGHT / 2;
  const roleStyle = data.isExcluded
    ? { color: '#8a94a6', border: '#b8c0cc', fill: '#f4f6f9' }
    : EXPORT_NODE_ROLE_PALETTE[data.role] ?? EXPORT_NODE_ROLE_PALETTE.peripheral;
  context.save();
  context.globalAlpha = data.isDimmed && !data.isRelationHighlighted && !data.isActive && !data.isSelected ? 0.24 : data.isExcluded ? 0.58 : 1;
  drawRoundedRect(context, x, y, NODE_WIDTH, NODE_HEIGHT, 8, roleStyle.fill, roleStyle.border, data.isExcluded ? [6, 5] : undefined);
  if (data.isSelected || data.isActive || data.isRelationHighlighted || data.isFocus || data.isSeed) {
    context.setLineDash([]);
    context.strokeStyle = data.isSelected ? '#2563eb' : '#1d4ed8';
    context.lineWidth = data.isSelected ? 2.5 : 1.8;
    drawRoundedPath(context, x - 1.5, y - 1.5, NODE_WIDTH + 3, NODE_HEIGHT + 3, 9);
    context.stroke();
  }

  const badgeX = x + 12;
  const badgeY = y + 10;
  drawRoundedRect(context, badgeX, badgeY, 34, 34, 6, mixWithWhite(roleStyle.color, 0.88), mixWithWhite(roleStyle.color, 0.74));
  context.fillStyle = roleStyle.color;
  context.font = '800 12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(data.isExcluded ? '排' : data.roleBadge, badgeX + 17, badgeY + 17);

  const copyX = x + 58;
  const titleY = y + 20;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillStyle = '#111827';
  context.font = '700 12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const roleWidth = measureRolePillWidth(context, data.roleLabel);
  drawEllipsisText(context, data.isExcluded ? `已排除 · ${data.title}` : data.title, copyX, titleY, NODE_WIDTH - 74 - roleWidth);
  drawRolePill(context, x + NODE_WIDTH - 12 - roleWidth, y + 9, roleWidth, data.roleLabel, roleStyle.color);

  context.fillStyle = '#667085';
  context.font = '10px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  drawEllipsisText(context, data.subtitle, copyX, y + 40, NODE_WIDTH - 70);
  context.fillStyle = '#8a94a6';
  drawEllipsisText(context, data.receivedText, copyX, y + 62, 74);
  drawEllipsisText(context, data.sentText, copyX + 86, y + 62, 74);
  context.restore();
}

function drawRolePill(context: CanvasRenderingContext2D, x: number, y: number, width: number, label: string, color: string): void {
  drawRoundedRect(context, x, y, width, 18, 9, mixWithWhite(color, 0.88));
  context.fillStyle = color;
  context.font = '700 10px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, x + width / 2, y + 9);
}

function measureRolePillWidth(context: CanvasRenderingContext2D, label: string): number {
  context.save();
  context.font = '700 10px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const width = Math.ceil(context.measureText(label).width) + 14;
  context.restore();
  return Math.max(34, width);
}

function drawEllipsisText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number): void {
  if (context.measureText(text).width <= maxWidth) {
    context.fillText(text, x, y);
    return;
  }
  let next = text;
  while (next.length > 1 && context.measureText(`${next}...`).width > maxWidth) {
    next = next.slice(0, -1);
  }
  context.fillText(`${next}...`, x, y);
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
  stroke?: string,
  lineDash?: number[],
): void {
  context.save();
  context.setLineDash(lineDash ?? []);
  drawRoundedPath(context, x, y, width, height, radius);
  context.fillStyle = fill;
  context.fill();
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = 1;
    context.stroke();
  }
  context.restore();
}

function drawRoundedPath(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function mixWithWhite(hexColor: string, whiteRatio: number): string {
  const rgb = parseHexColor(hexColor);
  if (!rgb) return hexColor;
  const ratio = clampNumber(whiteRatio, 0, 1);
  const red = Math.round(rgb.red * (1 - ratio) + 255 * ratio);
  const green = Math.round(rgb.green * (1 - ratio) + 255 * ratio);
  const blue = Math.round(rgb.blue * (1 - ratio) + 255 * ratio);
  return `rgb(${red}, ${green}, ${blue})`;
}

function parseHexColor(hexColor: string): { red: number; green: number; blue: number } | null {
  const normalized = hexColor.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function downloadDataUrl(dataUrl: string, filename: string): void {
  const blob = dataUrlToBlob(dataUrl);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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

export function buildGraphPngFilenameForTest(date: Date): string {
  return buildGraphPngFilename(date);
}

export function dataUrlToBlobForTest(dataUrl: string): Blob {
  return dataUrlToBlob(dataUrl);
}

export function createNodeCardBoundsForTest(centerX: number, centerY: number): ExportBounds {
  return createNodeCardBounds(centerX, centerY);
}

export function mergeExportBoundsForTest(bounds: ExportBounds[]): ExportBounds | null {
  return mergeBounds(bounds);
}

export function expandExportBoundsForTest(bounds: ExportBounds, padding: number): ExportBounds {
  return expandBounds(bounds, padding);
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

const INVESTIGATION_GROUP_EDGE_PREFIX = 'investigation-group-edge:';

function buildCollapsedInvestigationGroupRenderEdges(
  edges: CaseGraphData['edges'],
  groups: CaseGraphData['investigationGroups'] | undefined,
  nodeLookup: Map<string, CaseGraphData['nodes'][number]>,
): CaseGraphData['edges'] {
  const memberToCollapsedGroup = new Map<string, string>();
  for (const group of groups ?? []) {
    if (!group?.collapsed || !group.id) continue;
    for (const nodeId of group.memberNodeIds ?? []) {
      const normalizedNodeId = String(nodeId || '').trim();
      if (normalizedNodeId && nodeLookup.has(normalizedNodeId)) {
        memberToCollapsedGroup.set(normalizedNodeId, group.id);
      }
    }
  }
  if (!memberToCollapsedGroup.size) {
    return edges;
  }

  const edgeMap = new Map<string, CaseGraphData['edges'][number]>();
  const orderedEdgeIds: string[] = [];
  for (const edge of edges) {
    if (edge.edgeKind && edge.edgeKind !== 'money') {
      const edgeId = resolveEdgeId(edge);
      edgeMap.set(edgeId, edge);
      orderedEdgeIds.push(edgeId);
      continue;
    }

    const source = String(edge.source || edge.from || '').trim();
    const target = String(edge.target || edge.to || '').trim();
    if (!source || !target) continue;

    const sourceGroup = memberToCollapsedGroup.get(source);
    const targetGroup = memberToCollapsedGroup.get(target);
    const renderSource = sourceGroup ?? source;
    const renderTarget = targetGroup ?? target;
    if (!renderSource || !renderTarget || renderSource === renderTarget) {
      continue;
    }

    const edgeId = sourceGroup || targetGroup
      ? `${INVESTIGATION_GROUP_EDGE_PREFIX}${renderSource}->${renderTarget}`
      : resolveEdgeId(edge);
    const existing = edgeMap.get(edgeId);
    if (existing) {
      mergeRenderMoneyEdge(existing, edge);
      continue;
    }

    edgeMap.set(edgeId, {
      ...edge,
      id: edgeId,
      from: renderSource,
      to: renderTarget,
      source: renderSource,
      target: renderTarget,
      tradeAmount: Number(edge.tradeAmount || edge.amount || 0),
      amount: Number(edge.tradeAmount || edge.amount || 0),
      tradeCount: Number(edge.tradeCount || edge.count || 0),
      count: Number(edge.tradeCount || edge.count || 0),
      tradeIds: [...new Set((edge.tradeIds ?? []).map(String).filter(Boolean))],
      sourceTypes: edge.sourceTypes ? [...new Set(edge.sourceTypes.map(String).filter(Boolean))] : undefined,
    });
    orderedEdgeIds.push(edgeId);
  }

  return orderedEdgeIds.map((edgeId) => edgeMap.get(edgeId)).filter((edge): edge is CaseGraphData['edges'][number] => Boolean(edge));
}

function mergeRenderMoneyEdge(target: CaseGraphData['edges'][number], source: CaseGraphData['edges'][number]): void {
  const nextAmount = Number(source.tradeAmount || source.amount || 0);
  const nextCount = Number(source.tradeCount || source.count || 0);
  target.tradeAmount = Number(target.tradeAmount || target.amount || 0) + nextAmount;
  target.amount = target.tradeAmount;
  target.tradeCount = Number(target.tradeCount || target.count || 0) + nextCount;
  target.count = target.tradeCount;
  target.tradeIds = [
    ...new Set([...(target.tradeIds ?? []), ...(source.tradeIds ?? [])].map(String).filter(Boolean)),
  ];
  target.startDate = chooseRenderEdgeBoundary(target.startDate, source.startDate, 'min');
  target.endDate = chooseRenderEdgeBoundary(target.endDate, source.endDate, 'max');
  target.startTime = chooseRenderEdgeBoundary(target.startTime, source.startTime, 'min');
  target.endTime = chooseRenderEdgeBoundary(target.endTime, source.endTime, 'max');
  target.hasManualTrade = Boolean(target.hasManualTrade || source.hasManualTrade);
  target.manualTradeCount = Number(target.manualTradeCount || 0) + Number(source.manualTradeCount || 0);
  if (target.sourceTypes || source.sourceTypes) {
    target.sourceTypes = [
      ...new Set([...(target.sourceTypes ?? []), ...(source.sourceTypes ?? [])].map(String).filter(Boolean)),
    ];
  }
  target.isExcluded = Boolean(target.isExcluded && source.isExcluded);
}

function chooseRenderEdgeBoundary(
  current: string | null | undefined,
  next: string | null | undefined,
  mode: 'min' | 'max',
): string | null | undefined {
  if (!current) return next;
  if (!next) return current;
  return mode === 'min'
    ? (String(next) < String(current) ? next : current)
    : (String(next) > String(current) ? next : current);
}

function buildRenderNodeLookup(
  nodeLookup: Map<string, CaseGraphData['nodes'][number]>,
  groups: CaseGraphData['investigationGroups'] | undefined,
): Map<string, CaseGraphData['nodes'][number]> {
  const lookup = new Map(nodeLookup);
  for (const group of groups ?? []) {
    if (!group?.id || lookup.has(group.id)) continue;
    lookup.set(group.id, {
      id: group.id,
      label: group.name,
      name: group.name,
      accountName: group.name,
      type: 'group',
      isGroup: true,
    });
  }
  return lookup;
}

function buildInvestigationGroupSummaries(
  groups: CaseGraphData['investigationGroups'] | undefined,
  nodes: CaseGraphData['nodes'],
  edges: CaseGraphData['edges'],
): Map<string, InvestigationGroupSummary> {
  const nodeLookup = new Map(nodes.map((node) => [node.id, node]));
  const summaries = new Map<string, InvestigationGroupSummary>();
  for (const group of groups ?? []) {
    const memberNodeIds = (group.memberNodeIds ?? []).filter((nodeId) => nodeLookup.has(nodeId));
    const memberSet = new Set(memberNodeIds);
    const counterpartRows = new Map<string, InvestigationGroupCounterpartRow & { hasIn?: boolean; hasOut?: boolean }>();
    const summary: InvestigationGroupSummary = {
      groupId: group.id,
      memberCount: memberNodeIds.length,
      incomingAmount: 0,
      outgoingAmount: 0,
      incomingCount: 0,
      outgoingCount: 0,
      internalAmount: 0,
      internalCount: 0,
      externalEdgeCount: 0,
      counterpartCount: 0,
      counterpartRows: [],
    };

    for (const edge of edges) {
      if (edge.edgeKind && edge.edgeKind !== 'money') continue;
      const source = String(edge.source || edge.from || '').trim();
      const target = String(edge.target || edge.to || '').trim();
      if (!source || !target) continue;
      const sourceInGroup = memberSet.has(source);
      const targetInGroup = memberSet.has(target);
      if (!sourceInGroup && !targetInGroup) continue;

      const amount = Number(edge.tradeAmount || edge.amount || 0);
      const count = Number(edge.tradeCount || edge.count || 0);
      if (sourceInGroup && targetInGroup) {
        summary.internalAmount += amount;
        summary.internalCount += count;
        continue;
      }

      summary.externalEdgeCount += 1;
      const counterpartId = sourceInGroup ? target : source;
      if (targetInGroup) {
        summary.incomingAmount += amount;
        summary.incomingCount += count;
      } else {
        summary.outgoingAmount += amount;
        summary.outgoingCount += count;
      }
      const current = counterpartRows.get(counterpartId) ?? {
        nodeId: counterpartId,
        name: nodeDisplayName(nodeLookup.get(counterpartId) ?? null),
        direction: sourceInGroup ? 'out' : 'in',
        amount: 0,
        count: 0,
      };
      current.amount += amount;
      current.count += count;
      if (sourceInGroup) current.hasOut = true;
      if (targetInGroup) current.hasIn = true;
      current.direction = current.hasIn && current.hasOut ? 'both' : current.hasIn ? 'in' : 'out';
      counterpartRows.set(counterpartId, current);
    }

    summary.counterpartRows = [...counterpartRows.values()]
      .map(({ hasIn: _hasIn, hasOut: _hasOut, ...row }) => row)
      .sort((left, right) => right.amount - left.amount || right.count - left.count || left.name.localeCompare(right.name, 'zh-Hans-CN'));
    summary.counterpartCount = summary.counterpartRows.length;
    summaries.set(group.id, summary);
  }
  return summaries;
}

function resolveGroupCounterpartDirectionLabel(direction: InvestigationGroupCounterpartRow['direction']): string {
  if (direction === 'in') return '流入';
  if (direction === 'out') return '流出';
  return '双向';
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

export function buildCollapsedInvestigationGroupRenderEdgesForTest(
  edges: CaseGraphData['edges'],
  groups: CaseGraphData['investigationGroups'] | undefined,
  nodes: CaseGraphData['nodes'],
): CaseGraphData['edges'] {
  return buildCollapsedInvestigationGroupRenderEdges(edges, groups, new Map(nodes.map((node) => [node.id, node])));
}

export function buildInvestigationGroupSummariesForTest(
  groups: CaseGraphData['investigationGroups'] | undefined,
  nodes: CaseGraphData['nodes'],
  edges: CaseGraphData['edges'],
): Map<string, InvestigationGroupSummary> {
  return buildInvestigationGroupSummaries(groups, nodes, edges);
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
  canSummaryAnalysis?: boolean;
  canManualActions?: boolean;
  canExclude: boolean;
}): NodeContextMenuItem[] {
  return buildNodeContextMenuItems({
    ...input,
    canRestore: input.canRestore ?? false,
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
  if (input.canSummaryAnalysis) {
    items.push({ name: '综合筛选', value: 'summary-analysis' });
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

async function syncInvestigationGroupCollapseState(graph: G6Graph, groups: CaseGraphData['investigationGroups'] | undefined): Promise<void> {
  for (const group of groups ?? []) {
    if (!group?.id) continue;
    try {
      if (group.collapsed) {
        await Promise.resolve((graph as any).collapseElement?.(group.id));
      } else {
        await Promise.resolve((graph as any).expandElement?.(group.id));
      }
    } catch {
      // G6 may ignore collapse calls before a combo is fully mounted. The next render cycle
      // will retry from the persisted group state.
    }
  }
}

function createInvestigationGroupMemberSnapshot(
  combos: Array<{ id: string; data: { memberNodeIds?: string[] } }>,
): Map<string, string> {
  return new Map(combos.map((combo) => [
    combo.id,
    [...(combo.data.memberNodeIds ?? [])].sort().join('\u0001'),
  ]));
}

function resolveInvestigationGroupMemberChanges(
  previous: Map<string, string>,
  next: Map<string, string>,
): string[] {
  const groupIds = new Set([...previous.keys(), ...next.keys()]);
  return [...groupIds].filter((groupId) => previous.get(groupId) !== next.get(groupId));
}

async function expandRenderedInvestigationGroups(graph: G6Graph, groupIds: string[]): Promise<void> {
  if (!groupIds.length) return;
  const targetGroupIds = new Set(groupIds);
  for (const comboId of targetGroupIds) {
    if (!comboId) continue;
    try {
      await Promise.resolve((graph as any).expandElement?.(comboId));
    } catch {
      // Expanding changed combos before setData releases G6's collapsed child visibility cache.
    }
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

function renderNodeMarkup(data: GraphNodeRenderData): string {
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
  return `交易${tradeCount}笔 ${formatEdgeAmount(tradeAmount)}元`;
}

function formatEdgeAmount(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return rounded.toFixed(2);
}
