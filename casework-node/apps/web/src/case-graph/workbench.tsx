import { ArrowLeft, AlertCircle, Bot, Eye, EyeOff, Filter, Maximize2, MessageSquarePlus, Minimize2, Plus, RotateCcw, Settings, Sparkles, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type ReactNode } from 'react';

import { appStore, useAppSelector } from '../app-state';
import { buildTextAppendMessage, extractTextInput } from '../app-helpers';
import { loadSessionWorkspace } from '../api';
import {
  caseGraphActionSummary,
  caseGraphActionTitle,
  type CaseGraphChatAction,
  type CaseGraphChatActionDirection,
  type CaseGraphChatActionFilters,
} from './chat-action-protocol';
import { ChatWorkspace, type ChatWorkspaceRenderContext } from '../components/chat/chat-workspace';
import type { CaseGraphActionContextValue, CaseGraphActionPreview } from '../components/chat/case-graph-action-context';
import { ConversationContentPane } from '../components/chat/conversation-content-pane';
import { Modal } from '../components/ui/modal';
import { Select } from '../components/ui/select';
import type { ToolDetailPayload } from '../components/chat/detail-preview-context';
import type { DetailView } from '../detail-preview-pane';
import {
  graphStateToCanvasData,
  graphStateToOriginData,
  graphStepToStateSnapshot,
  normalizeCaseGraphGroupMap,
  normalizeCaseGraphOriginData,
  originDataToCanvasData,
  snapshotTradeCards,
} from './adapters';
import {
  addCaseGraphManualNode,
  addCaseGraphManualTrade,
  addCaseGraphRealityRelation,
  applyCaseGraphInvestigationGroup,
  applyCaseGraphSummarySelection,
  completeCaseGraphRelation,
  createCaseGraph,
  deleteCaseGraph,
  excludeCaseGraphNode,
  excludeCaseGraphTrades,
  filterCaseGraphRelation,
  loadCaseGraphState,
  loadCaseGraph,
  loadCaseGraphAccounts,
  loadCaseGraphCases,
  loadCaseGraphSteps,
  loadCaseGraphSummaryCandidates,
  loadCaseGraphTargetDetail,
  loadSavedCaseGraphs,
  queryCaseGraphRelation,
  restoreCaseGraphNode,
  restoreCaseGraphNodes,
  saveCaseGraphLatestStepLayout,
  saveCaseGraphLayoutOperation,
  saveCaseGraphNodeNote,
  updateCaseGraphContext,
  updateCaseGraphConfig,
} from './api';
import { CaseRail } from './case-rail';
import { EdgeDetailDrawer, filterEdgeDetailItemsForGraphEdge, type EdgeDetailPartyContext } from './edge-detail-drawer';
import { GraphView } from './graph-view';
import { buildMergedNetworkGraph, isGroupNodeId, parseGroupEdgeId } from './graph-view-adapters';
import { computeCaseGraphLayoutPlan, computeInitialG6LayoutPlan, type LayoutEvent, type LayoutPlan } from './layout-engine';
import { CaseGraphDateInput } from './date-input';
import {
  NodeDetailAnalysisDrawer,
  resolveTradeFactKey,
  type NodeDetailAnalysisRelation,
} from './node-detail-analysis-drawer';
import { ManualClueDrawer } from './manual-clue-drawer';
import { OperationEvidenceFields } from './operation-evidence-fields';
import {
  emptyOperationEvidence,
  validateOperationEvidence,
  type CaseGraphEvidenceOperation,
} from './operation-evidence';
import { SummaryAnalysisDrawer, type SummaryAnalysisItem, type SummaryAnalysisItemAction } from './summary-analysis-drawer';
import type {
  CaseGraphCaseOption,
  CaseGraphConversationFocus,
  CaseGraphData,
  CaseGraphExcludedNode,
  CaseGraphGroupMap,
  CaseGraphNode,
  CaseGraphOriginData,
  CaseGraphRelationResponse,
  CaseGraphSavedGraph,
  CaseGraphSelectableAccount,
  CaseGraphSnapshot,
  CaseGraphLayoutState,
  CaseGraphReplayTimeline,
  CaseGraphReplayTimelineStep,
  CaseGraphStateBody,
  CaseGraphStateSnapshot,
  CaseGraphStepSnapshot,
  CaseGraphTradeFact,
  CaseGraphTargetDetailResult,
  CaseGraphTradeCard,
  AddCaseGraphManualNodePayload,
  AddCaseGraphManualTradePayload,
  CaseGraphManualPartyPayload,
  AddCaseGraphRealityRelationPayload,
  ApplyCaseGraphInvestigationGroupPayload,
  CaseGraphOperationEvidence,
} from './types';
import type { SkillCandidate } from '../skill-quick-select';
import { runConfigWithSelectedSkill, selectedSkillNameFromRunConfig } from '../skill-quick-select';
import type { MediaItem, SessionWorkspaceFile } from '../types';
import { useAuthSession } from '../use-auth-session';
import {
  DETAIL_PANEL_MAX_WIDTH,
  DETAIL_PANEL_MIN_WIDTH,
  IMMERSIVE_CHAT_CONTENT_MAX,
  IMMERSIVE_CHAT_CONTENT_MIN,
  IMMERSIVE_DETAIL_PANEL_MIN_WIDTH,
  getPreferredDetailPanelWidth,
  shouldUseImmersivePreview,
} from '../preview-layout';

interface GraphTabState {
  graphId: string;
  graphName: string;
  caseId: string;
  graphContent: string;
  selectedAccountIds: string[];
  tradeCards: CaseGraphTradeCard[];
  queryBaselineTradeCards: CaseGraphTradeCard[];
  graphData: CaseGraphData | null;
  originData: CaseGraphOriginData | null;
  tradeFacts: Record<string, CaseGraphTradeFact>;
  groupMap: CaseGraphGroupMap;
  sourceSelectId: string[];
  excludedTrades: string[];
  excludedAccountId: string | string[] | null;
  excludedNodes: CaseGraphExcludedNode[];
  showExcludedNodes: boolean;
  drillNums: number;
  drillType: string | number | null;
  minAmount: number | string | null;
  maxAmount: number | string | null;
  startTime: string;
  endTime: string;
  appliedFilters: CaseGraphFilterState;
  chatId: string;
  loaded: boolean;
  layout: CaseGraphLayoutState;
  pendingDrillEvidence?: CaseGraphOperationEvidence;
}

interface OperationEvidencePromptState {
  operation: CaseGraphEvidenceOperation;
  title: string;
  description: string;
  resolve: (evidence: CaseGraphOperationEvidence | null) => void;
}

type CaseGraphChatPrompt = {
  key: string;
  label: string;
  prompt: string;
  icon: typeof Sparkles;
  action?: 'open_origin_panel';
};

interface CaseGraphFilterState {
  minAmount: string;
  maxAmount: string;
  startTime: string;
  endTime: string;
}

interface FocusLabelSource {
  accountId?: string | null;
  accountName?: string;
  suspectName?: string;
  tradeCard?: string;
}

type DrillDirection = 'in' | 'out' | 'both';

interface GraphNodePoint {
  x: number;
  y: number;
}

interface MergeGraphOptions {
  mode?: 'drill' | 'complete';
  direction?: DrillDirection;
  anchorNodeId?: string;
}

const LAYOUT_ENGINE_DIMENSIONS = {
  graphWidth: 1028,
  graphHeight: 620,
  nodeWidth: 248,
  nodeHeight: 84,
  columnGap: 126,
  rowGap: 40,
};

function clampDetailWidth(width: number, viewportWidth: number, immersive: boolean): number {
  if (!immersive) {
    return Math.min(DETAIL_PANEL_MAX_WIDTH, Math.max(DETAIL_PANEL_MIN_WIDTH, width));
  }

  const minWidth = Math.max(IMMERSIVE_DETAIL_PANEL_MIN_WIDTH, viewportWidth - IMMERSIVE_CHAT_CONTENT_MAX);
  const maxWidth = Math.min(DETAIL_PANEL_MAX_WIDTH, viewportWidth - IMMERSIVE_CHAT_CONTENT_MIN);
  return Math.min(maxWidth, Math.max(minWidth, width));
}

export function CaseGraphWorkbench({
  token,
  onBack,
  onOpenSettings,
  headerSlot,
  title,
  authResolved,
  currentUser,
  showFlash,
}: {
  token: string;
  onBack: () => void;
  onOpenSettings?: () => void;
  headerSlot?: ReactNode;
  title: string;
  authResolved: boolean;
  currentUser: ReturnType<typeof useAuthSession>['currentUser'];
  showFlash: (message: string) => void;
}) {
  const [cases, setCases] = useState<CaseGraphCaseOption[]>([]);
  const [casesLoading, setCasesLoading] = useState(true);
  const [caseIdDraft, setCaseIdDraft] = useState('');
  const [accountQuery, setAccountQuery] = useState('');
  const [availableAccounts, setAvailableAccounts] = useState<CaseGraphSelectableAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [savedGraphs, setSavedGraphs] = useState<CaseGraphSavedGraph[]>([]);
  const [savedGraphsLoading, setSavedGraphsLoading] = useState(false);
  const [graphTabs, setGraphTabs] = useState<GraphTabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [graphStepsById, setGraphStepsById] = useState<Record<string, CaseGraphStepSnapshot[]>>({});
  const [stepsLoadingById, setStepsLoadingById] = useState<Record<string, boolean>>({});
  const [replaySelection, setReplaySelection] = useState<{ graphId: string; stepId: string } | null>(null);
  const [edgeDetail, setEdgeDetail] = useState<CaseGraphTargetDetailResult | null>(null);
  const [edgeDetailLoading, setEdgeDetailLoading] = useState(false);
  const [edgeDetailOpen, setEdgeDetailOpen] = useState(false);
  const [edgeDetailPartyContext, setEdgeDetailPartyContext] = useState<EdgeDetailPartyContext | null>(null);
  const [edgeDetailContext, setEdgeDetailContext] = useState<{ edgeId: string; edge: CaseGraphData['edges'][number] } | null>(null);
  const [edgeDetailSelectedTradeIds, setEdgeDetailSelectedTradeIds] = useState<string[]>([]);
  const [edgeDetailApplying, setEdgeDetailApplying] = useState(false);
  const [detailAnalysisNode, setDetailAnalysisNode] = useState<CaseGraphNode | null>(null);
  const [detailAnalysisByEdgeId, setDetailAnalysisByEdgeId] = useState<Record<string, CaseGraphTargetDetailResult>>({});
  const [detailAnalysisLoadingEdgeIds, setDetailAnalysisLoadingEdgeIds] = useState<Record<string, boolean>>({});
  const [detailAnalysisSelectedTradeIds, setDetailAnalysisSelectedTradeIds] = useState<string[]>([]);
  const [detailAnalysisApplying, setDetailAnalysisApplying] = useState(false);
  const [summaryAnalysisOpen, setSummaryAnalysisOpen] = useState(false);
  const [summaryAnalysisScope, setSummaryAnalysisScope] = useState<'node' | 'global'>('node');
  const [summaryAnalysisNode, setSummaryAnalysisNode] = useState<CaseGraphNode | null>(null);
  const [summaryAnalysisItems, setSummaryAnalysisItems] = useState<SummaryAnalysisItem[]>([]);
  const [summaryAnalysisSelectedNodeIds, setSummaryAnalysisSelectedNodeIds] = useState<string[]>([]);
  const [summaryAnalysisLoading, setSummaryAnalysisLoading] = useState(false);
  const [summaryAnalysisApplying, setSummaryAnalysisApplying] = useState(false);
  const [summaryOperationEvidence, setSummaryOperationEvidence] = useState<CaseGraphOperationEvidence>(() => emptyOperationEvidence('candidate_subject_changes'));
  const [manualClueOpen, setManualClueOpen] = useState(false);
  const [manualClueMode, setManualClueMode] = useState<'node' | 'trade' | 'relation'>('trade');
  const [manualClueFocusNode, setManualClueFocusNode] = useState<CaseGraphNode | null>(null);
  const [manualCluePosition, setManualCluePosition] = useState<{ x: number; y: number } | null>(null);
  const [manualClueApplying, setManualClueApplying] = useState(false);
  const [groupDraftOpen, setGroupDraftOpen] = useState(false);
  const [groupDraftNodes, setGroupDraftNodes] = useState<CaseGraphNode[]>([]);
  const [groupDraftForm, setGroupDraftForm] = useState({ name: '', groupType: '团伙成员', note: '' });
  const [groupOperationEvidence, setGroupOperationEvidence] = useState<CaseGraphOperationEvidence>(() => emptyOperationEvidence('group_change'));
  const [groupOperationApplying, setGroupOperationApplying] = useState(false);
  const [requests, setRequests] = useState({
    creating: false,
    querying: false,
    drilling: false,
    filtering: false,
    excluding: false,
    deleting: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [newGraphDialogOpen, setNewGraphDialogOpen] = useState(false);
  const [graphConfigDialogOpen, setGraphConfigDialogOpen] = useState(false);
  const [excludedDialogOpen, setExcludedDialogOpen] = useState(false);
  const [excludedDialogTab, setExcludedDialogTab] = useState<'nodes' | 'trades'>('nodes');
  const [excludedTradeSelection, setExcludedTradeSelection] = useState<string[]>([]);
  const [excludedRestoreEvidence, setExcludedRestoreEvidence] = useState<CaseGraphOperationEvidence>(() => emptyOperationEvidence('restore_nodes'));
  const [originPanelOpen, setOriginPanelOpen] = useState(false);
  const [deleteGraphTarget, setDeleteGraphTarget] = useState<GraphTabState | null>(null);
  const [newGraphForm, setNewGraphForm] = useState({
    graphName: '',
  });
  const [graphConfigForm, setGraphConfigForm] = useState({
    drillNums: '10',
    drillType: '1',
    minAmount: '',
    maxAmount: '',
  });
  const [graphConfigEvidence, setGraphConfigEvidence] = useState<CaseGraphOperationEvidence>(() =>
    emptyOperationEvidence('drill_with_changed_settings'),
  );
  const [operationEvidencePrompt, setOperationEvidencePrompt] = useState<OperationEvidencePromptState | null>(null);
  const [operationEvidence, setOperationEvidence] = useState<CaseGraphOperationEvidence>(() => emptyOperationEvidence('exclude_nodes'));

  const requestOperationEvidence = useCallback((
    operation: CaseGraphEvidenceOperation,
    title: string,
    description: string,
  ): Promise<CaseGraphOperationEvidence | null> => new Promise((resolve) => {
    setOperationEvidence(emptyOperationEvidence(operation));
    setOperationEvidencePrompt({ operation, title, description, resolve });
  }), []);

  const closeOperationEvidencePrompt = useCallback(() => {
    setOperationEvidencePrompt((current) => {
      current?.resolve(null);
      return null;
    });
  }, []);

  const confirmOperationEvidence = useCallback((
    operation: CaseGraphEvidenceOperation,
    title: string,
    description: string,
    action: (evidence: CaseGraphOperationEvidence) => void,
  ) => {
    void requestOperationEvidence(operation, title, description).then((evidence) => {
      if (evidence) action(evidence);
    });
  }, [requestOperationEvidence]);

  const activeTab = useMemo(
    () => graphTabs.find((tab) => tab.graphId === activeTabId) ?? null,
    [activeTabId, graphTabs],
  );
  const currentChatId = useAppSelector((state) => state.currentChatId);
  const workspacePanel = useAppSelector((state) => state.workspacePanel);
  const workspaceByChat = useAppSelector((state) => state.workspaceByChat);
  const [conversationFocus, setConversationFocus] = useState<CaseGraphConversationFocus | null>(null);
  const [chatFullscreen, setChatFullscreen] = useState(false);
  const [detailView, setDetailView] = useState<DetailView | null>(null);
  const [contentPanelPinnedOpen, setContentPanelPinnedOpen] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [detailPanelWidth, setDetailPanelWidth] = useState(() =>
    clampDetailWidth(getPreferredDetailPanelWidth(window.innerWidth), window.innerWidth, false),
  );
  const [resizingDetailPanel, setResizingDetailPanel] = useState(false);
  const currentWorkspace = currentChatId ? workspaceByChat[currentChatId] ?? null : null;
  const panelWorkspace = workspacePanel.chatId ? workspaceByChat[workspacePanel.chatId] ?? null : null;
  const fullscreenWorkspaceOpen = chatFullscreen && workspacePanel.open;
  const workspaceLoading = Boolean(
    currentChatId && workspacePanel.loading && workspacePanel.chatId === currentChatId,
  );
  const workspaceFileCount = currentWorkspace?.files.length ?? 0;
  const fullscreenPreviewOpen = chatFullscreen && (contentPanelPinnedOpen || Boolean(detailView) || fullscreenWorkspaceOpen);
  const immersivePreview = fullscreenPreviewOpen && shouldUseImmersivePreview(viewportWidth);
  const immersiveChatContentWidth = immersivePreview
    ? Math.min(
        IMMERSIVE_CHAT_CONTENT_MAX,
        Math.max(IMMERSIVE_CHAT_CONTENT_MIN, viewportWidth - detailPanelWidth),
      )
    : null;
  const caseGraphSessionSyncRef = useRef<{
    graphId: string | null;
    chatId: string | null;
    creatingForGraphId: string | null;
  }>({
    graphId: null,
    chatId: null,
    creatingForGraphId: null,
  });
  const graphNodePositionsRef = useRef<Record<string, GraphNodePoint>>({});
  const layoutPersistenceInFlightRef = useRef(0);
  const layoutContextSuppressedUntilRef = useRef(0);
  const caseGraphChatContextRef = useRef<ChatWorkspaceRenderContext | null>(null);
  const lastAutoInsightStepRef = useRef('');
  const workspaceRequestCounterRef = useRef(0);

  const refreshGraphSteps = useCallback((tab: Pick<GraphTabState, 'caseId' | 'graphId'>) => {
    setStepsLoadingById((current) => ({ ...current, [tab.graphId]: true }));
    return loadCaseGraphSteps(tab.caseId, tab.graphId, token)
      .then((steps) => {
        setGraphStepsById((current) => ({ ...current, [tab.graphId]: steps }));
        return steps;
      })
      .catch((err: unknown) => {
        console.warn('加载图谱步骤失败', err);
        return [];
      })
      .finally(() => {
        setStepsLoadingById((current) => ({ ...current, [tab.graphId]: false }));
      });
  }, [token]);

  const graphNodesById = useMemo(
    () => new Map((activeTab?.graphData?.nodes ?? []).map((node) => [node.id, node])),
    [activeTab?.graphData],
  );

  useEffect(() => {
    const onResize = () => {
      const width = window.innerWidth;
      setViewportWidth(width);
      setDetailPanelWidth((current) =>
        clampDetailWidth(
          current,
          width,
          shouldUseImmersivePreview(width),
        ),
      );
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!resizingDetailPanel) {
      return;
    }
    const onMouseMove = (event: MouseEvent) => {
      const nextWidth = window.innerWidth - event.clientX;
      setDetailPanelWidth(
        clampDetailWidth(
          nextWidth,
          window.innerWidth,
          shouldUseImmersivePreview(window.innerWidth),
        ),
      );
    };
    const onMouseUp = () => {
      setResizingDetailPanel(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [resizingDetailPanel]);

  useEffect(() => {
    if (!chatFullscreen) {
      setDetailView(null);
      appStore.dispatch({ type: 'workspace.close' });
    }
  }, [chatFullscreen]);

  useEffect(() => {
    setDetailView(null);
    appStore.dispatch({ type: 'workspace.close' });
  }, [currentChatId]);

  useEffect(() => {
    let cancelled = false;
    setCasesLoading(true);
    loadCaseGraphCases(token)
      .then((items) => {
        if (cancelled) return;
        setCases(items);
        if (items[0]?.id) {
          setCaseIdDraft((current) => current || items[0]!.id);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载案件列表失败');
      })
      .finally(() => {
        if (!cancelled) setCasesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!caseIdDraft) {
      setAvailableAccounts([]);
      setSavedGraphs([]);
      return;
    }
    let cancelled = false;
    setAccountsLoading(true);
    loadCaseGraphAccounts(caseIdDraft, token, accountQuery)
      .then((items) => {
        if (!cancelled) setAvailableAccounts(items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载主体列表失败');
      })
      .finally(() => {
        if (!cancelled) setAccountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountQuery, caseIdDraft, token]);

  useEffect(() => {
    if (!caseIdDraft) {
      setSavedGraphs([]);
      return;
    }
    let cancelled = false;
    setSavedGraphsLoading(true);
    loadSavedCaseGraphs(caseIdDraft, token)
      .then((items) => {
        if (!cancelled) setSavedGraphs(items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载已有图失败');
      })
      .finally(() => {
        if (!cancelled) setSavedGraphsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [caseIdDraft, token]);

  useEffect(() => {
    if (!caseIdDraft || savedGraphsLoading) {
      return;
    }
    setGraphTabs((current) => {
      const currentById = new Map(current.map((tab) => [tab.graphId, tab]));
      const nextTabs = savedGraphs.map((graph) => {
        const existing = currentById.get(graph.graphId);
        if (existing) {
          return {
            ...existing,
            graphName: graph.graphName || existing.graphName,
            caseId: graph.caseId || existing.caseId,
          };
        }
        return {
          graphId: graph.graphId,
          graphName: graph.graphName || '未命名图',
          caseId: graph.caseId,
          graphContent: '',
          selectedAccountIds: [],
          tradeCards: [],
          queryBaselineTradeCards: [],
          graphData: null,
          originData: null,
          tradeFacts: {},
          groupMap: {},
          sourceSelectId: [],
          excludedTrades: [],
          excludedAccountId: null,
          excludedNodes: [],
          showExcludedNodes: false,
          drillNums: 10,
          drillType: 1,
          minAmount: '',
          maxAmount: '',
          startTime: '',
          endTime: '',
          appliedFilters: emptyFilterState(),
          chatId: graph.chatId || '',
          loaded: false,
        };
      });
      return nextTabs;
    });
    setActiveTabId((current) => {
      if (current && savedGraphs.some((graph) => graph.graphId === current)) {
        return current;
      }
      return savedGraphs[0]?.graphId ?? null;
    });
  }, [caseIdDraft, savedGraphs, savedGraphsLoading]);

  const selectedAccountIds = activeTab?.selectedAccountIds ?? [];

  const selectedTradeCards = useMemo(() => {
    if (!activeTab) return [];
    return availableAccounts
      .filter((account) => activeTab.selectedAccountIds.includes(account.accountId))
      .map((account) => ({
        accountId: account.accountId,
        tradeCard: account.tradeCard,
        accountName: account.accountName,
        suspectId: account.suspectId,
        suspectName: account.suspectName,
      }));
  }, [activeTab, availableAccounts]);

  const focusLabels = useMemo(() => {
    if (!activeTab) return [];
    return resolveFocusLabels(
      selectedTradeCards.length ? selectedTradeCards : activeTab.queryBaselineTradeCards,
      activeTab.selectedAccountIds,
    );
  }, [activeTab, selectedTradeCards]);

  const filterState = useMemo(
    () => currentFilterState(activeTab),
    [activeTab],
  );
  const filterDirty = useMemo(
    () => Boolean(activeTab && !sameFilterState(filterState, activeTab.appliedFilters)),
    [activeTab, filterState],
  );
  const activeGraphSteps = useMemo(
    () => activeTab ? graphStepsById[activeTab.graphId] ?? [] : [],
    [activeTab, graphStepsById],
  );
  const activeReplayStep = useMemo(() => {
    if (!activeTab || replaySelection?.graphId !== activeTab.graphId) {
      return null;
    }
    return activeGraphSteps.find((step) => step.stepId === replaySelection.stepId) ?? null;
  }, [activeGraphSteps, activeTab, replaySelection]);
  const activeReplayState = useMemo(
    () => graphStepToStateSnapshot(activeReplayStep, { graphName: activeTab?.graphName || '' }),
    [activeReplayStep, activeTab?.graphName],
  );
  const activeReplayTab = useMemo(
    () => activeReplayState ? graphStateToTab(activeReplayState, activeTab ?? undefined) : null,
    [activeReplayState, activeTab],
  );
  const displayTab = activeReplayTab ?? activeTab;
  const replayActive = Boolean(activeReplayStep);
  const visibleGraphData = useMemo(
    () => displayTab ? filterExcludedGraphData(displayTab.graphData, displayTab.showExcludedNodes) : null,
    [displayTab],
  );
  const excludedTradeItems = useMemo(
    () => activeTab ? buildExcludedTradeItems(activeTab) : [],
    [activeTab],
  );
  const excludedTradeSelectionSet = useMemo(
    () => new Set(excludedTradeSelection),
    [excludedTradeSelection],
  );
  const allExcludedTradesSelected = excludedTradeItems.length > 0
    && excludedTradeItems.every((item) => excludedTradeSelectionSet.has(item.tradeId));

  useEffect(() => {
    const availableTradeIds = new Set(excludedTradeItems.map((item) => item.tradeId));
    setExcludedTradeSelection((current) => current.filter((tradeId) => availableTradeIds.has(tradeId)));
  }, [excludedTradeItems]);
  const detailAnalysisRelationships = useMemo(
    () => activeTab && detailAnalysisNode
      ? buildNodeDetailAnalysisRelationships(detailAnalysisNode, activeTab)
      : [],
    [activeTab, detailAnalysisNode],
  );
  const replayTimeline = useMemo<CaseGraphReplayTimeline | undefined>(() => {
    if (!activeTab || activeGraphSteps.length < 2) {
      return undefined;
    }
    const steps = buildReplayTimelineSteps(activeGraphSteps);
    const latestStepId = steps.at(-1)?.stepId ?? null;
    return {
      steps,
      activeStepId: activeReplayStep?.stepId ?? null,
      loading: Boolean(stepsLoadingById[activeTab.graphId]),
      onStepSelect: (stepId) => {
        if (!stepId || stepId === latestStepId) {
          setReplaySelection(null);
          return;
        }
        setReplaySelection({ graphId: activeTab.graphId, stepId });
      },
    };
  }, [activeGraphSteps, activeReplayStep?.stepId, activeTab, stepsLoadingById]);

  useEffect(() => {
    if (!activeTab?.loaded || graphStepsById[activeTab.graphId]) {
      return;
    }
    void refreshGraphSteps(activeTab);
  }, [activeTab, graphStepsById, refreshGraphSteps]);

  useEffect(() => {
    if (!replaySelection || replaySelection.graphId !== activeTab?.graphId) {
      return;
    }
    if (replaySelection.stepId === resolveLatestGraphStepId(activeGraphSteps)) {
      setReplaySelection(null);
      return;
    }
    if (!activeGraphSteps.some((step) => step.stepId === replaySelection.stepId)) {
      setReplaySelection(null);
    }
  }, [activeGraphSteps, activeTab?.graphId, replaySelection]);

  const syncGraphContext = useCallback((focus: CaseGraphConversationFocus | null) => {
    if (!activeTab) {
      return;
    }
    if (
      layoutPersistenceInFlightRef.current > 0 ||
      Date.now() < layoutContextSuppressedUntilRef.current
    ) {
      return;
    }
    const hasGraphData = Boolean(activeTab.graphData?.nodes.length || activeTab.graphData?.edges.length);
    if (!focus && !hasGraphData) {
      setConversationFocus(null);
      return;
    }
    const nextFocus = focus
      ? { ...focus, graphId: activeTab.graphId, caseId: activeTab.caseId, graphName: activeTab.graphName }
      : {
          type: 'graph' as const,
          graphId: activeTab.graphId,
          caseId: activeTab.caseId,
          graphName: activeTab.graphName,
        };
    setConversationFocus(nextFocus);
    const payload =
      nextFocus.type === 'graph'
        ? null
        : { ...nextFocus, graphId: undefined, caseId: undefined, graphName: undefined };
    void updateCaseGraphContext(
      activeTab.graphId,
      { caseId: activeTab.caseId, graphName: activeTab.graphName, chatId: activeTab.chatId },
      payload,
      token,
    ).catch((err: unknown) => {
      console.warn('同步图上下文失败', err);
    });
  }, [activeTab, token]);

  const requestGraphStepInsight = useCallback((result: CaseGraphRelationResponse, tab: GraphTabState) => {
    const stepId = result.step?.stepId?.trim();
    const chatId = tab.chatId?.trim();
    if (!stepId || !chatId) {
      return;
    }
    const insightKey = `${tab.graphId}:${stepId}`;
    if (lastAutoInsightStepRef.current === insightKey) {
      return;
    }
    const chatContext = caseGraphChatContextRef.current;
    if (!chatContext) {
      return;
    }
    if (chatContext.currentChatId !== chatId) {
      chatContext.websocketSession.switchThread(chatId);
      return;
    }
    const activeTurn = appStore.getState().activeTurns[chatId];
    if (activeTurn?.waiting) {
      return;
    }
    const caseGraphSkill = findCaseGraphSkill(chatContext.availableSkills);
    if (!caseGraphSkill?.name) {
      return;
    }
    lastAutoInsightStepRef.current = insightKey;
    const focusPayload = conversationFocus?.graphId === tab.graphId
      ? graphFocusToContextPayload(conversationFocus)
      : null;
    const deltaSummary = buildRelationDeltaSummary(result.delta);
    const latestOperation = {
      type: result.step.type || result.queryMode,
      label: resolveRelationOperationLabel(result),
      params: result.step.request ?? {},
    };
    const sendInsightPrompt = () => {
      const message = buildTextAppendMessage(buildGraphStepInsightPrompt(result, tab));
      message.runConfig = runConfigWithSelectedSkill(message.runConfig, caseGraphSkill.name);
      void chatContext.sendAppendMessage(message).catch((error: unknown) => {
        showFlash(error instanceof Error ? error.message : '发送图谱研判消息失败');
      });
    };
    void updateCaseGraphContext(
      tab.graphId,
      {
        caseId: tab.caseId,
        graphName: tab.graphName,
        chatId,
        latestStepId: stepId,
        latestOperation,
        latestStepSummary: result.step.summary ?? {},
        deltaSummary,
      },
      focusPayload,
      token,
    )
      .catch((err: unknown) => {
        console.warn('同步最新图谱步骤上下文失败', err);
      })
      .finally(sendInsightPrompt);
  }, [conversationFocus, showFlash, token]);

  const updateGraphChatId = useCallback((graphId: string, chatId: string) => {
    setGraphTabs((current) =>
      current.map((tab) => (tab.graphId === graphId ? { ...tab, chatId } : tab)),
    );
    setSavedGraphs((current) =>
      current.map((graph) => (graph.graphId === graphId ? { ...graph, chatId } : graph)),
    );
    void updateCaseGraphConfig(graphId, { chatId }, token)
      .then((graph) => {
        const nextChatId = graph.chatId || chatId;
        setGraphTabs((current) =>
          current.map((tab) => (tab.graphId === graphId ? { ...tab, chatId: nextChatId } : tab)),
        );
        setSavedGraphs((current) =>
          current.map((item) => (item.graphId === graphId ? { ...item, chatId: nextChatId } : item)),
        );
        appStore.dispatch({ type: 'caseGraph.graph.loaded', graph });
      })
      .catch((err: unknown) => {
        showFlash(err instanceof Error ? err.message : '保存图谱对话关联失败');
      });
  }, [showFlash, token]);

  const handleCaseGraphSessionReady = useCallback((context: ChatWorkspaceRenderContext) => {
    caseGraphChatContextRef.current = context;
    if (!activeTab) {
      return;
    }
    const syncState = caseGraphSessionSyncRef.current;
    if (syncState.graphId !== activeTab.graphId) {
      syncState.graphId = activeTab.graphId;
      syncState.chatId = null;
      syncState.creatingForGraphId = null;
    }
    const graphChatId = activeTab.chatId?.trim() || '';
    if (graphChatId) {
      if (context.currentChatId !== graphChatId && syncState.chatId !== graphChatId) {
        syncState.chatId = graphChatId;
        context.websocketSession.switchThread(graphChatId);
      }
      return;
    }
    if (syncState.creatingForGraphId === activeTab.graphId) {
      return;
    }
    syncState.creatingForGraphId = activeTab.graphId;
    void context.websocketSession.createServerThread()
      .then((chatId) => {
        if (!chatId) {
          showFlash('创建图谱研判会话失败');
          return;
        }
        syncState.chatId = chatId;
        updateGraphChatId(activeTab.graphId, chatId);
      })
      .finally(() => {
        if (syncState.creatingForGraphId === activeTab.graphId) {
          syncState.creatingForGraphId = null;
        }
      });
  }, [activeTab, showFlash, updateGraphChatId]);

  useEffect(() => {
    if (!activeTab) {
      setConversationFocus(null);
      return;
    }
    if (!activeTab.graphData?.nodes.length && !activeTab.graphData?.edges.length) {
      setConversationFocus(null);
      return;
    }
    syncGraphContext(null);
  }, [activeTab?.graphId, activeTab?.graphName, activeTab?.caseId, activeTab?.graphData, syncGraphContext]);

  const ensurePreferredDetailWidth = useCallback(() => {
    setDetailPanelWidth(() =>
      clampDetailWidth(
        getPreferredDetailPanelWidth(window.innerWidth),
        window.innerWidth,
        shouldUseImmersivePreview(window.innerWidth),
      ),
    );
  }, []);

  const openMedia = useCallback((item: MediaItem) => {
    setChatFullscreen(true);
    ensurePreferredDetailWidth();
    setContentPanelPinnedOpen(true);
    setDetailView({ type: 'media', item });
  }, [ensurePreferredDetailWidth]);

  const openTool = useCallback((titleText: string, payload: ToolDetailPayload) => {
    setChatFullscreen(true);
    ensurePreferredDetailWidth();
    setContentPanelPinnedOpen(true);
    setDetailView({ type: 'tool', title: titleText, payload });
  }, [ensurePreferredDetailWidth]);

  const openWorkspace = useCallback(() => {
    if (!currentChatId) {
      return;
    }
    setChatFullscreen(true);
    ensurePreferredDetailWidth();
    setContentPanelPinnedOpen(true);
    const chatId = currentChatId;
    workspaceRequestCounterRef.current += 1;
    const requestId = workspaceRequestCounterRef.current;
    appStore.dispatch({ type: 'workspace.open', chatId });
    appStore.dispatch({ type: 'workspace.loading', chatId, requestId });
    loadSessionWorkspace(chatId, token)
      .then((workspace) => {
        appStore.dispatch({ type: 'workspace.loaded', chatId, requestId, workspace });
      })
      .catch((err: unknown) => {
        appStore.dispatch({
          type: 'workspace.failed',
          chatId,
          requestId,
          error: err instanceof Error ? err.message : '加载工作空间失败',
        });
      });
  }, [currentChatId, ensurePreferredDetailWidth, token]);

  const closeWorkspacePanel = useCallback(() => {
    appStore.dispatch({ type: 'workspace.close' });
  }, []);

  const openWorkspaceFile = useCallback((file: SessionWorkspaceFile) => {
    openMedia({ url: file.url, name: file.name, mime: file.mime });
  }, [openMedia]);

  const closeContentDetail = useCallback(() => {
    setDetailView(null);
  }, []);

  const closeContentPanel = useCallback(() => {
    setContentPanelPinnedOpen(false);
    setDetailView(null);
    appStore.dispatch({ type: 'workspace.close' });
  }, []);

  const toggleContentPanel = useCallback(() => {
    if (fullscreenPreviewOpen) {
      closeContentPanel();
      return;
    }
    setChatFullscreen(true);
    ensurePreferredDetailWidth();
    setContentPanelPinnedOpen(true);
  }, [closeContentPanel, ensurePreferredDetailWidth, fullscreenPreviewOpen]);

  const previewActions = useMemo(
    () => ({ openMedia, openTool }),
    [openMedia, openTool],
  );

  const hasInvestigationBasis = useMemo(() => {
    if (!activeTab) {
      return false;
    }
    return Boolean(
      activeTab.selectedAccountIds.length ||
      activeTab.tradeCards.length ||
      activeTab.queryBaselineTradeCards.length ||
      (activeTab.graphData?.nodes.length ?? 0) ||
      (activeTab.originData?.nodes.length ?? 0),
    );
  }, [activeTab]);

  const quickPrompts = useMemo<CaseGraphChatPrompt[]>(() => {
    const prompts: CaseGraphChatPrompt[] = [];
    if (activeTab && !hasInvestigationBasis) {
      prompts.push({
        key: 'origin',
        label: '确定侦办起点',
        icon: Plus,
        prompt: '请结合当前案件材料，帮我梳理适合作为侦办起点的主体、账号或关键交易线索。',
        action: 'open_origin_panel',
      });
      prompts.push({
        key: 'extract-subjects',
        label: '提取可上图主体',
        icon: Bot,
        prompt: '请从当前案件材料中提取可用于上图分析的主体、账号、时间和金额线索，并说明优先级。',
      });
      prompts.push({
        key: 'evidence-checklist',
        label: '整理待核线索',
        icon: MessageSquarePlus,
        prompt: '请把当前案件中需要先核实的主体、账户、交易和材料缺口整理成一份研判清单。',
      });
      return prompts;
    }
    if (activeTab) {
      prompts.push({
        key: 'summary',
        label: '总结整图',
        icon: Sparkles,
        prompt: `请基于当前案件图做一轮图谱研判：总结关键资金路径、异常点，并给出下一步建议方向。`,
      });
    }
    if (conversationFocus?.type === 'node') {
      prompts.push({
        key: 'node',
        label: '分析当前主体',
        icon: Bot,
        prompt: `请基于当前选中的账户/主体做分析，重点说明它的上下游结构、资金角色、异常点，以及下一步建议核查什么。`,
      });
    }
    if (conversationFocus?.type === 'edge') {
      prompts.push({
        key: 'edge',
        label: '分析当前交易线',
        icon: MessageSquarePlus,
        prompt: `请基于当前选中的交易线做分析，重点说明这两端的资金往来特征、异常模式，以及建议进一步核查的明细方向。`,
      });
    }
    return prompts;
  }, [activeTab, conversationFocus, hasInvestigationBasis]);

  const handleCaseIdChange = useCallback((value: string) => {
    setCaseIdDraft(value);
    setAccountQuery('');
    setAvailableAccounts([]);
    setSavedGraphs([]);
    setGraphTabs([]);
    setActiveTabId(null);
    setGraphStepsById({});
    setStepsLoadingById({});
    setReplaySelection(null);
    setConversationFocus(null);
    setEdgeDetailOpen(false);
    setEdgeDetail(null);
    setEdgeDetailPartyContext(null);
    setDetailView(null);
    appStore.dispatch({ type: 'workspace.close' });
  }, []);

  const openNewGraphDialog = useCallback(() => {
    setNewGraphForm({
      graphName: `图${graphTabs.length + 1}`,
    });
    setNewGraphDialogOpen(true);
  }, [graphTabs.length]);

  const handleOpenInvestigationOrigin = useCallback(() => {
    if (!activeTab) {
      openNewGraphDialog();
      return;
    }
    if (replayActive) {
      showFlash('历史预览中不能选择侦办起点，请先回到当前图');
      return;
    }
    setOriginPanelOpen(true);
  }, [activeTab, openNewGraphDialog, replayActive, showFlash]);

  const handleCreateGraph = useCallback(() => {
    if (!caseIdDraft) {
      setError('请先选择案件');
      return;
    }
    const graphName = newGraphForm.graphName.trim();
    if (!graphName) {
      setError('请输入图形名称');
      return;
    }
    setRequests((current) => ({ ...current, creating: true }));
    createCaseGraph({ caseId: caseIdDraft, graphName, tradeCards: [] }, token)
      .then((graph) => {
        const nextTab = graphToTab(graph);
        setGraphTabs((current) => [...current.filter((item) => item.graphId !== nextTab.graphId), nextTab]);
        setActiveTabId(nextTab.graphId);
        setReplaySelection(null);
        setGraphStepsById((current) => ({ ...current, [nextTab.graphId]: [] }));
        setSavedGraphs((current) => [
          {
            graphId: graph.graph_id,
            caseId: graph.caseId,
            graphName: graph.graphName,
            tradeCardCount: 0,
            updatedAt: Math.floor(Date.now() / 1000),
            chatId: graph.chatId || '',
          },
          ...current.filter((item) => item.graphId !== graph.graph_id),
        ]);
        setNewGraphDialogOpen(false);
        setError(null);
        appStore.dispatch({ type: 'caseGraph.graph.created', graph });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '创建图形失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, creating: false }));
      });
  }, [caseIdDraft, newGraphForm, token]);

  const handleLoadGraph = useCallback((graphId: string) => {
    const existing = graphTabs.find((item) => item.graphId === graphId);
    if (existing?.loaded) {
      setActiveTabId(existing.graphId);
      setError(null);
      return;
    }
    loadCaseGraph(graphId, token)
      .then(async (graph) => {
        const state = await loadCaseGraphState(graph.caseId, graph.graph_id, token).catch(() => null);
        const nextTab = state ? graphStateToTab(state, graph, { repairGeneratedLayout: true }) : graphToTab(graph);
        setGraphTabs((current) => [...current.filter((item) => item.graphId !== nextTab.graphId), nextTab]);
        setActiveTabId(nextTab.graphId);
        setCaseIdDraft(graph.caseId);
        void refreshGraphSteps(nextTab);
        if (state && hasLayoutPositionsChanged(state.graph.layout?.nodePositions ?? {}, nextTab.layout.nodePositions)) {
          void saveCaseGraphLatestStepLayout(
            nextTab.caseId,
            nextTab.graphId,
            {
              nodePositions: nextTab.layout.nodePositions,
              positionMeta: nextTab.layout.positionMeta,
              groupLayout: nextTab.layout.groupLayout,
            },
            token,
          ).then((savedState) => {
            setGraphTabs((current) => current.map((tab) => (
              tab.graphId === nextTab.graphId
                ? { ...tab, ...graphStateToTab(savedState, tab), graphContent: tab.graphContent, chatId: tab.chatId }
                : tab
            )));
            void refreshGraphSteps(nextTab);
          }).catch((err: unknown) => {
            console.warn('保存自动吸附后的图谱布局失败', err);
          });
        }
        setError(null);
        appStore.dispatch({ type: 'caseGraph.graph.loaded', graph });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '加载图形失败');
      });
  }, [graphTabs, refreshGraphSteps, token]);

  useEffect(() => {
    if (activeTab && !activeTab.loaded) {
      handleLoadGraph(activeTab.graphId);
    }
  }, [activeTab, handleLoadGraph]);

  const updateActiveTab = useCallback((updater: (tab: GraphTabState) => GraphTabState) => {
    setGraphTabs((current) =>
      current.map((tab) => (tab.graphId === activeTabId ? updater(tab) : tab)),
    );
  }, [activeTabId]);

  const persistGraphLayout = useCallback((
    tab: GraphTabState,
    positions: Record<string, GraphNodePoint>,
    reason: 'drag',
  ) => {
    if (!shouldPersistGraphPositions(tab.graphData, positions, reason)) {
      return;
    }
    const positionedGraphData = applyNodePositions(tab.graphData, positions);
    const layout = normalizeLayoutState(tab.layout);
    const groupPositions = resolveInvestigationGroupDragPositions(positionedGraphData, positions);
    const nextGroupLayout = applyGroupDragPositionsToLayout(layout.groupLayout, positionedGraphData, groupPositions);
    const positionedGraphDataWithGroups = applyInvestigationGroupPositions(positionedGraphData, groupPositions);
    const positionedOriginData = tab.originData && positionedGraphDataWithGroups
      ? { ...tab.originData, nodes: positionedGraphDataWithGroups.nodes, money: positionedGraphDataWithGroups.edges, investigationGroups: positionedGraphDataWithGroups.investigationGroups ?? [] }
      : tab.originData;
    if (!positionedGraphDataWithGroups || !positionedOriginData) {
      return;
    }
    const plan = computeCaseGraphLayoutPlan({
      graphData: positionedGraphDataWithGroups,
      previousLayout: {
        ...layout,
        groupLayout: nextGroupLayout,
      },
      event: { type: 'manual_move', movedPositions: positions },
      ...LAYOUT_ENGINE_DIMENSIONS,
    });
    const nextLayout = layoutStateFromPlan(plan, tab.layout);
    const snappedGroupPositions = resolveMovedGroupLayoutPositions(nextLayout.groupLayout, groupPositions);
    const nextPositionedGraphDataWithGroups = applyInvestigationGroupPositions(positionedGraphDataWithGroups, snappedGroupPositions);
    const nextPositionedOriginData = positionedOriginData && nextPositionedGraphDataWithGroups
      ? { ...positionedOriginData, nodes: nextPositionedGraphDataWithGroups.nodes, money: nextPositionedGraphDataWithGroups.edges, investigationGroups: nextPositionedGraphDataWithGroups.investigationGroups ?? [] }
      : positionedOriginData;
    updateActiveTab((current) => (
      current.graphId === tab.graphId
        ? { ...current, graphData: nextPositionedGraphDataWithGroups, originData: nextPositionedOriginData, layout: nextLayout }
        : current
    ));
    layoutPersistenceInFlightRef.current += 1;
    layoutContextSuppressedUntilRef.current = Date.now() + 2000;
    void saveCaseGraphLayoutOperation(
      tab.caseId,
      tab.graphId,
      {
        graphName: tab.graphName,
        nodePositions: { ...nextLayout.nodePositions, ...snappedGroupPositions },
        positionMeta: nextLayout.positionMeta,
        groupLayout: nextLayout.groupLayout,
      },
      token,
    ).then((state) => {
      updateActiveTab((current) => (
        current.graphId === tab.graphId
          ? { ...current, ...graphStateToTab(state, current), graphContent: current.graphContent, chatId: current.chatId }
          : current
      ));
      void refreshGraphSteps(tab);
    }).catch((err: unknown) => {
      console.warn('保存图谱布局失败', err);
    }).finally(() => {
      layoutPersistenceInFlightRef.current = Math.max(0, layoutPersistenceInFlightRef.current - 1);
      layoutContextSuppressedUntilRef.current = Date.now() + 600;
    });
  }, [refreshGraphSteps, token, updateActiveTab]);

  const persistBusinessLayoutPlan = useCallback((
    tab: GraphTabState,
    plan: LayoutPlan,
  ) => {
    const layout = layoutStateFromPlan(plan, tab.layout);
    void saveCaseGraphLatestStepLayout(
      tab.caseId,
      tab.graphId,
      {
        nodePositions: layout.nodePositions,
        positionMeta: layout.positionMeta,
        groupLayout: layout.groupLayout,
      },
      token,
    ).then((state) => {
      updateActiveTab((current) => (
        current.graphId === tab.graphId
          ? { ...current, ...graphStateToTab(state, current), graphContent: current.graphContent, chatId: current.chatId }
          : current
      ));
      void refreshGraphSteps(tab);
    }).catch((err: unknown) => {
      console.warn('保存步骤布局失败', err);
    });
  }, [refreshGraphSteps, token, updateActiveTab]);

  const handleToggleAccount = useCallback((accountId: string) => {
    if (!activeTabId) return;
    updateActiveTab((tab) => ({
      ...tab,
      selectedAccountIds: tab.selectedAccountIds.includes(accountId)
        ? tab.selectedAccountIds.filter((item) => item !== accountId)
        : [...tab.selectedAccountIds, accountId],
    }));
  }, [activeTabId, updateActiveTab]);

  const handleToggleAccountGroup = useCallback((accountIds: string[]) => {
    if (!activeTabId) return;
    updateActiveTab((tab) => {
      const allSelected = accountIds.every((accountId) => tab.selectedAccountIds.includes(accountId));
      return {
        ...tab,
        selectedAccountIds: allSelected
          ? tab.selectedAccountIds.filter((accountId) => !accountIds.includes(accountId))
          : Array.from(new Set([...tab.selectedAccountIds, ...accountIds])),
      };
    });
  }, [activeTabId, updateActiveTab]);

  const handleAnalyze = useCallback(() => {
    if (!activeTab) {
      setError('请先新增图形或打开已有图');
      return;
    }
    if (selectedTradeCards.length === 0) {
      setError('请先选择主体');
      return;
    }
    setReplaySelection(null);
    setRequests((current) => ({ ...current, querying: true }));
    const nextTradeCards = selectedTradeCards.length > 0 ? selectedTradeCards : activeTab.queryBaselineTradeCards;
    const filters = buildRelationFilterPayload({
      minAmount: activeTab.minAmount == null ? '' : String(activeTab.minAmount),
      maxAmount: activeTab.maxAmount == null ? '' : String(activeTab.maxAmount),
      startTime: activeTab.startTime,
      endTime: activeTab.endTime,
    });
    queryCaseGraphRelation(
      {
        graphId: activeTab.graphId,
        caseId: activeTab.caseId,
        seeds: buildRelationSeeds(availableAccounts, activeTab.selectedAccountIds),
        direction: 'both',
        ...buildRelationDrillConfig(activeTab),
        filters,
        options: buildRelationOptions(activeTab.graphData, graphNodePositionsRef.current),
        evidence: activeTab.pendingDrillEvidence,
        ...(activeTab.pendingDrillEvidence ? { evidenceContext: 'drill_with_changed_settings' as const } : {}),
      },
      token,
    )
      .then(async (result) => {
        const nextFromState = result.graphState ? graphStateToTab(result.graphState, activeTab, { repairGeneratedLayout: true }) : null;
        const originData = nextFromState?.originData ?? normalizeCaseGraphOriginData(result);
        const baseGraphData = nextFromState?.graphData ?? originDataToCanvasData(originData);
        const layoutPatch = await applyInitialLayoutEventToTabPatch(
          activeTab,
          baseGraphData,
          originData,
          { type: 'initial_graph', primaryAnchorIds: resolvePrimaryNodeIdsForAccounts(baseGraphData, activeTab.selectedAccountIds) },
        );
        updateActiveTab((tab) => ({
          ...tab,
          ...(nextFromState ? { ...nextFromState, graphContent: tab.graphContent, chatId: tab.chatId } : {}),
          loaded: true,
          graphContent: tab.graphContent,
          graphData: layoutPatch.graphData,
          originData: layoutPatch.originData,
          layout: layoutPatch.layout,
          tradeFacts: nextFromState?.tradeFacts ?? originData?.tradeFacts ?? tab.tradeFacts,
          tradeCards: nextTradeCards,
          queryBaselineTradeCards: nextTradeCards,
          groupMap: nextFromState?.groupMap ?? {},
          sourceSelectId: nextFromState?.sourceSelectId ?? [],
          excludedTrades: nextFromState?.excludedTrades ?? [],
          excludedAccountId: tab.excludedAccountId,
          excludedNodes: nextFromState?.excludedNodes ?? originData?.excludedNodes ?? [],
          appliedFilters: currentFilterState(tab),
          pendingDrillEvidence: undefined,
        }));
        persistBusinessLayoutPlan(activeTab, layoutPatch.plan);
        setOriginPanelOpen(false);
        setError(null);
        requestGraphStepInsight(result, activeTab);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '分析上图失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, querying: false }));
      });
  }, [activeTab, selectedTradeCards, token, updateActiveTab, requestGraphStepInsight, persistBusinessLayoutPlan]);

  const handleDrill = useCallback((direction: DrillDirection, node: CaseGraphNode, tradeCard: CaseGraphTradeCard | null) => {
    if (!activeTab) return;
    const seed = buildRelationSeedFromNode(node, tradeCard);
    if (!seed.accountIds.length && !seed.accounts?.length) {
      setError('当前节点缺少账号信息，无法钻取上下游');
      return;
    }
    setReplaySelection(null);
    setRequests((current) => ({ ...current, drilling: true }));
    const positionedCurrent = applyNodePositions(activeTab.graphData, graphNodePositionsRef.current);
    queryCaseGraphRelation(
      {
        graphId: activeTab.graphId,
        caseId: activeTab.caseId,
        seeds: [seed],
        direction,
        ...buildRelationDrillConfig(activeTab),
        filters: buildRelationFilterPayload(currentFilterState(activeTab)),
        options: buildRelationOptions(positionedCurrent, graphNodePositionsRef.current),
        evidence: activeTab.pendingDrillEvidence,
        ...(activeTab.pendingDrillEvidence ? { evidenceContext: 'drill_with_changed_settings' as const } : {}),
      },
      token,
    )
      .then((result) => {
        const nextFromState = result.graphState ? graphStateToTab(result.graphState, activeTab, { repairGeneratedLayout: true }) : null;
        const originData = nextFromState?.originData ?? normalizeCaseGraphOriginData(result);
        const mergedGraphData = mergeGraphData(positionedCurrent, originDataToCanvasData(originData), {
          mode: 'drill',
          direction,
          anchorNodeId: node.id,
        });
        const mergedOriginData = mergeOriginData(activeTab.originData, originData, {
          mode: 'drill',
          direction,
          anchorNodeId: node.id,
        });
        const layoutPatch = applyLayoutEventToTabPatch(
          activeTab,
          mergedGraphData,
          mergedOriginData,
          { type: 'relation_drill', anchorNodeIds: [node.id], addedNodeIds: addedNodeIdsFromResult(result) },
        );
        updateActiveTab((tab) => ({
          ...tab,
          ...(nextFromState ? { ...nextFromState, graphContent: tab.graphContent, chatId: tab.chatId } : {}),
          loaded: true,
          graphContent: tab.graphContent,
          graphData: layoutPatch.graphData,
          originData: layoutPatch.originData,
          layout: layoutPatch.layout,
          tradeFacts: nextFromState?.tradeFacts ?? tab.tradeFacts,
          groupMap: nextFromState?.groupMap ?? {},
          excludedNodes: nextFromState?.excludedNodes ?? originData?.excludedNodes ?? tab.excludedNodes,
          pendingDrillEvidence: undefined,
        }));
        persistBusinessLayoutPlan(activeTab, layoutPatch.plan);
        setError(null);
        requestGraphStepInsight(result, activeTab);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '钻取上下游失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, drilling: false }));
      });
  }, [activeTab, token, updateActiveTab, requestGraphStepInsight, persistBusinessLayoutPlan]);

  const handleCompleteGraphRelations = useCallback((evidence?: CaseGraphOperationEvidence) => {
    if (!activeTab) return;
    const accounts = resolveGraphAccounts(activeTab);
    if (accounts.length < 2) {
      setError('当前图上至少需要两个账号节点才能分析节点关系');
      return;
    }
    if (!evidence) {
      confirmOperationEvidence(
        'complete_relation',
        '补全图上关系',
        `将基于当前图上的 ${accounts.length} 个账号核查并补充资金关系，请记录本次操作依据。`,
        (nextEvidence) => handleCompleteGraphRelations(nextEvidence),
      );
      return;
    }
    setReplaySelection(null);
    setRequests((current) => ({ ...current, drilling: true }));
    const positionedCurrent = applyNodePositions(activeTab.graphData, graphNodePositionsRef.current);
    completeCaseGraphRelation(
      {
        caseId: activeTab.caseId,
        graphId: activeTab.graphId,
        accounts,
        filters: buildRelationFilterPayload(currentFilterState(activeTab)),
        options: buildRelationOptions(positionedCurrent, graphNodePositionsRef.current),
        evidence,
      },
      token,
    )
      .then((result) => {
        const nextFromState = result.graphState ? graphStateToTab(result.graphState, activeTab, { repairGeneratedLayout: true }) : null;
        const originData = nextFromState?.originData ?? normalizeCaseGraphOriginData(result);
        const baseGraphData = nextFromState?.graphData ?? mergeGraphData(positionedCurrent, originDataToCanvasData(originData), { mode: 'complete' });
        const baseOriginData = nextFromState?.originData ?? mergeOriginData(activeTab.originData, originData, { mode: 'complete' });
        const layoutPatch = applyLayoutEventToTabPatch(
          activeTab,
          baseGraphData,
          baseOriginData,
          { type: 'relation_complete', anchorNodeIds: accounts.map((account) => String(account.accountId || account.tradeCard || '').trim()).filter(Boolean), addedNodeIds: addedNodeIdsFromResult(result) },
        );
        updateActiveTab((tab) => ({
          ...tab,
          ...(nextFromState ? { ...nextFromState, graphContent: tab.graphContent, chatId: tab.chatId } : {}),
          loaded: true,
          graphContent: tab.graphContent,
          graphData: layoutPatch.graphData,
          originData: layoutPatch.originData,
          layout: layoutPatch.layout,
          tradeFacts: nextFromState?.tradeFacts ?? tab.tradeFacts,
          groupMap: nextFromState?.groupMap ?? {},
          excludedNodes: nextFromState?.excludedNodes ?? originData?.excludedNodes ?? tab.excludedNodes,
        }));
        persistBusinessLayoutPlan(activeTab, layoutPatch.plan);
        setError(null);
        requestGraphStepInsight(result, activeTab);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '分析图上节点关系失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, drilling: false }));
      });
  }, [activeTab, confirmOperationEvidence, token, updateActiveTab, requestGraphStepInsight, persistBusinessLayoutPlan]);

  const handleFilterFieldChange = useCallback((field: keyof CaseGraphFilterState, value: string) => {
    if (!activeTabId) return;
    updateActiveTab((tab) => ({
      ...tab,
      [field]: value,
    }));
  }, [activeTabId, updateActiveTab]);

  const applyCaseGraphFilterState = useCallback((filterState: CaseGraphFilterState): Promise<void> => {
    if (!activeTab) {
      setError('请先新增图形或打开已有图');
      return Promise.resolve();
    }
    if (!activeTab.graphData?.nodes.length) {
      setError('当前图还没有可筛选的数据，请先分析上图');
      return Promise.resolve();
    }
    const validationError = validateFilterState(filterState);
    if (validationError) {
      setError(validationError);
      return Promise.resolve();
    }
    setReplaySelection(null);
    setRequests((current) => ({ ...current, filtering: true }));
    return filterCaseGraphRelation(
      {
        caseId: activeTab.caseId,
        graphId: activeTab.graphId,
        filters: buildRelationFilterPayload(filterState),
        options: buildRelationOptions(activeTab.graphData, graphNodePositionsRef.current),
      },
      token,
    )
      .then((result) => {
        const nextFromState = result.graphState ? graphStateToTab(result.graphState, activeTab, { repairGeneratedLayout: true }) : null;
        const originData = nextFromState?.originData ?? normalizeCaseGraphOriginData(result);
        const baseGraphData = nextFromState?.graphData ?? originDataToCanvasData(originData);
        const layoutPatch = applyLayoutEventToTabPatch(
          activeTab,
          baseGraphData,
          originData,
          { type: 'relation_filter', addedNodeIds: addedNodeIdsFromResult(result) },
        );
        updateActiveTab((tab) => ({
          ...tab,
          ...(nextFromState ? { ...nextFromState, graphContent: tab.graphContent, chatId: tab.chatId } : {}),
          loaded: true,
          graphData: layoutPatch.graphData,
          originData: layoutPatch.originData,
          layout: layoutPatch.layout,
          tradeFacts: nextFromState?.tradeFacts ?? originData?.tradeFacts ?? tab.tradeFacts,
          groupMap: nextFromState?.groupMap ?? {},
          excludedNodes: nextFromState?.excludedNodes ?? originData?.excludedNodes ?? tab.excludedNodes,
          minAmount: filterState.minAmount,
          maxAmount: filterState.maxAmount,
          startTime: filterState.startTime,
          endTime: filterState.endTime,
          appliedFilters: filterState,
        }));
        persistBusinessLayoutPlan(activeTab, layoutPatch.plan);
        setError(null);
        requestGraphStepInsight(result, activeTab);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '筛选关系图失败');
        throw err;
      })
      .finally(() => {
        setRequests((current) => ({ ...current, filtering: false }));
      });
  }, [activeTab, token, updateActiveTab, requestGraphStepInsight]);

  const handleApplyFilters = useCallback(() => {
    if (!activeTab) {
      setError('请先新增图形或打开已有图');
      return;
    }
    void applyCaseGraphFilterState(currentFilterState(activeTab)).catch(() => undefined);
  }, [activeTab, applyCaseGraphFilterState]);

  const handleResetFilters = useCallback(() => {
    if (!activeTabId) return;
    updateActiveTab((tab) => ({
      ...tab,
      minAmount: '',
      maxAmount: '',
      startTime: '',
      endTime: '',
      appliedFilters: emptyFilterState(),
    }));
  }, [activeTabId, updateActiveTab]);

  const handleToggleShowExcludedNodes = useCallback(() => {
    if (!activeTabId) return;
    updateActiveTab((tab) => ({
      ...tab,
      showExcludedNodes: !tab.showExcludedNodes,
    }));
  }, [activeTabId, updateActiveTab]);

  const applyRelationResultToActiveTab = useCallback((result: { graph: CaseGraphData; graphState?: CaseGraphStateSnapshot; delta?: CaseGraphRelationResponse['delta'] }, event?: LayoutEvent) => {
    if (!activeTab) return;
    const nextFromState = result.graphState ? graphStateToTab(result.graphState, activeTab ?? undefined, { repairGeneratedLayout: true }) : null;
    const originData = nextFromState?.originData ?? normalizeCaseGraphOriginData(result as any);
    const baseGraphData = nextFromState?.graphData ?? originDataToCanvasData(originData);
    const layoutPatch = applyLayoutEventToTabPatch(
      activeTab,
      baseGraphData,
      originData,
      event ?? { type: 'layout_refresh', addedNodeIds: addedNodeIdsFromResult({ delta: result.delta ?? {} }) },
    );
    updateActiveTab((tab) => ({
      ...tab,
      ...(nextFromState ? { ...nextFromState, graphContent: tab.graphContent, chatId: tab.chatId } : {}),
      loaded: true,
      graphData: layoutPatch.graphData,
      originData: layoutPatch.originData,
      layout: layoutPatch.layout,
      tradeFacts: nextFromState?.tradeFacts ?? originData?.tradeFacts ?? tab.tradeFacts,
      groupMap: nextFromState?.groupMap ?? {},
      excludedNodes: nextFromState?.excludedNodes ?? originData?.excludedNodes ?? [],
    }));
    persistBusinessLayoutPlan(activeTab, layoutPatch.plan);
  }, [activeTab, persistBusinessLayoutPlan, updateActiveTab]);

  const handleExcludeNode = useCallback((node: CaseGraphExcludedNode, evidence?: CaseGraphOperationEvidence) => {
    if (!activeTab) return;
    if (!evidence) {
      confirmOperationEvidence(
        'exclude_nodes',
        '取消主体上图',
        `将取消“${node.label || '当前主体'}”上图并隐藏相关资金线，后续可以恢复。`,
        (nextEvidence) => handleExcludeNode(node, nextEvidence),
      );
      return;
    }
    setReplaySelection(null);
    setRequests((current) => ({ ...current, excluding: true }));
    excludeCaseGraphNode(
      {
        caseId: activeTab.caseId,
        graphId: activeTab.graphId,
        node,
        evidence,
      },
      token,
    )
      .then((result) => {
        applyRelationResultToActiveTab(result);
        void refreshGraphSteps(activeTab);
        setError(null);
        requestGraphStepInsight(result, activeTab);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '排除节点失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, excluding: false }));
      });
  }, [activeTab, applyRelationResultToActiveTab, confirmOperationEvidence, refreshGraphSteps, requestGraphStepInsight, token]);

  const handleExcludeNodes = useCallback((nodes: CaseGraphExcludedNode[], evidence?: CaseGraphOperationEvidence) => {
    if (!activeTab || !nodes.length) return;
    if (!evidence) {
      confirmOperationEvidence(
        'exclude_nodes',
        '批量取消主体上图',
        `将取消 ${nodes.length} 个主体上图并隐藏相关资金线，后续可以恢复。`,
        (nextEvidence) => handleExcludeNodes(nodes, nextEvidence),
      );
      return;
    }
    setReplaySelection(null);
    setRequests((current) => ({ ...current, excluding: true }));
    excludeCaseGraphNode(
      {
        caseId: activeTab.caseId,
        graphId: activeTab.graphId,
        nodes,
        evidence,
      },
      token,
    )
      .then((result) => {
        applyRelationResultToActiveTab(result);
        requestGraphStepInsight(result, activeTab);
        void refreshGraphSteps(activeTab);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '批量取消上图失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, excluding: false }));
      });
  }, [activeTab, applyRelationResultToActiveTab, confirmOperationEvidence, refreshGraphSteps, requestGraphStepInsight, token]);

  const handleRestoreNode = useCallback((nodeId: string) => {
    if (!activeTab) return;
    setReplaySelection(null);
    setRequests((current) => ({ ...current, excluding: true }));
    restoreCaseGraphNode(
      {
        caseId: activeTab.caseId,
        graphId: activeTab.graphId,
        nodeId,
        options: buildRelationOptions(activeTab.graphData, graphNodePositionsRef.current),
        evidence: excludedRestoreEvidence,
      },
      token,
    )
      .then((result) => {
        applyRelationResultToActiveTab(result, { type: 'restore_node', restoredNodeIds: [nodeId] });
        void refreshGraphSteps(activeTab);
        setError(null);
        requestGraphStepInsight(result, activeTab);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '恢复节点失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, excluding: false }));
      });
  }, [activeTab, applyRelationResultToActiveTab, excludedRestoreEvidence, refreshGraphSteps, requestGraphStepInsight, token]);

  const handleRestoreAllExcludedNodes = useCallback(() => {
    if (!activeTab || !activeTab.excludedNodes.length) return;
    setReplaySelection(null);
    setRequests((current) => ({ ...current, excluding: true }));
    const restoredNodeIds = activeTab.excludedNodes.map((item) => item.nodeId).filter(Boolean);
    restoreCaseGraphNodes(
      {
        caseId: activeTab.caseId,
        graphId: activeTab.graphId,
        nodeIds: restoredNodeIds,
        options: buildRelationOptions(activeTab.graphData, graphNodePositionsRef.current),
        evidence: excludedRestoreEvidence,
      },
      token,
    )
      .then((result) => {
        applyRelationResultToActiveTab(result, { type: 'restore_node', restoredNodeIds });
        requestGraphStepInsight(result, activeTab);
        void refreshGraphSteps(activeTab);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '恢复全部节点失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, excluding: false }));
      });
  }, [activeTab, applyRelationResultToActiveTab, excludedRestoreEvidence, refreshGraphSteps, requestGraphStepInsight, token]);

  const handleToggleExcludedTradeSelection = useCallback((tradeId: string) => {
    setExcludedTradeSelection((current) => setTradeSelection(current, [tradeId], !current.includes(tradeId)));
  }, []);

  const handleSetAllExcludedTradeSelection = useCallback((selected: boolean) => {
    setExcludedTradeSelection(selected ? excludedTradeItems.map((item) => item.tradeId) : []);
  }, [excludedTradeItems]);

  const handleRestoreExcludedTrades = useCallback((tradeIds: string[]) => {
    if (!activeTab || !tradeIds.length) return;
    const restoreSet = new Set(tradeIds.map((tradeId) => String(tradeId || '').trim()).filter(Boolean));
    const nextExcludedTrades = activeTab.excludedTrades.filter((tradeId) => !restoreSet.has(String(tradeId || '').trim()));
    setReplaySelection(null);
    setRequests((current) => ({ ...current, excluding: true }));
    excludeCaseGraphTrades(
      {
        caseId: activeTab.caseId,
        graphId: activeTab.graphId,
        excludedTrades: nextExcludedTrades,
        tradeFacts: activeTab.tradeFacts ?? activeTab.graphData?.tradeFacts ?? {},
        edgeTradeIds: buildEdgeTradeIdsFromGraph(activeTab.graphData),
        options: buildRelationOptions(activeTab.graphData, graphNodePositionsRef.current),
        evidence: excludedRestoreEvidence,
      },
      token,
    )
      .then((result) => {
        applyRelationResultToActiveTab(result);
        void refreshGraphSteps(activeTab);
        setExcludedTradeSelection((current) => current.filter((tradeId) => nextExcludedTrades.includes(tradeId)));
        setError(null);
        requestGraphStepInsight(result, activeTab);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '恢复交易流水失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, excluding: false }));
      });
  }, [activeTab, applyRelationResultToActiveTab, excludedRestoreEvidence, refreshGraphSteps, requestGraphStepInsight, token]);

  const handleRestoreSelectedExcludedTrades = useCallback(() => {
    handleRestoreExcludedTrades(excludedTradeSelection);
  }, [excludedTradeSelection, handleRestoreExcludedTrades]);

  const handleOpenEdgeDetail = useCallback((edgeId: string, edgeFocus?: CaseGraphConversationFocus, edgeOverride?: CaseGraphData['edges'][number]) => {
    if (!activeTab) return;
    if (edgeFocus?.type === 'edge') {
      syncGraphContext(edgeFocus);
    }
    const groupedEdge = parseGroupEdgeId(edgeId);
    if (groupedEdge) {
      if (!edgeFocus) {
        syncGraphContext({
          type: 'edge',
          graphId: activeTab.graphId,
          caseId: activeTab.caseId,
          graphName: activeTab.graphName,
          from: groupedEdge.sourceId,
          to: groupedEdge.targetId,
          fromName: resolveNodeDisplayName(graphNodesById.get(groupedEdge.sourceId), groupedEdge.sourceId, activeTab.groupMap),
          toName: resolveNodeDisplayName(graphNodesById.get(groupedEdge.targetId), groupedEdge.targetId, activeTab.groupMap),
        });
      }
      const payerCards = resolveNodePartyCardsById(groupedEdge.sourceId, activeTab);
      const payeeCards = resolveNodePartyCardsById(groupedEdge.targetId, activeTab);
      const groupedGraph = buildMergedNetworkGraph(activeTab.graphData, activeTab.groupMap);
      const groupedGraphEdge = groupedGraph?.edges.find((item) => resolveWorkbenchEdgeId(item) === edgeId || item.id === edgeId) ?? null;
      const edgeForDetail: CaseGraphData['edges'][number] = groupedGraphEdge ?? {
        id: edgeId,
        from: groupedEdge.sourceId,
        to: groupedEdge.targetId,
        source: groupedEdge.sourceId,
        target: groupedEdge.targetId,
        tradeAmount: 0,
        tradeCount: 0,
        amount: 0,
        count: 0,
        tradeIds: [],
      };
      const factDetail = buildDetailItemsFromGraphTradeFacts(edgeForDetail, activeTab);
      if (!payerCards.length || !payeeCards.length) {
        if (!factDetail.length) {
          setError('当前交易线缺少明细定位字段');
          return;
        }
        setEdgeDetailPartyContext({
          payerName: resolveNodeDisplayName(graphNodesById.get(groupedEdge.sourceId), groupedEdge.sourceId, activeTab.groupMap),
          payeeName: resolveNodeDisplayName(graphNodesById.get(groupedEdge.targetId), groupedEdge.targetId, activeTab.groupMap),
        });
        setEdgeDetailContext({ edgeId: resolveWorkbenchEdgeId(edgeForDetail), edge: edgeForDetail });
        setEdgeDetailSelectedTradeIds([]);
        setEdgeDetailOpen(true);
        setEdgeDetail(factDetail);
        setEdgeDetailLoading(false);
        setError(null);
        return;
      }
      setEdgeDetailPartyContext({
        payerName: resolveNodeDisplayName(graphNodesById.get(groupedEdge.sourceId), groupedEdge.sourceId, activeTab.groupMap),
        payeeName: resolveNodeDisplayName(graphNodesById.get(groupedEdge.targetId), groupedEdge.targetId, activeTab.groupMap),
      });
      setEdgeDetailContext({ edgeId: resolveWorkbenchEdgeId(edgeForDetail), edge: edgeForDetail });
      setEdgeDetailSelectedTradeIds([]);
      setEdgeDetailOpen(true);
      setEdgeDetail(null);
      setEdgeDetailLoading(true);
      loadCaseGraphTargetDetail(
        {
          graphId: activeTab.graphId,
          caseId: activeTab.caseId,
          payerCards,
          payeeCards,
          limit: 1000,
        },
        token,
      )
        .then((detail) => {
          setEdgeDetail(mergeTargetDetailItems(
            filterEdgeDetailItemsForGraphEdge(detail, edgeForDetail.tradeIds, activeTab.excludedTrades),
            factDetail,
          ));
          setError(null);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : '交易线详情加载失败');
        })
        .finally(() => {
          setEdgeDetailLoading(false);
        });
      return;
    }
    const edge = edgeOverride ?? (activeTab.graphData?.edges ?? []).find((item) => item.id === edgeId);
    if (!edge) return;
    const usesRenderedInvestigationGroupEdge = String(edge.id || edgeId).startsWith('investigation-group-edge:');
    if (!edgeFocus) {
      syncGraphContext({
        type: 'edge',
        graphId: activeTab.graphId,
        caseId: activeTab.caseId,
        graphName: activeTab.graphName,
        from: edge.source,
        to: edge.target,
        fromName: resolveNodeDisplayName(graphNodesById.get(edge.source), edge.source, activeTab.groupMap),
        toName: resolveNodeDisplayName(graphNodesById.get(edge.target), edge.target, activeTab.groupMap),
      });
    }
    const source = graphNodesById.get(edge.source);
    const target = graphNodesById.get(edge.target);
    const payerCards = resolveNodePartyCards(source, activeTab);
    const payeeCards = resolveNodePartyCards(target, activeTab);
    const factDetail = buildDetailItemsFromGraphTradeFacts(edge, activeTab);
    if (!payerCards.length || !payeeCards.length) {
      if (!factDetail.length) {
        setError('当前交易线缺少明细定位字段');
        return;
      }
      const detailPartyContext = usesRenderedInvestigationGroupEdge ? null : edgeFocus;
      setEdgeDetailPartyContext(detailPartyContext?.type === 'edge' ? {
        payerName: detailPartyContext.fromName || edge.source,
        payeeName: detailPartyContext.toName || edge.target,
      } : null);
      setEdgeDetailContext({ edgeId: resolveWorkbenchEdgeId(edge), edge });
      setEdgeDetailSelectedTradeIds([]);
      setEdgeDetailOpen(true);
      setEdgeDetail(factDetail);
      setEdgeDetailLoading(false);
      setError(null);
      return;
    }
    const detailPartyContext = usesRenderedInvestigationGroupEdge ? null : edgeFocus;
    setEdgeDetailPartyContext(detailPartyContext?.type === 'edge' ? {
      payerName: detailPartyContext.fromName || edge.source,
      payeeName: detailPartyContext.toName || edge.target,
    } : {
      payerName: resolveNodeDisplayName(source, edge.source, activeTab.groupMap),
      payeeName: resolveNodeDisplayName(target, edge.target, activeTab.groupMap),
    });
    setEdgeDetailContext({ edgeId: resolveWorkbenchEdgeId(edge), edge });
    setEdgeDetailSelectedTradeIds([]);
    setEdgeDetailOpen(true);
    setEdgeDetail(null);
    setEdgeDetailLoading(true);
    loadCaseGraphTargetDetail(
      {
        graphId: activeTab.graphId,
        caseId: activeTab.caseId,
        payerCards,
        payeeCards,
        limit: 1000,
      },
      token,
    )
      .then((detail) => {
        setEdgeDetail(mergeTargetDetailItems(
          filterEdgeDetailItemsForGraphEdge(detail, edge.tradeIds, activeTab.excludedTrades),
          factDetail,
        ));
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '交易线详情加载失败');
      })
      .finally(() => {
        setEdgeDetailLoading(false);
      });
  }, [activeTab, graphNodesById, syncGraphContext, token]);

  const handleCloseEdgeDetail = useCallback(() => {
    setEdgeDetailOpen(false);
    setEdgeDetail(null);
    setEdgeDetailLoading(false);
    setEdgeDetailPartyContext(null);
    setEdgeDetailContext(null);
    setEdgeDetailSelectedTradeIds([]);
    setEdgeDetailApplying(false);
  }, []);

  const handleToggleEdgeDetailTrade = useCallback((tradeId: string) => {
    setEdgeDetailSelectedTradeIds((current) => setTradeSelection(current, [tradeId], !current.includes(tradeId)));
  }, []);

  const handleSetEdgeDetailTrades = useCallback((tradeIds: string[], selected: boolean) => {
    setEdgeDetailSelectedTradeIds((current) => setTradeSelection(current, tradeIds, selected));
  }, []);

  const applyEdgeDetailExclusion = useCallback((tradeIds: string[], evidence?: CaseGraphOperationEvidence) => {
    const selectedTradeIds = [...new Set(tradeIds.map((tradeId) => tradeId.trim()).filter(Boolean))];
    if (!activeTab || !edgeDetailContext || !selectedTradeIds.length) return;
    if (!evidence) {
      confirmOperationEvidence(
        'exclude_trades',
        '排除交易流水',
        `将从当前图中排除 ${selectedTradeIds.length} 笔交易流水，并重新计算受影响的资金线。`,
        (nextEvidence) => applyEdgeDetailExclusion(selectedTradeIds, nextEvidence),
      );
      return;
    }
    const currentDetail = edgeDetail ?? [];
    const detailByEdgeId = { [edgeDetailContext.edgeId]: currentDetail };
    const edgeTradeIds = buildEdgeTradeIdsFromDetails(detailByEdgeId);
    if (!Object.keys(edgeTradeIds).length) {
      setError('当前交易线没有可排除的交易明细');
      return;
    }
    setReplaySelection(null);
    setEdgeDetailApplying(true);
    excludeCaseGraphTrades(
      {
        caseId: activeTab.caseId,
        graphId: activeTab.graphId,
        excludedTrades: buildAppliedExcludedTradeIds(activeTab.excludedTrades, selectedTradeIds),
        tradeFacts: buildTradeFactsFromDetails(detailByEdgeId),
        edgeTradeIds,
        options: buildRelationOptions(activeTab.graphData, graphNodePositionsRef.current),
        evidence,
      },
      token,
    )
      .then((result) => {
        applyRelationResultToActiveTab(result);
        void refreshGraphSteps(activeTab);
        handleCloseEdgeDetail();
        setError(null);
        requestGraphStepInsight(result, activeTab);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '交易线核查失败');
      })
      .finally(() => {
        setEdgeDetailApplying(false);
      });
  }, [
    activeTab,
    applyRelationResultToActiveTab,
    confirmOperationEvidence,
    edgeDetail,
    edgeDetailContext,
    handleCloseEdgeDetail,
    refreshGraphSteps,
    requestGraphStepInsight,
    token,
  ]);

  const handleApplyEdgeDetailExclusion = useCallback(() => {
    applyEdgeDetailExclusion(edgeDetailSelectedTradeIds);
  }, [applyEdgeDetailExclusion, edgeDetailSelectedTradeIds]);

  const handleExcludeEdgeDetailTrades = useCallback((tradeIds: string[]) => {
    applyEdgeDetailExclusion(tradeIds);
  }, [applyEdgeDetailExclusion]);

  const handleOpenNodeDetailAnalysis = useCallback((node: CaseGraphNode) => {
    if (!activeTab) return;
    setReplaySelection(null);
    setDetailAnalysisNode(node);
    setDetailAnalysisByEdgeId({});
    setDetailAnalysisLoadingEdgeIds({});
    setDetailAnalysisSelectedTradeIds([]);
    syncGraphContext({
      type: 'node',
      graphId: activeTab.graphId,
      caseId: activeTab.caseId,
      graphName: activeTab.graphName,
      nodeId: node.id,
      label: node.label || node.name || node.accountName,
      accountId: node.accountId ?? null,
      accountName: node.accountName || node.label || node.name,
      tradeCard: node.tradeCard,
    });
  }, [activeTab, syncGraphContext]);

  const handleLoadDetailAnalysisRelation = useCallback((relation: NodeDetailAnalysisRelation) => {
    if (!activeTab) return;
    if (detailAnalysisByEdgeId[relation.edgeId] || detailAnalysisLoadingEdgeIds[relation.edgeId]) {
      return;
    }
    const sourceId = relation.edge.source || relation.edge.from;
    const targetId = relation.edge.target || relation.edge.to;
    const payerCards = resolveNodePartyCardsById(sourceId, activeTab);
    const payeeCards = resolveNodePartyCardsById(targetId, activeTab);
    if (!payerCards.length || !payeeCards.length) {
      setError('当前交易线缺少明细定位字段');
      return;
    }
    setDetailAnalysisLoadingEdgeIds((current) => ({ ...current, [relation.edgeId]: true }));
    loadCaseGraphTargetDetail(
      {
        graphId: activeTab.graphId,
        caseId: activeTab.caseId,
        payerCards,
        payeeCards,
        limit: 5000,
      },
      token,
    )
      .then((detail) => {
        setDetailAnalysisByEdgeId((current) => ({
          ...current,
          [relation.edgeId]: filterEdgeDetailItemsForGraphEdge(detail, relation.edge.tradeIds, activeTab.excludedTrades),
        }));
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '交易核查加载失败');
      })
      .finally(() => {
        setDetailAnalysisLoadingEdgeIds((current) => ({ ...current, [relation.edgeId]: false }));
      });
  }, [activeTab, detailAnalysisByEdgeId, detailAnalysisLoadingEdgeIds, token]);

  const handleToggleDetailAnalysisTrade = useCallback((tradeId: string) => {
    setDetailAnalysisSelectedTradeIds((current) => setTradeSelection(current, [tradeId], !current.includes(tradeId)));
  }, []);

  const handleSetDetailAnalysisTrades = useCallback((tradeIds: string[], selected: boolean) => {
    setDetailAnalysisSelectedTradeIds((current) => setTradeSelection(current, tradeIds, selected));
  }, []);

  const handleCloseDetailAnalysis = useCallback(() => {
    setDetailAnalysisNode(null);
    setDetailAnalysisByEdgeId({});
    setDetailAnalysisLoadingEdgeIds({});
    setDetailAnalysisSelectedTradeIds([]);
    setDetailAnalysisApplying(false);
  }, []);

  const handleApplyDetailAnalysis = useCallback((evidence?: CaseGraphOperationEvidence) => {
    if (!activeTab || !detailAnalysisSelectedTradeIds.length) return;
    const tradeFacts = buildTradeFactsFromDetails(detailAnalysisByEdgeId);
    const edgeTradeIds = buildEdgeTradeIdsFromDetails(detailAnalysisByEdgeId);
    if (!Object.keys(edgeTradeIds).length) {
      setError('请先加载至少一条交易线的明细');
      return;
    }
    if (!evidence) {
      confirmOperationEvidence(
        'exclude_trades',
        '排除交易流水',
        `将从当前图中排除 ${detailAnalysisSelectedTradeIds.length} 笔交易流水，并重新计算相关资金线。`,
        (nextEvidence) => handleApplyDetailAnalysis(nextEvidence),
      );
      return;
    }
    setReplaySelection(null);
    setDetailAnalysisApplying(true);
    excludeCaseGraphTrades(
      {
        caseId: activeTab.caseId,
        graphId: activeTab.graphId,
        excludedTrades: buildAppliedExcludedTradeIds(activeTab.excludedTrades, detailAnalysisSelectedTradeIds),
        tradeFacts,
        edgeTradeIds,
        options: buildRelationOptions(activeTab.graphData, graphNodePositionsRef.current),
        evidence,
      },
      token,
    )
      .then((result) => {
        applyRelationResultToActiveTab(result);
        void refreshGraphSteps(activeTab);
        handleCloseDetailAnalysis();
        setError(null);
        requestGraphStepInsight(result, activeTab);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '交易核查失败');
      })
      .finally(() => {
        setDetailAnalysisApplying(false);
      });
  }, [
    activeTab,
    applyRelationResultToActiveTab,
    confirmOperationEvidence,
    detailAnalysisByEdgeId,
    detailAnalysisSelectedTradeIds,
    handleCloseDetailAnalysis,
    refreshGraphSteps,
    requestGraphStepInsight,
    token,
  ]);

  const handleOpenNodeSummaryAnalysis = useCallback((node: CaseGraphNode) => {
    if (!activeTab) return;
    setReplaySelection(null);
    setSummaryAnalysisOpen(true);
    setSummaryAnalysisScope('node');
    setSummaryAnalysisNode(node);
    setSummaryAnalysisItems([]);
    setSummaryAnalysisSelectedNodeIds([]);
    setSummaryAnalysisLoading(true);
    setSummaryOperationEvidence(emptyOperationEvidence('candidate_subject_changes'));
    syncGraphContext({
      type: 'node',
      graphId: activeTab.graphId,
      caseId: activeTab.caseId,
      graphName: activeTab.graphName,
      nodeId: node.id,
      label: node.label || node.name || node.accountName,
      accountId: node.accountId ?? null,
      accountName: node.accountName || node.label || node.name,
      tradeCard: node.tradeCard,
    });
    loadCaseGraphSummaryCandidates(
      {
        caseId: activeTab.caseId,
        graphId: activeTab.graphId,
        focusNodeId: node.id,
        direction: 'both',
      },
      token,
    )
      .then((result) => {
        const items = Array.isArray(result.items) ? result.items : [];
        setSummaryAnalysisItems(items);
        setSummaryAnalysisSelectedNodeIds([]);
        if (!items.length) {
          setError('当前主体暂时没有可管理的关联主体');
        } else {
          setError(null);
        }
      })
      .catch((err: unknown) => {
        setSummaryAnalysisNode(null);
        setSummaryAnalysisItems([]);
        setSummaryAnalysisSelectedNodeIds([]);
        setError(err instanceof Error ? err.message : '综合筛选读取失败');
      })
      .finally(() => {
        setSummaryAnalysisLoading(false);
      });
  }, [activeTab, syncGraphContext, token]);

  const handleOpenGlobalSummaryAnalysis = useCallback(() => {
    if (!activeTab) return;
    setReplaySelection(null);
    setSummaryAnalysisOpen(true);
    setSummaryAnalysisScope('global');
    setSummaryAnalysisNode(null);
    setSummaryAnalysisItems([]);
    setSummaryAnalysisSelectedNodeIds([]);
    setSummaryAnalysisLoading(true);
    setSummaryOperationEvidence(emptyOperationEvidence('candidate_subject_changes'));
    syncGraphContext(null);
    loadCaseGraphSummaryCandidates(
      {
        caseId: activeTab.caseId,
        graphId: activeTab.graphId,
        scope: 'global',
        direction: 'both',
      },
      token,
    )
      .then((result) => {
        const items = Array.isArray(result.items) ? result.items : [];
        setSummaryAnalysisItems(items);
        setSummaryAnalysisSelectedNodeIds([]);
        if (!items.length) {
          setError('案件交易流水中暂时没有可综合筛选的主体');
        } else {
          setError(null);
        }
      })
      .catch((err: unknown) => {
        setSummaryAnalysisOpen(false);
        setSummaryAnalysisScope('node');
        setSummaryAnalysisNode(null);
        setSummaryAnalysisItems([]);
        setSummaryAnalysisSelectedNodeIds([]);
        setError(err instanceof Error ? err.message : '综合筛选读取失败');
      })
      .finally(() => {
        setSummaryAnalysisLoading(false);
      });
  }, [activeTab, syncGraphContext, token]);

  const handleCloseSummaryAnalysis = useCallback(() => {
    setSummaryAnalysisOpen(false);
    setSummaryAnalysisScope('node');
    setSummaryAnalysisNode(null);
    setSummaryAnalysisItems([]);
    setSummaryAnalysisSelectedNodeIds([]);
    setSummaryAnalysisLoading(false);
    setSummaryAnalysisApplying(false);
    setSummaryOperationEvidence(emptyOperationEvidence('candidate_subject_changes'));
  }, []);

  const handleToggleSummaryAnalysisNode = useCallback((nodeId: string) => {
    setSummaryAnalysisSelectedNodeIds((current) => (
      current.includes(nodeId)
        ? current.filter((item) => item !== nodeId)
        : [...current, nodeId]
    ));
  }, []);

  const handleSetSummaryAnalysisNodes = useCallback((nodeIds: string[], selected: boolean) => {
    setSummaryAnalysisSelectedNodeIds((current) => setTradeSelection(current, nodeIds, selected));
  }, []);

  const handleApplySummaryAnalysis = useCallback(() => {
    if (!activeTab || (summaryAnalysisScope === 'node' && !summaryAnalysisNode)) return;
    const items = summaryAnalysisItems;
    const candidateNodeIds = items.map((item) => item.nodeId).filter(Boolean);
    if (!candidateNodeIds.length) {
      setError(summaryAnalysisScope === 'global' ? '案件交易流水中暂时没有可综合筛选的主体' : '当前主体暂时没有可管理的关联主体');
      return;
    }
    const selectedItems = items.filter((item) => summaryAnalysisSelectedNodeIds.includes(item.nodeId));
    if (!selectedItems.length) {
      setError('请选择需要处理的主体');
      return;
    }
    const candidateNodeIdSet = new Set(candidateNodeIds);
    const includeItems = selectedItems.filter((item) => summaryAnalysisItemAction(item) !== 'exclude');
    const excludeItems = selectedItems.filter((item) => summaryAnalysisItemAction(item) === 'exclude');
    const selectedCandidates = includeItems
      .map((item) => ({ nodeId: item.nodeId, label: item.label, accounts: item.accounts ?? [] }));
    const selectedIncludeNodeIds = includeItems.map((item) => item.nodeId).filter((nodeId) => candidateNodeIdSet.has(nodeId));
    const excludedNodePayloads = buildExcludedNodePayloadsFromSummaryItems(excludeItems, activeTab);
    setReplaySelection(null);
    setSummaryAnalysisApplying(true);
    let latestResult: CaseGraphRelationResponse | null = null;
    const excludeTask = excludedNodePayloads.length
      ? excludeCaseGraphNode(
        {
          caseId: activeTab.caseId,
          graphId: activeTab.graphId,
          nodes: excludedNodePayloads,
          evidence: summaryOperationEvidence,
          evidenceContext: 'candidate_subject_changes',
        },
        token,
      ).then((result) => {
        latestResult = result;
        return result;
      })
      : Promise.resolve(null as CaseGraphRelationResponse | null);

    excludeTask
      .then(() => {
        if (!selectedIncludeNodeIds.length) {
          return Promise.resolve(null as CaseGraphRelationResponse | null);
        }
        return applyCaseGraphSummarySelection(
          {
            caseId: activeTab.caseId,
            graphId: activeTab.graphId,
            focusNodeId: summaryAnalysisScope === 'node' ? summaryAnalysisNode?.id ?? null : null,
            scope: summaryAnalysisScope,
            candidateNodeIds,
            selectedNodeIds: selectedIncludeNodeIds,
            selectedCandidates,
            options: buildRelationOptions(activeTab.graphData, graphNodePositionsRef.current),
            evidence: summaryOperationEvidence,
          },
          token,
        ).then((result) => {
          latestResult = result;
          return result;
        });
      })
      .then((result) => {
        if (result) {
          applyRelationResultToActiveTab(result);
          requestGraphStepInsight(result, activeTab);
        } else if (latestResult) {
          applyRelationResultToActiveTab(latestResult);
          requestGraphStepInsight(latestResult, activeTab);
        } else if (excludedNodePayloads.length) {
          return loadCaseGraphState(activeTab.caseId, activeTab.graphId, token).then((state) => {
            applyRelationResultToActiveTab({ graph: state.graph, graphState: state });
            return null;
          });
        }
        return null;
      })
      .then(() => {
        void refreshGraphSteps(activeTab);
        handleCloseSummaryAnalysis();
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '综合筛选操作失败');
      })
      .finally(() => {
        setSummaryAnalysisApplying(false);
      });
  }, [
    activeTab,
    applyRelationResultToActiveTab,
    handleCloseSummaryAnalysis,
    refreshGraphSteps,
    requestGraphStepInsight,
    summaryAnalysisNode,
    summaryAnalysisScope,
    summaryOperationEvidence,
    summaryAnalysisItems,
    summaryAnalysisSelectedNodeIds,
    token,
  ]);

  const handleApplySummaryAnalysisItemAction = useCallback((nodeId: string, action: SummaryAnalysisItemAction) => {
    if (!activeTab || (summaryAnalysisScope === 'node' && !summaryAnalysisNode)) return;
    const item = summaryAnalysisItems.find((candidate) => candidate.nodeId === nodeId);
    if (!item) return;
    setReplaySelection(null);
    setSummaryAnalysisApplying(true);
    const candidateNodeIds = summaryAnalysisItems.map((candidate) => candidate.nodeId).filter(Boolean);
    const run = (): Promise<CaseGraphRelationResponse | null> => {
      if (action === 'exclude') {
        const [payload] = buildExcludedNodePayloadsFromSummaryItems([item], activeTab);
        if (!payload) {
          return Promise.reject(new Error('没有找到可取消上图的主体'));
        }
        return excludeCaseGraphNode({
          caseId: activeTab.caseId,
          graphId: activeTab.graphId,
          node: payload,
          evidence: summaryOperationEvidence,
          evidenceContext: 'candidate_subject_changes',
        }, token);
      }
      return applyCaseGraphSummarySelection(
        {
          caseId: activeTab.caseId,
          graphId: activeTab.graphId,
          focusNodeId: summaryAnalysisScope === 'node' ? summaryAnalysisNode?.id ?? null : null,
          scope: summaryAnalysisScope,
          candidateNodeIds,
          selectedNodeIds: [nodeId],
          selectedCandidates: [{ nodeId: item.nodeId, label: item.label, accounts: item.accounts ?? [] }],
          options: buildRelationOptions(activeTab.graphData, graphNodePositionsRef.current),
          evidence: summaryOperationEvidence,
        },
        token,
      );
    };
    run()
      .then((result) => {
        if (result) {
          applyRelationResultToActiveTab(result);
          void refreshGraphSteps(activeTab);
          handleCloseSummaryAnalysis();
          setError(null);
          requestGraphStepInsight(result, activeTab);
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '综合筛选操作失败');
      })
      .finally(() => {
        setSummaryAnalysisApplying(false);
      });
  }, [
    activeTab,
    applyRelationResultToActiveTab,
    handleCloseSummaryAnalysis,
    refreshGraphSteps,
    requestGraphStepInsight,
    summaryAnalysisItems,
    summaryAnalysisNode,
    summaryAnalysisScope,
    summaryOperationEvidence,
    token,
  ]);

  const handleOpenManualTrade = useCallback((node?: CaseGraphNode | null) => {
    if (!activeTab) return;
    setReplaySelection(null);
    setManualClueMode('trade');
    setManualClueFocusNode(node ?? null);
    setManualCluePosition(null);
    setManualClueOpen(true);
    syncGraphContext(node ? {
      type: 'node',
      graphId: activeTab.graphId,
      caseId: activeTab.caseId,
      graphName: activeTab.graphName,
      nodeId: node.id,
      label: node.label || node.name || node.accountName,
      accountId: node.accountId ?? null,
      accountName: node.accountName || node.label || node.name,
      tradeCard: node.tradeCard,
    } : null);
  }, [activeTab, syncGraphContext]);

  const handleOpenManualNode = useCallback((position?: { x: number; y: number } | null) => {
    if (!activeTab) return;
    setReplaySelection(null);
    setManualClueMode('node');
    setManualClueFocusNode(null);
    setManualCluePosition(position ?? null);
    setManualClueOpen(true);
    syncGraphContext(null);
  }, [activeTab, syncGraphContext]);

  const handleOpenRealityRelation = useCallback((node?: CaseGraphNode | null) => {
    if (!activeTab) return;
    setReplaySelection(null);
    setManualClueMode('relation');
    setManualClueFocusNode(node ?? null);
    setManualCluePosition(null);
    setManualClueOpen(true);
    syncGraphContext(node ? {
      type: 'node',
      graphId: activeTab.graphId,
      caseId: activeTab.caseId,
      graphName: activeTab.graphName,
      nodeId: node.id,
      label: node.label || node.name || node.accountName,
      accountId: node.accountId ?? null,
      accountName: node.accountName || node.label || node.name,
      tradeCard: node.tradeCard,
    } : null);
  }, [activeTab, syncGraphContext]);

  const handleCloseManualClue = useCallback(() => {
    setManualClueOpen(false);
    setManualClueFocusNode(null);
    setManualCluePosition(null);
    setManualClueApplying(false);
  }, []);

  const handleApplyManualNode = useCallback((form: Omit<AddCaseGraphManualNodePayload, 'caseId' | 'graphId' | 'options'>) => {
    if (!activeTab) return;
    setReplaySelection(null);
    setManualClueApplying(true);
    addCaseGraphManualNode(
      {
        caseId: activeTab.caseId,
        graphId: activeTab.graphId,
        ...form,
        options: buildRelationOptions(activeTab.graphData, graphNodePositionsRef.current),
      },
      token,
    )
      .then((result) => {
        applyRelationResultToActiveTab(result);
        void refreshGraphSteps(activeTab);
        handleCloseManualClue();
        setError(null);
        requestGraphStepInsight(result, activeTab);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '创建交易主体失败');
      })
      .finally(() => {
        setManualClueApplying(false);
      });
  }, [activeTab, applyRelationResultToActiveTab, handleCloseManualClue, refreshGraphSteps, requestGraphStepInsight, token]);

  const handleApplyManualTrade = useCallback((form: Omit<AddCaseGraphManualTradePayload, 'caseId' | 'graphId' | 'options'>) => {
    if (!activeTab) return;
    setReplaySelection(null);
    setManualClueApplying(true);
    addCaseGraphManualTrade(
      {
        caseId: activeTab.caseId,
        graphId: activeTab.graphId,
        ...form,
        options: buildRelationOptions(activeTab.graphData, graphNodePositionsRef.current),
      },
      token,
    )
      .then((result) => {
        applyRelationResultToActiveTab(result);
        void refreshGraphSteps(activeTab);
        handleCloseManualClue();
        setError(null);
        requestGraphStepInsight(result, activeTab);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '补充资金往来失败');
      })
      .finally(() => {
        setManualClueApplying(false);
      });
  }, [activeTab, applyRelationResultToActiveTab, handleCloseManualClue, refreshGraphSteps, requestGraphStepInsight, token]);

  const handleApplyRealityRelation = useCallback((form: Omit<AddCaseGraphRealityRelationPayload, 'caseId' | 'graphId' | 'options'>) => {
    if (!activeTab) return;
    setReplaySelection(null);
    setManualClueApplying(true);
    addCaseGraphRealityRelation(
      {
        caseId: activeTab.caseId,
        graphId: activeTab.graphId,
        ...form,
        options: buildRelationOptions(activeTab.graphData, graphNodePositionsRef.current),
      },
      token,
    )
      .then((result) => {
        applyRelationResultToActiveTab(result);
        void refreshGraphSteps(activeTab);
        handleCloseManualClue();
        setError(null);
        requestGraphStepInsight(result, activeTab);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '标注现实关系失败');
      })
      .finally(() => {
        setManualClueApplying(false);
      });
  }, [activeTab, applyRelationResultToActiveTab, handleCloseManualClue, refreshGraphSteps, requestGraphStepInsight, token]);

  const handleOpenInvestigationGroup = useCallback((nodes: CaseGraphNode[]) => {
    if (!activeTab) return;
    const validNodes = nodes.filter((node) => !node.isExcluded);
    if (validNodes.length < 2) {
      setError('请至少选择 2 个可上图主体进行归并');
      return;
    }
    setReplaySelection(null);
    setGroupDraftNodes(validNodes);
    const nextIndex = (activeTab.graphData?.investigationGroups?.length ?? 0) + 1;
    setGroupDraftForm({
      name: `研判组 ${nextIndex}`,
      groupType: '团伙成员',
      note: '',
    });
    setGroupOperationEvidence(emptyOperationEvidence('group_change'));
    setGroupDraftOpen(true);
  }, [activeTab]);

  const handleCloseInvestigationGroup = useCallback(() => {
    setGroupDraftOpen(false);
    setGroupDraftNodes([]);
    setGroupDraftForm({ name: '', groupType: '团伙成员', note: '' });
    setGroupOperationEvidence(emptyOperationEvidence('group_change'));
  }, []);

  const applyInvestigationGroupOperation = useCallback((operationPayload: Omit<ApplyCaseGraphInvestigationGroupPayload, 'caseId' | 'graphId' | 'options'>) => {
    if (!activeTab) return;
    setReplaySelection(null);
    setGroupOperationApplying(true);
    const positionedGraphData = applyNodePositions(activeTab.graphData, graphNodePositionsRef.current);
    const relationOptions = buildRelationOptions(positionedGraphData, graphNodePositionsRef.current);
    applyCaseGraphInvestigationGroup(
      {
        caseId: activeTab.caseId,
        graphId: activeTab.graphId,
        ...operationPayload,
        groupPosition: operationPayload.groupPosition
          ?? resolveInvestigationGroupOperationPosition(positionedGraphData, operationPayload),
        options: relationOptions,
      },
      token,
    )
      .then((result) => {
        const groupEvent = investigationGroupLayoutEvent(result.graph, operationPayload);
        applyRelationResultToActiveTab(result, groupEvent);
        void refreshGraphSteps(activeTab);
        setError(null);
        if (operationPayload.operation === 'create') {
          handleCloseInvestigationGroup();
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '研判组操作失败');
      })
      .finally(() => {
        setGroupOperationApplying(false);
      });
  }, [activeTab, applyRelationResultToActiveTab, handleCloseInvestigationGroup, refreshGraphSteps, token]);

  const handleUpdateNodeNote = useCallback((nodeId: string, input: { note: string; sourceNote?: string }) => {
    if (!activeTab) return;
    const note = input.note.trim();
    const sourceNote = (input.sourceNote || '').trim();
    setReplaySelection(null);
    saveCaseGraphNodeNote(
      activeTab.caseId,
      activeTab.graphId,
      {
        graphName: activeTab.graphName,
        nodeId,
        note,
        sourceNote,
      },
      token,
    )
      .then((state) => {
        updateActiveTab((current) => (
          current.graphId === activeTab.graphId
            ? { ...current, ...graphStateToTab(state, current), graphContent: current.graphContent, chatId: current.chatId }
            : current
        ));
        void refreshGraphSteps(activeTab);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '保存主体备注失败');
      });
  }, [activeTab, refreshGraphSteps, token, updateActiveTab]);

  const handleSubmitInvestigationGroup = useCallback(() => {
    if (!activeTab || groupDraftNodes.length < 2) return;
    const name = groupDraftForm.name.trim();
    applyInvestigationGroupOperation({
      operation: 'create',
      nodeIds: groupDraftNodes.map((node) => node.id),
      name: name || `研判组 ${(activeTab.graphData?.investigationGroups?.length ?? 0) + 1}`,
      groupType: groupDraftForm.groupType,
      note: groupDraftForm.note,
      collapsed: true,
      evidence: groupOperationEvidence,
    });
  }, [activeTab, applyInvestigationGroupOperation, groupDraftForm.groupType, groupDraftForm.name, groupDraftForm.note, groupDraftNodes, groupOperationEvidence]);

  const removeTabLocally = useCallback((graphId: string) => {
    setGraphTabs((current) => current.filter((item) => item.graphId !== graphId));
    setActiveTabId((current) => {
      if (current !== graphId) return current;
      const rest = graphTabs.filter((item) => item.graphId !== graphId);
      return rest.at(-1)?.graphId ?? null;
    });
  }, [graphTabs]);

  const handleConfirmDeleteGraph = useCallback(() => {
    if (!deleteGraphTarget) return;
    const graphId = deleteGraphTarget.graphId;
    const chatId = deleteGraphTarget.chatId.trim();
    setRequests((current) => ({ ...current, deleting: true }));
    deleteCaseGraph(graphId, token)
      .then(() => {
        if (chatId) {
          appStore.dispatch({ type: 'server.event', event: { type: 'session.deleted', chatId } });
        }
        removeTabLocally(graphId);
        setSavedGraphs((current) => current.filter((item) => item.graphId !== graphId));
        if (activeTabId === graphId) {
          setConversationFocus(null);
          setEdgeDetailOpen(false);
          setEdgeDetail(null);
          setEdgeDetailPartyContext(null);
          setDetailView(null);
          appStore.dispatch({ type: 'workspace.close' });
        }
        setDeleteGraphTarget(null);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '删除图失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, deleting: false }));
      });
  }, [activeTabId, deleteGraphTarget, removeTabLocally, token]);

  const openGraphConfigDialog = useCallback(() => {
    if (!activeTab) {
      setError('请先新增图形或打开已有图');
      return;
    }
    setGraphConfigForm({
      drillNums: String(activeTab.drillNums || 10),
      drillType: String(activeTab.drillType ?? 1),
      minAmount: activeTab.minAmount == null || activeTab.minAmount === '' ? '' : String(activeTab.minAmount),
      maxAmount: activeTab.maxAmount == null || activeTab.maxAmount === '' ? '' : String(activeTab.maxAmount),
    });
    setGraphConfigEvidence(emptyOperationEvidence('drill_with_changed_settings'));
    setGraphConfigDialogOpen(true);
  }, [activeTab]);

  const handleSaveGraphConfig = useCallback(() => {
    if (!activeTab) return;
    const drillNums = Number.parseInt(graphConfigForm.drillNums, 10);
    const drillType = Number.parseInt(graphConfigForm.drillType, 10);
    if (!Number.isFinite(drillNums) || drillNums <= 0) {
      setError('上下钻个数需要是大于 0 的整数');
      return;
    }
    const minAmount = graphConfigForm.minAmount.trim() ? Number(graphConfigForm.minAmount) : null;
    const maxAmount = graphConfigForm.maxAmount.trim() ? Number(graphConfigForm.maxAmount) : null;
    if (minAmount != null && !Number.isFinite(minAmount)) {
      setError('最小金额格式不正确');
      return;
    }
    if (maxAmount != null && !Number.isFinite(maxAmount)) {
      setError('最大金额格式不正确');
      return;
    }
    if (minAmount != null && maxAmount != null && minAmount > maxAmount) {
      setError('最小金额不能大于最大金额');
      return;
    }
    setReplaySelection(null);
    setRequests((current) => ({ ...current, querying: true }));
    updateCaseGraphConfig(
      activeTab.graphId,
      {
        drillNums,
        drillType,
        minAmount,
        maxAmount,
      },
      token,
    )
      .then((graph) => {
        setGraphTabs((current) =>
          current.map((tab) =>
            tab.graphId === graph.graph_id
              ? {
                  ...tab,
                  drillNums: Number(graph.drillNums || drillNums),
                  drillType: graph.drillType ?? drillType,
                  minAmount: graph.minAmount ?? minAmount,
                  maxAmount: graph.maxAmount ?? maxAmount,
                  pendingDrillEvidence: graphConfigEvidence,
                }
              : tab,
          ),
        );
        setSavedGraphs((current) =>
          current.map((item) => (item.graphId === graph.graph_id ? { ...item, chatId: graph.chatId || item.chatId } : item)),
        );
        appStore.dispatch({ type: 'caseGraph.graph.loaded', graph });
        setGraphConfigDialogOpen(false);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '更新分析配置失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, querying: false }));
      });
  }, [activeTab, graphConfigEvidence, graphConfigForm, token]);

  const graphActionBusy = requests.querying || requests.drilling || requests.filtering || requests.excluding || requests.creating || requests.deleting || summaryAnalysisApplying || manualClueApplying || groupOperationApplying;

  const previewCaseGraphAction = useCallback((action: CaseGraphChatAction): CaseGraphActionPreview => {
    const title = caseGraphActionTitle(action);
    const summary = caseGraphActionSummary(action);
    if (!activeTab) {
      return { title, summary, disabledReason: '请先打开或新增一张图谱' };
    }
    if (replayActive) {
      return { title, summary, disabledReason: '历史回放状态下不能直接改图，请先回到当前状态' };
    }
    if (graphActionBusy) {
      return { title, summary, disabledReason: '当前图谱操作还在执行，请稍后再试' };
    }
    if (action.type === 'filter') {
      if (!activeTab.graphData?.nodes.length) {
        return { title, summary, disabledReason: '当前图上还没有可筛选的数据' };
      }
      if (!action.filters || !Object.keys(action.filters).length) {
        return { title, summary, disabledReason: '这条筛选指令缺少金额或时间条件' };
      }
      const validationError = validateFilterState(mergeActionFilters(currentFilterState(activeTab), action.filters));
      return validationError ? { title, summary, disabledReason: validationError } : { title, summary };
    }
    if (action.type === 'reset_filter') {
      return { title, summary: '清空金额和时间筛选输入，后续可重新设置筛选条件' };
    }
    if (action.type === 'complete_relation') {
      if (resolveGraphAccounts(activeTab).length < 2) {
        return { title, summary, disabledReason: '当前图上至少需要两个账号节点才能补全关系' };
      }
      return { title, summary };
    }
    if (action.type === 'restore_node') {
      if (action.all) {
        return activeTab.excludedNodes.length
          ? { title, summary: `恢复已取消上图的 ${activeTab.excludedNodes.length} 个主体` }
          : { title, summary, disabledReason: '当前没有已取消上图的主体' };
      }
      const excluded = resolveExcludedNodeForAction(action, activeTab);
      return excluded.error ? { title, summary, disabledReason: excluded.error } : { title, summary };
    }
    if (action.type === 'extend_clues') {
      const scope = resolveClueExtensionScopeForAction(action, activeTab, conversationFocus);
      if (scope.error) {
        return { title, summary, disabledReason: scope.error };
      }
      return { title, summary: `${summary}；确认后会综合筛选主体并把符合条件的结果加入当前图` };
    }
    if (action.type === 'create_subject') {
      if (!action.subjectName?.trim()) {
        return { title, summary, disabledReason: '请说明要创建的交易主体名称' };
      }
      if (!(action.discoveryReason?.trim() || action.sourceNote?.trim() || action.note?.trim() || action.reason?.trim())) {
        return { title, summary, disabledReason: '请说明主体的发现原因、来源材料或情况说明' };
      }
      return { title, summary: `${summary}；确认后会在当前图上创建这个交易主体` };
    }
    if (action.type === 'add_manual_trade') {
      const form = buildManualTradeFormForAction(action, activeTab);
      if (form.error) {
        return { title, summary, disabledReason: form.error };
      }
      if (!(form.payload?.sourceNote?.trim() || form.payload?.summary?.trim())) {
        return { title, summary, disabledReason: '请说明这笔资金往来的线索来源或情况说明' };
      }
      return { title, summary: `${summary}；确认后会把这笔资金往来补充到当前图` };
    }
    if (action.type === 'add_reality_relation') {
      const form = buildRealityRelationFormForAction(action, activeTab);
      if (form.error) {
        return { title, summary, disabledReason: form.error };
      }
      if (!form.payload?.note?.trim()) {
        return { title, summary, disabledReason: '请说明现实关系的事实来源' };
      }
      return { title, summary: `${summary}；确认后会在当前图上标注这条现实关系` };
    }
    if (action.type === 'exclude_trades' || action.type === 'restore_trades') {
      const resolvedTrades = resolveTradeIdsForAction(action, activeTab, conversationFocus);
      if (resolvedTrades.error) {
        return { title, summary, disabledReason: resolvedTrades.error };
      }
      const verb = action.type === 'restore_trades' ? '恢复' : '排除';
      return { title, summary: `${summary}；预计${verb} ${resolvedTrades.tradeIds.length} 笔交易流水` };
    }
    const resolved = resolveNodeForAction(action, activeTab, conversationFocus);
    if (resolved.error) {
      return { title, summary, disabledReason: resolved.error };
    }
    if (action.type === 'drill' && resolved.node) {
      const tradeCard = resolveTradeCardForGraphNode(resolved.node, availableAccounts);
      if (!tradeCard) {
        return { title, summary, disabledReason: '目标主体缺少账号信息，无法上下钻' };
      }
    }
    if (action.type === 'exclude_node' && resolved.node?.isExcluded) {
      return { title, summary, disabledReason: '该主体已经取消上图' };
    }
    return { title, summary };
  }, [activeTab, availableAccounts, conversationFocus, graphActionBusy, replayActive]);

  const executeCaseGraphAction = useCallback(async (action: CaseGraphChatAction) => {
    const preview = previewCaseGraphAction(action);
    if (preview.disabledReason) {
      showFlash(preview.disabledReason);
      return;
    }
    if (!activeTab) {
      return;
    }
    const requiredEvidenceOperation = requiredEvidenceOperationForChatAction(action);
    const actionEvidence = requiredEvidenceOperation
      ? await requestOperationEvidence(
          requiredEvidenceOperation,
          preview.title,
          `${preview.summary}。请记录本次操作依据。`,
        )
      : undefined;
    if (requiredEvidenceOperation && !actionEvidence) {
      return;
    }
    if (action.type === 'filter') {
      await applyCaseGraphFilterState(mergeActionFilters(currentFilterState(activeTab), action.filters ?? {}));
      return;
    }
    if (action.type === 'reset_filter') {
      updateActiveTab((tab) => ({
        ...tab,
        minAmount: '',
        maxAmount: '',
        startTime: '',
        endTime: '',
        appliedFilters: emptyFilterState(),
      }));
      showFlash('已清空图谱筛选条件');
      return;
    }
    if (action.type === 'complete_relation') {
      handleCompleteGraphRelations(actionEvidence ?? undefined);
      return;
    }
    if (action.type === 'create_subject') {
      setReplaySelection(null);
      setManualClueApplying(true);
      addCaseGraphManualNode(
        {
          caseId: activeTab.caseId,
          graphId: activeTab.graphId,
          label: action.subjectName?.trim() || '',
          tradeCard: action.subjectTradeCard?.trim() || undefined,
          discoveryReason: action.discoveryReason?.trim() || undefined,
          sourceNote: action.sourceNote?.trim() || undefined,
          note: action.note?.trim() || action.reason?.trim() || undefined,
          options: buildRelationOptions(activeTab.graphData, graphNodePositionsRef.current),
        },
        token,
      )
        .then((result) => {
          applyRelationResultToActiveTab(result);
          void refreshGraphSteps(activeTab);
          setError(null);
          requestGraphStepInsight(result, activeTab);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : '创建交易主体失败');
        })
        .finally(() => {
          setManualClueApplying(false);
        });
      return;
    }
    if (action.type === 'add_manual_trade') {
      const form = buildManualTradeFormForAction(action, activeTab);
      if (form.error || !form.payload) {
        showFlash(form.error || '补充资金往来缺少必要信息');
        return;
      }
      setReplaySelection(null);
      setManualClueApplying(true);
      addCaseGraphManualTrade(
        {
          caseId: activeTab.caseId,
          graphId: activeTab.graphId,
          ...form.payload,
          options: buildRelationOptions(activeTab.graphData, graphNodePositionsRef.current),
        },
        token,
      )
        .then((result) => {
          applyRelationResultToActiveTab(result);
          void refreshGraphSteps(activeTab);
          setError(null);
          requestGraphStepInsight(result, activeTab);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : '补充资金往来失败');
        })
        .finally(() => {
          setManualClueApplying(false);
        });
      return;
    }
    if (action.type === 'add_reality_relation') {
      const form = buildRealityRelationFormForAction(action, activeTab);
      if (form.error || !form.payload) {
        showFlash(form.error || '标注现实关系缺少必要信息');
        return;
      }
      setReplaySelection(null);
      setManualClueApplying(true);
      addCaseGraphRealityRelation(
        {
          caseId: activeTab.caseId,
          graphId: activeTab.graphId,
          ...form.payload,
          options: buildRelationOptions(activeTab.graphData, graphNodePositionsRef.current),
        },
        token,
      )
        .then((result) => {
          applyRelationResultToActiveTab(result);
          void refreshGraphSteps(activeTab);
          setError(null);
          requestGraphStepInsight(result, activeTab);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : '标注现实关系失败');
        })
        .finally(() => {
          setManualClueApplying(false);
        });
      return;
    }
    if (action.type === 'restore_node') {
      if (action.all) {
        handleRestoreAllExcludedNodes();
        return;
      }
      const excluded = resolveExcludedNodeForAction(action, activeTab);
      if (excluded.node) {
        handleRestoreNode(excluded.node.nodeId);
      }
      return;
    }
    if (action.type === 'extend_clues') {
      const scope = resolveClueExtensionScopeForAction(action, activeTab, conversationFocus);
      if (scope.error) {
        showFlash(scope.error);
        return;
      }
      setReplaySelection(null);
      setSummaryAnalysisApplying(true);
      loadCaseGraphSummaryCandidates(
        {
          caseId: activeTab.caseId,
          graphId: activeTab.graphId,
          focusNodeId: scope.node?.id ?? null,
          scope: scope.scope,
          direction: normalizeActionDirectionForExecute(action.direction),
        },
        token,
      )
        .then((result) => {
          const items = Array.isArray(result.items) ? result.items : [];
          const selectedItems = filterSummaryCandidatesForAction(items, action);
          if (!selectedItems.length) {
            throw new Error('没有找到符合条件的主体');
          }
          return applyCaseGraphSummarySelection(
            {
              caseId: activeTab.caseId,
              graphId: activeTab.graphId,
              focusNodeId: scope.node?.id ?? null,
              scope: scope.scope,
              direction: normalizeActionDirectionForExecute(action.direction),
              candidateNodeIds: items.map((item) => item.nodeId).filter(Boolean),
              selectedNodeIds: selectedItems.map((item) => item.nodeId).filter(Boolean),
              selectedCandidates: selectedItems.map((item) => ({ nodeId: item.nodeId, label: item.label, accounts: item.accounts ?? [] })),
              filters: action.filters ?? {},
              options: buildRelationOptions(activeTab.graphData, graphNodePositionsRef.current),
            },
            token,
          );
        })
        .then((result) => {
          applyRelationResultToActiveTab(result);
          void refreshGraphSteps(activeTab);
          setError(null);
          requestGraphStepInsight(result, activeTab);
        })
      .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : '综合筛选操作失败');
        })
        .finally(() => {
          setSummaryAnalysisApplying(false);
        });
      return;
    }
    if (action.type === 'exclude_trades' || action.type === 'restore_trades') {
      const resolvedTrades = resolveTradeIdsForAction(action, activeTab, conversationFocus);
      if (resolvedTrades.error || !resolvedTrades.tradeIds.length) {
        showFlash(resolvedTrades.error || '没有找到符合条件的交易流水');
        return;
      }
      const tradeSet = new Set(resolvedTrades.tradeIds.map((tradeId) => String(tradeId || '').trim()).filter(Boolean));
      const nextExcludedTrades = action.type === 'restore_trades'
        ? activeTab.excludedTrades.filter((tradeId) => !tradeSet.has(String(tradeId || '').trim()))
        : buildAppliedExcludedTradeIds(activeTab.excludedTrades, resolvedTrades.tradeIds);
      setReplaySelection(null);
      setRequests((current) => ({ ...current, excluding: true }));
      excludeCaseGraphTrades(
        {
          caseId: activeTab.caseId,
          graphId: activeTab.graphId,
          excludedTrades: nextExcludedTrades,
          tradeFacts: activeTab.tradeFacts ?? activeTab.graphData?.tradeFacts ?? {},
          edgeTradeIds: buildEdgeTradeIdsFromGraph(activeTab.graphData),
          options: buildRelationOptions(activeTab.graphData, graphNodePositionsRef.current),
          evidence: action.type === 'exclude_trades'
            ? actionEvidence!
            : emptyOperationEvidence('restore_trades'),
        },
        token,
      )
        .then((result) => {
          applyRelationResultToActiveTab(result);
          void refreshGraphSteps(activeTab);
          setError(null);
          requestGraphStepInsight(result, activeTab);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : '交易流水操作失败');
        })
        .finally(() => {
          setRequests((current) => ({ ...current, excluding: false }));
        });
      return;
    }
    const resolved = resolveNodeForAction(action, activeTab, conversationFocus);
    if (!resolved.node) {
      showFlash(resolved.error || '没有找到目标主体');
      return;
    }
    if (action.type === 'drill') {
      handleDrill(
        normalizeActionDirectionForExecute(action.direction),
        resolved.node,
        resolveTradeCardForGraphNode(resolved.node, availableAccounts),
      );
      return;
    }
    if (action.type === 'exclude_node') {
      handleExcludeNode(buildExcludedNodePayloadFromGraphNode(resolved.node), actionEvidence ?? undefined);
    }
  }, [
    activeTab,
    applyCaseGraphFilterState,
    availableAccounts,
    conversationFocus,
    handleCompleteGraphRelations,
    handleDrill,
    handleExcludeNode,
    handleRestoreAllExcludedNodes,
    handleRestoreNode,
    applyRelationResultToActiveTab,
    refreshGraphSteps,
    requestGraphStepInsight,
    requestOperationEvidence,
    setSummaryAnalysisApplying,
    token,
    previewCaseGraphAction,
    showFlash,
    updateActiveTab,
  ]);

  const caseGraphActions = useMemo<CaseGraphActionContextValue>(() => ({
    preview: previewCaseGraphAction,
    execute: executeCaseGraphAction,
  }), [executeCaseGraphAction, previewCaseGraphAction]);

  const prepareCaseGraphOutgoingMessage = useCallback((
    message: Parameters<NonNullable<ComponentProps<typeof ChatWorkspace>['prepareOutgoingMessage']>>[0],
    { availableSkills }: Parameters<NonNullable<ComponentProps<typeof ChatWorkspace>['prepareOutgoingMessage']>>[1],
  ) => {
    const content = extractTextInput(message).trim();
    if (
      !content
      || selectedSkillNameFromRunConfig(message.runConfig)
      || /^使用\s+\S+\s+技能(?:\s|$)/.test(content)
      || !isCaseGraphOperationIntent(content)
    ) {
      return message;
    }
    const operatorSkill = findCaseGraphOperatorSkill(availableSkills);
    if (!operatorSkill?.name) {
      return message;
    }
    return {
      ...message,
      runConfig: runConfigWithSelectedSkill(message.runConfig, operatorSkill.name),
    };
  }, []);

  const renderChatHeader = useCallback(({
    currentChatId,
    availableSkills,
    fullscreen,
  }: ChatWorkspaceRenderContext & { fullscreen: boolean }) => {
    const caseGraphSkill = findCaseGraphSkill(availableSkills);
    const caseGraphOperatorSkill = findCaseGraphOperatorSkill(availableSkills);
    const caseGraphSkillLabel = formatCaseGraphSkillLabel(caseGraphSkill);
    const caseGraphOperatorSkillLabel = formatCaseGraphOperatorSkillLabel(caseGraphOperatorSkill);
    return (
      <div className={fullscreen ? 'case-graph-chat-fullscreen-header' : 'case-graph-chat-header'}>
        <div className="case-graph-chat-heading">
          <strong>图谱研判对话</strong>
          <span>{currentChatId ? `会话 ${currentChatId.slice(0, 8)}` : '将自动创建会话'}</span>
        </div>
        <div className="case-graph-chat-header-actions">
          {caseGraphSkill ? (
            <div className="case-graph-chat-skill-chip">{caseGraphSkillLabel}</div>
          ) : (
            <div className="case-graph-chat-skill-chip is-muted">未检测到图谱研判技能</div>
          )}
          {caseGraphOperatorSkill ? (
            <div className="case-graph-chat-skill-chip">{caseGraphOperatorSkillLabel}</div>
          ) : (
            <div className="case-graph-chat-skill-chip is-muted">未检测到图谱操作技能</div>
          )}
          <button
            type="button"
            className="case-graph-chat-expand-button"
            onClick={() => setChatFullscreen(!fullscreen)}
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            <span>{fullscreen ? '退出全屏' : '全屏'}</span>
          </button>
        </div>
      </div>
    );
  }, []);

  const renderComposerSuggestions = useCallback(({ availableSkills, sendAppendMessage }: ChatWorkspaceRenderContext) => {
    if (!quickPrompts.length) {
      return null;
    }
    return (
      <div className="case-graph-composer-suggestions" aria-label="图谱对话建议">
        {quickPrompts.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              className="case-graph-composer-suggestion"
              onClick={() => {
                if (item.action === 'open_origin_panel') {
                  handleOpenInvestigationOrigin();
                  return;
                }
                const message = buildTextAppendMessage(item.prompt);
                const caseGraphSkill = findCaseGraphSkill(availableSkills);
                if (caseGraphSkill?.name) {
                  message.runConfig = runConfigWithSelectedSkill(message.runConfig, caseGraphSkill.name);
                }
                void sendAppendMessage(message).catch((error: unknown) => {
                  showFlash(error instanceof Error ? error.message : '发送图谱研判消息失败');
                });
              }}
            >
              <Icon size={13} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    );
  }, [handleOpenInvestigationOrigin, quickPrompts, showFlash]);

  const handleExitChatFullscreen = useCallback(() => {
    setChatFullscreen(false);
    setContentPanelPinnedOpen(false);
    setDetailView(null);
    appStore.dispatch({ type: 'workspace.close' });
  }, []);

  const renderFullscreenTopControls = useCallback(() => (
    <div className="case-graph-chat-fullscreen-controls" role="group" aria-label="全屏对话操作">
      <button
        className="content-panel-toggle case-graph-chat-fullscreen-exit"
        type="button"
        aria-label="退出全屏"
        title="退出全屏"
        onClick={handleExitChatFullscreen}
      >
        <Minimize2 size={15} />
      </button>
      <button
        className={`content-panel-toggle case-graph-chat-fullscreen-panel-toggle${fullscreenPreviewOpen ? ' is-active' : ''}`}
        type="button"
        aria-label={fullscreenPreviewOpen ? '关闭内容区' : '打开内容区'}
        aria-pressed={fullscreenPreviewOpen}
        title={fullscreenPreviewOpen ? '关闭内容区' : '打开内容区'}
        onClick={toggleContentPanel}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M14 4v16" />
        </svg>
      </button>
    </div>
  ), [fullscreenPreviewOpen, handleExitChatFullscreen, toggleContentPanel]);

  return (
    <section className="case-graph-shell">
      <header className="case-graph-topbar">
        <div className="case-graph-topbar-leading">
          <div className="case-graph-topbar-entry">
            {headerSlot ?? (
              <button className="case-graph-back-button" type="button" onClick={onBack}>
                <ArrowLeft size={16} />
                <span>返回</span>
              </button>
            )}
          </div>

          {graphTabs.length ? (
            <div className="case-graph-topbar-tabs">
              <div className="case-graph-tabbar" aria-label="图形页签">
                {graphTabs.map((tab) => (
                  <button
                    key={tab.graphId}
                    type="button"
                    className={`case-graph-tab${tab.graphId === activeTabId ? ' is-active' : ''}`}
                    onClick={() => {
                      setActiveTabId(tab.graphId);
                      if (!tab.loaded) {
                        handleLoadGraph(tab.graphId);
                      }
                    }}
                  >
                    <span>{tab.graphName}</span>
                    <i
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteGraphTarget(tab);
                      }}
                    >
                      <X size={14} />
                    </i>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="case-graph-main-actions case-graph-main-actions--topbar">
          {onOpenSettings ? (
            <button className="case-graph-secondary-button case-graph-filter-button" type="button" onClick={onOpenSettings}>
              <Settings size={15} />
              <span>设置</span>
            </button>
          ) : null}
          <button className="case-graph-primary-button case-graph-cta" type="button" onClick={openNewGraphDialog}>
            <Plus size={16} />
            <span>新增</span>
          </button>
        </div>
      </header>

      {error ? (
        <div className="case-graph-error-banner" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="case-graph-layout">
        <section className="case-graph-main">
          <div className="case-graph-main-frame">
            <div className="case-graph-filter-bar" aria-label="图谱筛选条件">
              <div className="case-graph-filter-fields">
                <label className="case-graph-filter-field">
                  <span>金额</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="最小"
                    value={filterState.minAmount}
                    onChange={(event) => handleFilterFieldChange('minAmount', event.target.value)}
                    disabled={!activeTab || replayActive || requests.filtering}
                  />
                  <i />
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="最大"
                    value={filterState.maxAmount}
                    onChange={(event) => handleFilterFieldChange('maxAmount', event.target.value)}
                    disabled={!activeTab || replayActive || requests.filtering}
                  />
                </label>
                <label className="case-graph-filter-field case-graph-filter-field--wide">
                  <span>时间</span>
                  <CaseGraphDateInput
                    value={filterState.startTime}
                    onChange={(value) => handleFilterFieldChange('startTime', value)}
                    ariaLabel="开始时间"
                    placeholder="开始时间"
                    includeTime
                    disabled={!activeTab || replayActive || requests.filtering}
                  />
                  <i />
                  <CaseGraphDateInput
                    value={filterState.endTime}
                    onChange={(value) => handleFilterFieldChange('endTime', value)}
                    ariaLabel="结束时间"
                    placeholder="结束时间"
                    includeTime
                    disabled={!activeTab || replayActive || requests.filtering}
                  />
                </label>
              </div>
              <div className="case-graph-filter-actions">
                {filterDirty ? <span className="case-graph-filter-dirty">条件已修改</span> : null}
                <button
                  type="button"
                  className="case-graph-secondary-button case-graph-filter-button"
                  onClick={() => {
                    setExcludedDialogTab('nodes');
                    setExcludedDialogOpen(true);
                  }}
                  disabled={!activeTab || replayActive}
                >
                  <EyeOff size={14} />
                  <span>排除项 {(activeTab?.excludedNodes.length ?? 0) + (activeTab?.excludedTrades.length ?? 0)}</span>
                </button>
                <button
                  type="button"
                  className="case-graph-secondary-button case-graph-filter-button"
                  onClick={handleToggleShowExcludedNodes}
                  disabled={!activeTab || replayActive || !activeTab.excludedNodes.length}
                >
                  {activeTab?.showExcludedNodes ? <Eye size={14} /> : <EyeOff size={14} />}
                  <span>{activeTab?.showExcludedNodes ? '隐藏排除' : '显示排除'}</span>
                </button>
                <button
                  type="button"
                  className="case-graph-secondary-button case-graph-filter-button"
                  onClick={handleResetFilters}
                  disabled={!activeTab || replayActive || requests.filtering}
                >
                  <RotateCcw size={14} />
                  <span>重置</span>
                </button>
                <button
                  type="button"
                  className="case-graph-primary-button case-graph-filter-button"
                  onClick={handleApplyFilters}
                  disabled={!activeTab || replayActive || requests.filtering || requests.querying}
                >
                  <Filter size={14} />
                  <span>{requests.filtering ? '筛选中' : '应用筛选'}</span>
                </button>
              </div>
            </div>
            <GraphView
              graphData={visibleGraphData}
              graphContent={displayTab?.graphContent ?? null}
              groupMap={displayTab?.groupMap ?? {}}
              tradeCards={displayTab?.tradeCards ?? []}
              focusAccountIds={displayTab?.selectedAccountIds ?? []}
              focusLabels={focusLabels}
              loading={requests.querying}
              drilldownLoading={requests.drilling}
              hasActiveTab={Boolean(activeTab)}
              replayMode={replayActive}
              replayTimeline={replayTimeline}
              onChooseInvestigationOrigin={() => setOriginPanelOpen(true)}
              onCompleteGraphRelations={handleCompleteGraphRelations}
              onOpenGraphConfig={openGraphConfigDialog}
              onDrillDown={handleDrill}
              onOpenNodeSummaryAnalysis={(node) => {
                if (replayActive) {
                  return;
                }
                handleOpenNodeSummaryAnalysis(node);
              }}
              onOpenGlobalSummaryAnalysis={() => {
                if (replayActive) {
                  return;
                }
                handleOpenGlobalSummaryAnalysis();
              }}
              onOpenManualNode={(position) => {
                if (replayActive) {
                  return;
                }
                handleOpenManualNode(position);
              }}
              onOpenManualTrade={(node) => {
                if (replayActive) {
                  return;
                }
                handleOpenManualTrade(node);
              }}
              onOpenRealityRelation={(node) => {
                if (replayActive) {
                  return;
                }
                handleOpenRealityRelation(node);
              }}
              onExcludeNode={handleExcludeNode}
              onExcludeNodes={handleExcludeNodes}
              onRestoreNode={(nodeId) => {
                if (replayActive) {
                  return;
                }
                handleRestoreNode(nodeId);
              }}
              onCreateInvestigationGroup={(nodes) => {
                if (replayActive) {
                  return;
                }
                handleOpenInvestigationGroup(nodes);
              }}
              onToggleInvestigationGroup={(groupId, collapsed) => {
                if (replayActive) {
                  return;
                }
                applyInvestigationGroupOperation({ operation: collapsed ? 'collapse' : 'expand', groupId });
              }}
              onUpdateInvestigationGroup={(groupId, input) => {
                if (replayActive) {
                  return;
                }
                applyInvestigationGroupOperation({
                  operation: 'update',
                  groupId,
                  name: input.name,
                  groupType: input.groupType,
                  note: input.note,
                });
              }}
              onUngroupInvestigationGroup={(groupId) => {
                if (replayActive) {
                  return;
                }
                applyInvestigationGroupOperation({ operation: 'ungroup', groupId });
              }}
              onRemoveInvestigationGroupMember={(groupId, nodeId) => {
                if (replayActive) {
                  return;
                }
                applyInvestigationGroupOperation({ operation: 'remove_member', groupId, memberNodeId: nodeId });
              }}
              onRemoveInvestigationGroupMembers={(groupId, nodeIds) => {
                if (replayActive) {
                  return;
                }
                applyInvestigationGroupOperation({ operation: 'remove_member', groupId, memberNodeIds: nodeIds });
              }}
              onAddInvestigationGroupMembers={(groupId, nodeIds) => {
                if (replayActive) {
                  return;
                }
                applyInvestigationGroupOperation({ operation: 'add_members', groupId, memberNodeIds: nodeIds });
              }}
              onUpdateNodeNote={(nodeId, input) => {
                if (replayActive) {
                  return;
                }
                handleUpdateNodeNote(nodeId, input);
              }}
              groupOperationLoading={groupOperationApplying}
              excluding={requests.excluding}
              onOpenEdgeDetail={(edgeId, edgeFocus, edgeOverride) => {
                if (replayActive) {
                  return;
                }
                handleOpenEdgeDetail(edgeId, edgeFocus, edgeOverride);
              }}
              onFocusChange={(focus) => {
                if (!activeTab) {
                  return;
                }
                if (replayActive) {
                  return;
                }
                if (!focus) {
                  syncGraphContext(null);
                  return;
                }
                if (focus.type === 'edge') {
                  syncGraphContext({
                    ...focus,
                    fromName: focus.fromName || resolveNodeDisplayName(graphNodesById.get(focus.from), focus.from, activeTab.groupMap),
                    toName: focus.toName || resolveNodeDisplayName(graphNodesById.get(focus.to), focus.to, activeTab.groupMap),
                  });
                  return;
                }
                if (focus.type !== 'node') {
                  syncGraphContext(null);
                  return;
                }
                const node = graphNodesById.get(focus.nodeId);
                syncGraphContext({
                  type: 'node',
                  graphId: activeTab.graphId,
                  caseId: activeTab.caseId,
                  graphName: activeTab.graphName,
                  nodeId: focus.nodeId,
                  label: node?.label || node?.name || focus.label,
                  accountId: node?.accountId ?? focus.accountId ?? null,
                  accountName: node?.accountName || node?.label || node?.name || focus.accountName,
                  tradeCard: node?.tradeCard || focus.tradeCard,
                });
              }}
              onNodePositionsChange={(positions, reason) => {
                if (replayActive) {
                  return;
                }
                graphNodePositionsRef.current = positions;
                if (activeTab) {
                  persistGraphLayout(activeTab, positions, reason);
                }
              }}
            />
          </div>
        </section>

        <aside className="case-graph-detail case-graph-chat-panel">
          <div
            className={chatFullscreen ? 'case-graph-chat-fullscreen-mask' : 'case-graph-chat-dock'}
            role="presentation"
          >
            <div className={chatFullscreen ? 'case-graph-chat-fullscreen-shell' : 'case-graph-chat-dock-shell'}>
              <div
                className={
                  chatFullscreen
                    ? `shell case-graph-chat-fullscreen-main${fullscreenPreviewOpen ? ' detail-open' : ''}${immersivePreview ? ' detail-immersive' : ''}`
                    : 'case-graph-chat-dock-main'
                }
                style={
                  chatFullscreen && immersiveChatContentWidth !== null
                    ? ({
                        '--immersive-chat-workspace-width': `${immersiveChatContentWidth}px`,
                        '--immersive-chat-content-width': `${immersiveChatContentWidth}px`,
                      } as CSSProperties)
                    : undefined
                }
              >
                <ChatWorkspace
                  authResolved={authResolved}
                  authToken={token}
                  currentUser={currentUser}
                  title={title}
                  showFlash={showFlash}
                  previewActions={previewActions}
                  className={chatFullscreen ? 'chat-workspace case-graph-chat-fullscreen-workspace' : 'case-graph-chat-workspace'}
                  threadWrapperClassName={chatFullscreen ? 'case-graph-chat-thread case-graph-chat-thread--fullscreen' : 'case-graph-chat-thread'}
                  compact={chatFullscreen ? immersivePreview : true}
                  showSidebar={false}
                  sidebarCollapsed={true}
                  showSidebarToggle={false}
                  showWorkspacePanel={false}
                  workspaceFileCount={workspaceFileCount}
                  workspaceLoading={workspaceLoading}
                  onOpenWorkspace={openWorkspace}
                  contentPanelOpen={fullscreenPreviewOpen}
                  onToggleContentPanel={toggleContentPanel}
                  showContentHeader={chatFullscreen}
                  showContentPanelToggle={false}
                  previewOpen={fullscreenPreviewOpen}
                  immersivePreview={chatFullscreen && immersivePreview}
                  onOpenMedia={openMedia}
                  onSessionReady={handleCaseGraphSessionReady}
                  caseGraphActions={caseGraphActions}
                  prepareOutgoingMessage={prepareCaseGraphOutgoingMessage}
                  useDefaultSuggestions={false}
                  showThreadWelcome={false}
                  headerSlot={chatFullscreen ? undefined : (context) => renderChatHeader({ ...context, fullscreen: false })}
                  composerTopSlot={renderComposerSuggestions}
                />
                {chatFullscreen && resizingDetailPanel ? <div className="detail-resize-overlay" aria-hidden="true" /> : null}
                {chatFullscreen ? renderFullscreenTopControls() : null}
                {chatFullscreen ? (
                  <ConversationContentPane
                    detailView={detailView}
                    immersive={immersivePreview}
                    open={fullscreenPreviewOpen}
                    width={detailPanelWidth}
                    token={token}
                    workspaceAvailable={Boolean(currentChatId)}
                    workspaceOpen={fullscreenWorkspaceOpen}
                    workspaceLoading={workspaceLoading}
                    workspaceError={workspacePanel.error}
                    workspace={panelWorkspace}
                    workspaceFileCount={workspaceFileCount}
                    onOpenWorkspace={openWorkspace}
                    onCloseWorkspace={closeWorkspacePanel}
                    onOpenWorkspaceFile={openWorkspaceFile}
                    onCloseDetail={closeContentDetail}
                    onResizeStart={() => setResizingDetailPanel(true)}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </aside>

      </div>

      <EdgeDetailDrawer
        detail={edgeDetail}
        loading={edgeDetailLoading}
        open={edgeDetailOpen}
        selectedTradeIds={edgeDetailSelectedTradeIds}
        excludedTradeIds={activeTab?.excludedTrades ?? []}
        applying={edgeDetailApplying}
        onToggleTrade={handleToggleEdgeDetailTrade}
        onToggleTrades={handleSetEdgeDetailTrades}
        onApplyExclude={handleApplyEdgeDetailExclusion}
        onExcludeTrades={handleExcludeEdgeDetailTrades}
        onRestoreExcludedTrades={handleRestoreExcludedTrades}
        onClose={handleCloseEdgeDetail}
        partyContext={edgeDetailPartyContext}
      />

      <NodeDetailAnalysisDrawer
        open={Boolean(detailAnalysisNode)}
        node={detailAnalysisNode}
        relationships={detailAnalysisRelationships}
        detailByEdgeId={detailAnalysisByEdgeId}
        loadingEdgeIds={detailAnalysisLoadingEdgeIds}
        selectedTradeIds={detailAnalysisSelectedTradeIds}
        applying={detailAnalysisApplying}
        onLoadRelation={handleLoadDetailAnalysisRelation}
        onToggleTrade={handleToggleDetailAnalysisTrade}
        onToggleTrades={handleSetDetailAnalysisTrades}
        onApply={handleApplyDetailAnalysis}
        onClose={handleCloseDetailAnalysis}
      />

      <SummaryAnalysisDrawer
        open={summaryAnalysisOpen}
        scope={summaryAnalysisScope}
        node={summaryAnalysisNode}
        items={summaryAnalysisItems}
        selectedNodeIds={summaryAnalysisSelectedNodeIds}
        loading={summaryAnalysisLoading}
        applying={summaryAnalysisApplying}
        onToggleNode={handleToggleSummaryAnalysisNode}
        onToggleNodes={handleSetSummaryAnalysisNodes}
        onApply={handleApplySummaryAnalysis}
        onApplyItemAction={handleApplySummaryAnalysisItemAction}
        evidence={summaryOperationEvidence}
        onEvidenceChange={setSummaryOperationEvidence}
        onClose={handleCloseSummaryAnalysis}
      />

      <ManualClueDrawer
        open={manualClueOpen}
        mode={manualClueMode}
        nodes={activeTab?.graphData?.nodes ?? []}
        focusNode={manualClueFocusNode}
        targetPosition={manualCluePosition}
        applying={manualClueApplying}
        onApplyNode={handleApplyManualNode}
        onApplyTrade={handleApplyManualTrade}
        onApplyRelation={handleApplyRealityRelation}
        onClose={handleCloseManualClue}
      />

      <Modal
        open={groupDraftOpen}
        title="归并成组"
        description={`已选择 ${groupDraftNodes.length} 个主体，成组后可整体收起或拆分。`}
        onClose={handleCloseInvestigationGroup}
        size="md"
        className="case-graph-investigation-group-modal"
        footer={(
          <>
            <button className="case-graph-secondary-button" type="button" onClick={handleCloseInvestigationGroup}>
              取消
            </button>
            <button
              className="case-graph-primary-button"
              type="button"
              disabled={groupOperationApplying || groupDraftNodes.length < 2}
              onClick={handleSubmitInvestigationGroup}
            >
              {groupOperationApplying ? '保存中' : '保存到图'}
            </button>
          </>
        )}
      >
            <div className="case-graph-investigation-group-body">
              <div className="case-graph-investigation-group-fields">
                <label>
                  <span>组名</span>
                  <input
                    value={groupDraftForm.name}
                    onChange={(event) => setGroupDraftForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="例如：伍华中核心团伙"
                  />
                </label>
                <label>
                  <span>组类型</span>
                  <Select
                    value={groupDraftForm.groupType}
                    ariaLabel="组类型"
                    options={[
                      { value: '团伙成员', label: '团伙成员' },
                      { value: '关联账号', label: '关联账号' },
                      { value: '控制关系', label: '控制关系' },
                      { value: '资金中转', label: '资金中转' },
                      { value: '其他', label: '其他' },
                    ]}
                    onChange={(value) => setGroupDraftForm((current) => ({ ...current, groupType: value }))}
                  />
                </label>
                <label className="case-graph-investigation-group-note">
                  <span>研判说明</span>
                  <textarea
                    value={groupDraftForm.note}
                    onChange={(event) => setGroupDraftForm((current) => ({ ...current, note: event.target.value }))}
                    placeholder="说明为什么把这些主体归为一组，例如同案关系、共同控制、同一团伙等。"
                  />
                </label>
              </div>
              <div className="case-graph-investigation-group-members">
                <strong>组内主体</strong>
                <div>
                  {groupDraftNodes.map((node) => (
                    <span key={node.id}>{node.label || node.name || node.accountName || node.tradeCard || node.id}</span>
                  ))}
                </div>
              </div>
              <OperationEvidenceFields
                operation="group_change"
                value={groupOperationEvidence}
                onChange={setGroupOperationEvidence}
              />
            </div>
      </Modal>

      <Modal
        open={originPanelOpen}
        title="选择侦办起点"
        description={activeTab ? `${activeTab.graphName} · ${selectedAccountIds.length} 已选` : '请先新建图形'}
        onClose={() => setOriginPanelOpen(false)}
        size="xl"
        className="case-graph-origin-panel"
        bodyClassName="case-graph-origin-modal-body"
        footer={(
          <>
            <button className="case-graph-secondary-button" type="button" onClick={() => setOriginPanelOpen(false)}>
              取消
            </button>
            <button className="case-graph-primary-button" type="button" onClick={handleAnalyze} disabled={!activeTab || replayActive || requests.querying || selectedAccountIds.length === 0}>
              <Sparkles size={14} />
              <span>{requests.querying ? '分析中' : '分析上图'}</span>
            </button>
          </>
        )}
      >
            <CaseRail
              className="case-graph-rail--origin"
              cases={cases}
              casesLoading={casesLoading}
              caseSelectDisabled={Boolean(activeTab)}
              caseIdDraft={activeTab?.caseId ?? caseIdDraft}
              accountQuery={accountQuery}
              availableAccounts={availableAccounts}
              accountsLoading={accountsLoading}
              selectedAccountIds={selectedAccountIds}
              onCaseIdChange={handleCaseIdChange}
              onAccountQueryChange={setAccountQuery}
              onToggleAccount={handleToggleAccount}
              onToggleAccountGroup={handleToggleAccountGroup}
            />
      </Modal>

      <Modal
        open={Boolean(deleteGraphTarget)}
        title="删除图"
        description="将删除这张图、绑定的研判对话以及相关工作文件，操作不可恢复。"
        onClose={() => setDeleteGraphTarget(null)}
        closeDisabled={requests.deleting}
        size="sm"
        className="case-graph-delete-modal"
        ariaLabel="删除图确认"
        footer={(
          <>
            <button className="case-graph-secondary-button" type="button" disabled={requests.deleting} onClick={() => setDeleteGraphTarget(null)}>
              取消
            </button>
            <button className="case-graph-danger-button" type="button" disabled={requests.deleting} onClick={handleConfirmDeleteGraph}>
              {requests.deleting ? '删除中' : '确认删除'}
            </button>
          </>
        )}
      >
        {deleteGraphTarget ? (
            <div className="case-graph-delete-copy">
              确认删除「{deleteGraphTarget.graphName}」吗？
            </div>
        ) : null}
      </Modal>

      <Modal
        open={excludedDialogOpen}
        title="排除管理"
        description={`已取消上图 ${activeTab?.excludedNodes.length ?? 0} 个主体，已排除 ${activeTab?.excludedTrades.length ?? 0} 笔交易流水`}
        onClose={() => setExcludedDialogOpen(false)}
        size="lg"
        className="case-graph-excluded-modal"
        bodyClassName="case-graph-excluded-modal-body"
      >
        <div className="case-graph-excluded-content">
            <div className="case-graph-excluded-tabs" role="tablist" aria-label="排除项类型">
              <button
                type="button"
                role="tab"
                aria-selected={excludedDialogTab === 'nodes'}
                className={excludedDialogTab === 'nodes' ? 'is-active' : ''}
                onClick={() => setExcludedDialogTab('nodes')}
              >
                主体 <span>{activeTab?.excludedNodes.length ?? 0}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={excludedDialogTab === 'trades'}
                className={excludedDialogTab === 'trades' ? 'is-active' : ''}
                onClick={() => setExcludedDialogTab('trades')}
              >
                交易流水 <span>{activeTab?.excludedTrades.length ?? 0}</span>
              </button>
            </div>
            {excludedDialogTab === 'nodes' ? (
              <>
                <div className="case-graph-excluded-tools">
                  <label className="case-graph-toggle-row">
                    <input
                      type="checkbox"
                      checked={Boolean(activeTab?.showExcludedNodes)}
                      onChange={handleToggleShowExcludedNodes}
                      disabled={!activeTab?.excludedNodes.length}
                    />
                    <span>在图上显示已取消上图主体</span>
                  </label>
                  <button
                    className="case-graph-secondary-button"
                    type="button"
                    onClick={handleRestoreAllExcludedNodes}
                    disabled={!activeTab?.excludedNodes.length || requests.excluding}
                  >
                    <Undo2 size={14} />
                    <span>全部恢复</span>
                  </button>
                </div>
                <div className="case-graph-excluded-list">
                  {activeTab?.excludedNodes.length ? (
                    activeTab.excludedNodes.map((node) => (
                      <div className="case-graph-excluded-item" key={node.nodeId}>
                        <div>
                          <strong>{node.label || node.nodeId}</strong>
                          <span>{node.type === 'subject' ? '主体' : '账号'} · {(node.accountIds?.length || node.tradeCards?.length || 1)} 个标识</span>
                        </div>
                        <button
                          className="case-graph-secondary-button"
                          type="button"
                          onClick={() => handleRestoreNode(node.nodeId)}
                          disabled={requests.excluding}
                        >
                          <Undo2 size={14} />
                          <span>恢复</span>
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="case-graph-empty">当前没有已取消上图的主体。</div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="case-graph-excluded-tools">
                  <span className="case-graph-excluded-hint">
                    排除的是交易流水，资金线会按保留下来的流水重新计算。
                  </span>
                  <button
                    className="case-graph-secondary-button"
                    type="button"
                    onClick={handleRestoreSelectedExcludedTrades}
                    disabled={!excludedTradeSelection.length || requests.excluding}
                  >
                    <Undo2 size={14} />
                    <span>恢复已选</span>
                  </button>
                </div>
                <div className="case-graph-excluded-trade-table-wrap">
                  {excludedTradeItems.length ? (
                    <table className="case-graph-edge-table case-graph-excluded-trade-table">
                      <thead>
                        <tr>
                          <th>
                            <input
                              type="checkbox"
                              aria-label="全选已排除交易流水"
                              checked={allExcludedTradesSelected}
                              onChange={(event) => handleSetAllExcludedTradeSelection(event.target.checked)}
                            />
                          </th>
                          <th>付款方</th>
                          <th>收款方</th>
                          <th>交易金额</th>
                          <th>交易时间</th>
                          <th>摘要/备注</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {excludedTradeItems.map((item) => (
                          <tr key={item.tradeId}>
                            <td>
                              <input
                                type="checkbox"
                                checked={excludedTradeSelectionSet.has(item.tradeId)}
                                onChange={() => handleToggleExcludedTradeSelection(item.tradeId)}
                                aria-label="选择已排除交易流水"
                              />
                            </td>
                            <td>{renderExcludedTradeParty(item.payerName, item.payerCard)}</td>
                            <td>{renderExcludedTradeParty(item.payeeName, item.payeeCard)}</td>
                            <td>{formatExcludedTradeAmount(item.amount)}</td>
                            <td>{item.tradeTime || '-'}</td>
                            <td>{item.summary || '-'}</td>
                            <td>
                              <button
                                className="case-graph-secondary-button"
                                type="button"
                                onClick={() => handleRestoreExcludedTrades([item.tradeId])}
                                disabled={requests.excluding}
                              >
                                恢复
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="case-graph-empty">当前没有已排除的交易流水。</div>
                  )}
                </div>
              </>
            )}
            <OperationEvidenceFields
              operation={excludedDialogTab === 'nodes' ? 'restore_nodes' : 'restore_trades'}
              value={excludedRestoreEvidence}
              onChange={setExcludedRestoreEvidence}
            />
        </div>
      </Modal>

      <Modal
        open={Boolean(operationEvidencePrompt)}
        title={operationEvidencePrompt?.title ?? '记录操作依据'}
        description={operationEvidencePrompt?.description}
        onClose={closeOperationEvidencePrompt}
        size="md"
        bodyClassName="case-graph-form-modal-body"
        footer={(
          <>
            <button className="case-graph-secondary-button" type="button" onClick={closeOperationEvidencePrompt}>取消</button>
            <button
              className="case-graph-primary-button"
              type="button"
              disabled={!operationEvidencePrompt || Boolean(validateOperationEvidence(operationEvidencePrompt.operation, operationEvidence))}
              onClick={() => {
                if (!operationEvidencePrompt) return;
                const validationError = validateOperationEvidence(operationEvidencePrompt.operation, operationEvidence);
                if (validationError) {
                  setError(validationError);
                  return;
                }
                operationEvidencePrompt.resolve(operationEvidence);
                setOperationEvidencePrompt(null);
              }}
            >
              确认执行
            </button>
          </>
        )}
      >
        {operationEvidencePrompt ? (
          <OperationEvidenceFields
            operation={operationEvidencePrompt.operation}
            value={operationEvidence}
            onChange={setOperationEvidence}
          />
        ) : null}
      </Modal>

      <Modal
        open={newGraphDialogOpen}
        title="新建图形"
        onClose={() => setNewGraphDialogOpen(false)}
        size="md"
        bodyClassName="case-graph-form-modal-body"
        footer={(
          <>
            <button className="case-graph-secondary-button" type="button" onClick={() => setNewGraphDialogOpen(false)}>取消</button>
            <button className="case-graph-primary-button" type="button" onClick={handleCreateGraph} disabled={requests.creating}>
              <span>{requests.creating ? '创建中' : '确认'}</span>
            </button>
          </>
        )}
      >
            <label className="case-graph-field">
              <span>案件</span>
              <Select
                value={caseIdDraft}
                options={[
                  { value: '', label: casesLoading ? '案件加载中...' : '请选择案件', disabled: casesLoading },
                  ...cases.map((item) => ({ value: item.id, label: item.caseName || item.caseCode || item.id })),
                ]}
                disabled={casesLoading}
                placeholder={casesLoading ? '案件加载中...' : '请选择案件'}
                ariaLabel="案件"
                onChange={handleCaseIdChange}
              />
            </label>
            <label className="case-graph-field">
              <span>图形名称</span>
              <input
                value={newGraphForm.graphName}
                onChange={(event) => setNewGraphForm((current) => ({ ...current, graphName: event.target.value }))}
                placeholder="请输入"
              />
            </label>
      </Modal>

      <Modal
        open={graphConfigDialogOpen}
        title="当前图钻取配置"
        onClose={() => setGraphConfigDialogOpen(false)}
        size="md"
        bodyClassName="case-graph-form-modal-body"
        footer={(
          <>
            <button className="case-graph-secondary-button" type="button" onClick={() => setGraphConfigDialogOpen(false)}>取消</button>
            <button className="case-graph-primary-button" type="button" onClick={handleSaveGraphConfig} disabled={requests.querying}>
              <span>{requests.querying ? '保存中' : '确认'}</span>
            </button>
          </>
        )}
      >
            <label className="case-graph-field">
              <span>上下钻个数</span>
              <input
                value={graphConfigForm.drillNums}
                onChange={(event) => setGraphConfigForm((current) => ({ ...current, drillNums: event.target.value }))}
                inputMode="numeric"
                placeholder="请输入"
              />
            </label>
            <div className="case-graph-radio-row">
              <span>钻取类型</span>
              <label><input type="radio" checked={graphConfigForm.drillType === '1'} onChange={() => setGraphConfigForm((current) => ({ ...current, drillType: '1' }))} />按金额</label>
              <label><input type="radio" checked={graphConfigForm.drillType === '2'} onChange={() => setGraphConfigForm((current) => ({ ...current, drillType: '2' }))} />按笔数</label>
              <label><input type="radio" checked={graphConfigForm.drillType === '3'} onChange={() => setGraphConfigForm((current) => ({ ...current, drillType: '3' }))} />共同关系</label>
            </div>
            <div className="case-graph-range-row">
              <label className="case-graph-field">
                <span>最小金额</span>
                <input
                  value={graphConfigForm.minAmount}
                  onChange={(event) => setGraphConfigForm((current) => ({ ...current, minAmount: event.target.value }))}
                  inputMode="decimal"
                  placeholder="不限"
                />
              </label>
              <label className="case-graph-field">
                <span>最大金额</span>
                <input
                  value={graphConfigForm.maxAmount}
                  onChange={(event) => setGraphConfigForm((current) => ({ ...current, maxAmount: event.target.value }))}
                  inputMode="decimal"
                  placeholder="不限"
                />
              </label>
            </div>
            <OperationEvidenceFields
              operation="drill_with_changed_settings"
              value={graphConfigEvidence}
              onChange={setGraphConfigEvidence}
            />
      </Modal>
    </section>
  );
}

function buildReplayTimelineSteps(steps: CaseGraphStepSnapshot[]): CaseGraphReplayTimelineStep[] {
  const sortedSteps = [...steps].sort((left, right) => compareStepOrder(left, right));
  let lastTime = 0;
  return sortedSteps.map((step, index) => {
    const parsedTime = Date.parse(step.createdAt || '');
    const baseTime = Number.isFinite(parsedTime) ? parsedTime : index + 1;
    const time = baseTime <= lastTime ? lastTime + 1 : baseTime;
    lastTime = time;
    const addedNodeCount = resolveSummaryNumber(step.summary, 'addedNodeCount', step.delta?.addedNodes?.length ?? 0);
    const addedEdgeCount = resolveSummaryNumber(step.summary, 'addedEdgeCount', step.delta?.addedEdges?.length ?? 0);
    const activeCounts = countActiveGraphElements(step.graph);
    return {
      stepId: step.stepId,
      time,
      label: `步骤 ${step.stepId}`,
      operationLabel: formatGraphStepOperation(step),
      nodeCount: activeCounts.nodeCount,
      edgeCount: activeCounts.edgeCount,
      addedNodeCount,
      addedEdgeCount,
      evidenceLevel: step.operation.evidence?.level,
      evidenceLabel: step.operation.evidence?.reasonLabel,
      evidenceNote: step.operation.evidence?.note,
    };
  });
}

function requiredEvidenceOperationForChatAction(
  action: CaseGraphChatAction,
): CaseGraphEvidenceOperation | null {
  if (action.type === 'exclude_node') return 'exclude_nodes';
  if (action.type === 'exclude_trades') return 'exclude_trades';
  if (action.type === 'complete_relation') return 'complete_relation';
  return null;
}

function countActiveGraphElements(graph: CaseGraphStateBody): { nodeCount: number; edgeCount: number } {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const excludedNodeIds = new Set(
    nodes
      .filter((node) => node.isExcluded)
      .map((node) => String(node.id || '').trim())
      .filter(Boolean),
  );
  const nodeCount = nodes.filter((node) => !node.isExcluded).length;
  const edgeCount = edges.filter((edge) => {
    const source = String(edge.source || edge.from || '').trim();
    const target = String(edge.target || edge.to || '').trim();
    return !edge.isExcluded && !excludedNodeIds.has(source) && !excludedNodeIds.has(target);
  }).length;
  return { nodeCount, edgeCount };
}

function resolveLatestGraphStepId(steps: CaseGraphStepSnapshot[]): string | null {
  if (!steps.length) {
    return null;
  }
  return [...steps].sort((left, right) => compareStepOrder(left, right)).at(-1)?.stepId ?? null;
}

function compareStepOrder(left: CaseGraphStepSnapshot, right: CaseGraphStepSnapshot): number {
  const leftRevision = Number(left.revision ?? 0);
  const rightRevision = Number(right.revision ?? 0);
  if (leftRevision !== rightRevision) {
    return leftRevision - rightRevision;
  }
  return String(left.stepId || '').localeCompare(String(right.stepId || ''));
}

function resolveSummaryNumber(summary: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const value = Number(summary?.[key] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function formatGraphStepOperation(step: CaseGraphStepSnapshot): string {
  const operation = step.operation;
  const type = String(operation?.type || operation?.label || '').trim();
  const label = String(operation?.label || '').trim();
  const normalized = type || label;
  if (normalized === 'seed_one_hop') {
    const direction = String(operation?.params?.direction || '').trim();
    if (Number(step.baseRevision ?? 0) > 0) {
      if (direction === 'in') return '上钻';
      if (direction === 'out') return '下钻';
      return '双向钻取';
    }
    return '一跳分析';
  }
  const labels: Record<string, string> = {
    complete_current_graph: '补全关系',
    filter_current_graph: '全图筛选',
    detail_trade_filter: '交易核查',
    summary_analysis: '综合筛选',
    manual_node_add: '创建交易主体',
    manual_trade_add: '补充资金往来',
    reality_relation_add: '标注现实关系',
    manual_exclude_node: '取消上图',
    manual_restore_node: '恢复节点',
  };
  return labels[normalized] || label || normalized || '图谱操作';
}

function resolveRelationOperationLabel(result: CaseGraphRelationResponse): string {
  const summaryLabel = String(result.step?.summary?.label || '').trim();
  if (summaryLabel) {
    return summaryLabel;
  }
  const type = String(result.step?.type || result.queryMode || '').trim();
  const labels: Record<string, string> = {
    seed_one_hop: '一跳分析',
    complete_current_graph: '补全关系',
    filter_current_graph: '全图筛选',
    detail_trade_filter: '交易核查',
    summary_analysis: '综合筛选',
    manual_node_add: '创建交易主体',
    manual_trade_add: '补充资金往来',
    reality_relation_add: '标注现实关系',
    manual_exclude_node: '取消上图',
    manual_restore_node: '恢复节点',
  };
  return labels[type] || type || '图谱操作';
}

function buildRelationDeltaSummary(delta: CaseGraphRelationResponse['delta'] | undefined): Record<string, number> {
  return {
    addedNodeCount: delta?.addedNodes?.length ?? 0,
    addedEdgeCount: delta?.addedEdges?.length ?? 0,
    updatedNodeCount: delta?.updatedNodes?.length ?? 0,
    updatedEdgeCount: delta?.updatedEdges?.length ?? 0,
  };
}

function formatGraphStepSummary(summary: Record<string, unknown>): string {
  const labels: Record<string, string> = {
    nodeCount: '当前主体',
    edgeCount: '当前资金线',
    tradeFactCount: '已沉淀交易流水',
    excludedTradeCount: '已排除交易流水',
    excludedNodeCount: '已取消上图主体',
    affectedEdgeCount: '受影响资金线',
    removedEdgeCount: '移除资金线',
    addedNodeCount: '新增主体',
    addedEdgeCount: '新增资金线',
    updatedNodeCount: '更新主体',
    updatedEdgeCount: '更新资金线',
    candidateNodeCount: '综合筛选主体',
    retainedNodeCount: '保留主体',
  };
  return Object.entries(summary)
    .flatMap(([key, value]) => {
      const label = labels[key];
      if (!label || value == null || typeof value === 'object') {
        return [];
      }
      return `${label} ${String(value)}`;
    })
    .join('，');
}

function graphFocusToContextPayload(
  focus: CaseGraphConversationFocus,
): Omit<CaseGraphConversationFocus, 'graphId' | 'caseId' | 'graphName'> | null {
  if (focus.type === 'graph') {
    return null;
  }
  const { graphId: _graphId, caseId: _caseId, graphName: _graphName, ...payload } = focus;
  return payload;
}

function buildGraphStepInsightPrompt(result: CaseGraphRelationResponse, tab: GraphTabState): string {
  const label = resolveRelationOperationLabel(result);
  const delta = buildRelationDeltaSummary(result.delta);
  const summary = result.step?.summary ?? {};
  const summaryText = formatGraphStepSummary(summary);
  return [
    '请作为“图谱研判副驾”，读取当前图谱上下文和最新步骤文件，给办案人员解释刚刚这一步操作的变化。',
    '请先通过图谱研判助手形成事实结论，再组织回答；只有事实结论不足时，才补充核对原始材料。',
    '',
    `案件：${tab.caseId}`,
    `图谱：${tab.graphName}`,
    `步骤：${result.step?.stepId || '-'}`,
    `操作：${label}`,
    `变化：新增主体 ${delta.addedNodeCount} 个，新增资金线 ${delta.addedEdgeCount} 条，更新主体 ${delta.updatedNodeCount} 个，更新资金线 ${delta.updatedEdgeCount} 条。`,
    summaryText ? `步骤摘要：${summaryText}` : '',
    '',
    '请按以下结构输出，语言要面向办案民警，不要暴露内部字段名：',
    '1. 本次变化',
    '2. 关键线索',
    '3. 下一步建议',
    '',
    '如果这一步没有新增节点或边，请重点解释筛选、排除或交易核查后当前图留下了什么、删减了什么、为什么值得看。',
  ].filter(Boolean).join('\n');
}

function graphToTab(graph: CaseGraphSnapshot): GraphTabState {
  const tradeCards = snapshotTradeCards(graph);
  const originData = normalizeCaseGraphOriginData(graph.graphData);
  const snapshotGroupMap = normalizeCaseGraphGroupMap(graph.groupMap);
  const resolvedGroupMap = Object.keys(snapshotGroupMap).length > 0
    ? snapshotGroupMap
    : normalizeCaseGraphGroupMap(originData?.groups);
  return {
    graphId: graph.graph_id,
    graphName: graph.graphName,
    caseId: graph.caseId,
    graphContent: graph.graphContent || '',
    selectedAccountIds: tradeCards
      .map((item) => String(item.accountId || '').trim())
      .filter(Boolean),
    tradeCards,
    queryBaselineTradeCards: tradeCards,
    graphData: originDataToCanvasData(originData),
    originData,
    tradeFacts: { ...(originData?.tradeFacts ?? {}) },
    groupMap: resolvedGroupMap,
    sourceSelectId: Array.isArray(graph.sourceSelectId) ? [...graph.sourceSelectId] : [],
    excludedTrades: Array.isArray(graph.excludedTrades) ? [...graph.excludedTrades] : [],
    excludedAccountId: graph.excludedAccountId ?? null,
    excludedNodes: originData?.excludedNodes ?? graph.excludedNodes ?? [],
    showExcludedNodes: false,
    drillNums: Number(graph.drillNums || 10),
    drillType: graph.drillType ?? 1,
    minAmount: graph.minAmount ?? null,
    maxAmount: graph.maxAmount ?? null,
    startTime: '',
    endTime: '',
    appliedFilters: emptyFilterState({
      minAmount: graph.minAmount,
      maxAmount: graph.maxAmount,
    }),
    chatId: graph.chatId || '',
    loaded: true,
    layout: emptyLayoutState(),
  };
}

interface GraphStateToTabOptions {
  repairGeneratedLayout?: boolean;
}

function graphStateToTab(
  state: CaseGraphStateSnapshot,
  fallback?: Partial<GraphTabState> | CaseGraphSnapshot,
  options: GraphStateToTabOptions = {},
): GraphTabState {
  const rawGraphData = graphStateToCanvasData(state);
  const layout = options.repairGeneratedLayout
    ? repairGeneratedLayoutState(rawGraphData, normalizeLayoutState(state.graph.layout))
    : normalizeLayoutState(state.graph.layout);
  const graphData = applyGraphLayoutPositions(rawGraphData, layout);
  const originData = graphStateToOriginData(state);
  const positionedOriginData = originData && graphData
    ? { ...originData, nodes: graphData.nodes, money: graphData.edges }
    : originData;
  const fallbackSnapshot = fallback && 'graph_id' in fallback ? fallback : null;
  const fallbackTab = fallback && 'graphId' in fallback ? fallback : null;
  const tradeCards = state.graph.tradeCards.length
    ? state.graph.tradeCards
    : fallbackTab?.tradeCards ?? (fallbackSnapshot ? snapshotTradeCards(fallbackSnapshot) : []);
  const filters = state.graph.filters;
  return {
    graphId: state.graphId,
    graphName: state.graphName || fallbackTab?.graphName || fallbackSnapshot?.graphName || '',
    caseId: state.caseId,
    graphContent: fallbackTab?.graphContent || fallbackSnapshot?.graphContent || '',
    selectedAccountIds: tradeCards.map((item) => String(item.accountId || '').trim()).filter(Boolean),
    tradeCards,
    queryBaselineTradeCards: tradeCards,
    graphData,
    originData: positionedOriginData,
    tradeFacts: { ...(state.graph.tradeFacts ?? {}) },
    groupMap: normalizeCaseGraphGroupMap(state.graph.groupMap),
    sourceSelectId: [...(state.graph.sourceSelectId ?? [])],
    excludedTrades: [...(state.graph.excludedTrades ?? [])],
    excludedAccountId: state.graph.excludedAccountId?.[0] ?? null,
    excludedNodes: [...(state.graph.excludedNodes ?? [])],
    showExcludedNodes: fallbackTab?.showExcludedNodes ?? false,
    drillNums: Number(state.graph.drillNums ?? fallbackTab?.drillNums ?? fallbackSnapshot?.drillNums ?? 10),
    drillType: state.graph.drillType ?? fallbackTab?.drillType ?? fallbackSnapshot?.drillType ?? 1,
    minAmount: filters.minAmount ?? null,
    maxAmount: filters.maxAmount ?? null,
    startTime: filters.startTime ?? '',
    endTime: filters.endTime ?? '',
    appliedFilters: emptyFilterState({
      minAmount: filters.minAmount ?? '',
      maxAmount: filters.maxAmount ?? '',
      startTime: filters.startTime ?? '',
      endTime: filters.endTime ?? '',
    }),
    chatId: fallbackTab?.chatId || fallbackSnapshot?.chatId || '',
    loaded: true,
    layout,
  };
}

export function graphStateToTabForTest(state: CaseGraphStateSnapshot, options: GraphStateToTabOptions = {}): GraphTabState {
  return graphStateToTab(state, undefined, options);
}

function emptyFilterState(overrides: Partial<CaseGraphFilterState> = {}): CaseGraphFilterState {
  return {
    minAmount: formatFilterValue(overrides.minAmount),
    maxAmount: formatFilterValue(overrides.maxAmount),
    startTime: overrides.startTime || '',
    endTime: overrides.endTime || '',
  };
}

function emptyLayoutState(): CaseGraphLayoutState {
  return {
    version: 2,
    nodePositions: {},
    positionMeta: {},
    groupLayout: {},
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function normalizeLayoutState(layout: Partial<CaseGraphLayoutState> | null | undefined): CaseGraphLayoutState {
  return {
    version: 2,
    nodePositions: { ...(layout?.nodePositions ?? {}) },
    positionMeta: { ...(layout?.positionMeta ?? {}) },
    groupLayout: { ...(layout?.groupLayout ?? {}) },
    viewport: layout?.viewport ?? { x: 0, y: 0, zoom: 1 },
  };
}

function repairGeneratedLayoutState(
  graphData: CaseGraphData | null,
  layout: CaseGraphLayoutState,
): CaseGraphLayoutState {
  if (!graphData) {
    return layout;
  }
  const repairNodeIds = resolveGeneratedLayoutRepairNodeIds(graphData, layout);
  if (!repairNodeIds.length) {
    return layout;
  }
  const repairNodeIdSet = new Set(repairNodeIds);
  const graphDataForRepair: CaseGraphData = {
    ...graphData,
    nodes: graphData.nodes.map((node) => {
      if (!repairNodeIdSet.has(node.id)) {
        return node;
      }
      const { x: _x, y: _y, fx: _fx, fy: _fy, ...rest } = node as CaseGraphData['nodes'][number] & {
        fx?: number;
        fy?: number;
      };
      return rest;
    }),
  };
  const previousLayout: CaseGraphLayoutState = {
    ...layout,
    nodePositions: Object.fromEntries(
      Object.entries(layout.nodePositions).filter(([nodeId]) => !repairNodeIdSet.has(nodeId)),
    ),
  };
  const anchorNodeIds = [
    ...new Set(
      repairNodeIds.flatMap((nodeId) => layout.positionMeta[nodeId]?.anchorNodeIds ?? []),
    ),
  ];
  const plan = computeCaseGraphLayoutPlan({
    graphData: graphDataForRepair,
    previousLayout,
    event: {
      type: 'layout_refresh',
      addedNodeIds: repairNodeIds,
      anchorNodeIds,
    },
    ...LAYOUT_ENGINE_DIMENSIONS,
  });
  return layoutStateFromPlan(plan, layout);
}

function resolveGeneratedLayoutRepairNodeIds(
  graphData: CaseGraphData,
  layout: CaseGraphLayoutState,
): string[] {
  const nodeIds = new Set(graphData.nodes.map((node) => node.id));
  const generatedNodeIds = Object.entries(layout.positionMeta)
    .filter(([nodeId, meta]) => nodeIds.has(nodeId) && meta?.source === 'generated' && !meta.locked)
    .map(([nodeId]) => nodeId);
  return generatedNodeIds.filter((nodeId) => {
    const point = layout.nodePositions[nodeId];
    if (!point) return true;
    for (const [otherNodeId, otherPoint] of Object.entries(layout.nodePositions)) {
      if (otherNodeId === nodeId || !nodeIds.has(otherNodeId)) {
        continue;
      }
      if (layoutPointsOverlap(point, otherPoint)) {
        return true;
      }
    }
    return false;
  });
}

function layoutPointsOverlap(left: GraphNodePoint, right: GraphNodePoint): boolean {
  const minDx = LAYOUT_ENGINE_DIMENSIONS.nodeWidth + 24;
  const minDy = LAYOUT_ENGINE_DIMENSIONS.nodeHeight + 8;
  return Math.abs(left.x - right.x) < minDx && Math.abs(left.y - right.y) < minDy;
}

function hasLayoutPositionsChanged(
  previous: Record<string, GraphNodePoint>,
  next: Record<string, GraphNodePoint>,
): boolean {
  const nodeIds = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const nodeId of nodeIds) {
    const before = previous[nodeId];
    const after = next[nodeId];
    if (!before || !after) return true;
    if (before.x !== after.x || before.y !== after.y) return true;
  }
  return false;
}

function currentFilterState(tab: GraphTabState | null): CaseGraphFilterState {
  if (!tab) return emptyFilterState();
  return {
    minAmount: formatFilterValue(tab.minAmount),
    maxAmount: formatFilterValue(tab.maxAmount),
    startTime: tab.startTime || '',
    endTime: tab.endTime || '',
  };
}

function formatFilterValue(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function sameFilterState(left: CaseGraphFilterState, right: CaseGraphFilterState): boolean {
  return left.minAmount === right.minAmount
    && left.maxAmount === right.maxAmount
    && left.startTime === right.startTime
    && left.endTime === right.endTime;
}

function validateFilterState(filters: CaseGraphFilterState): string | null {
  const minAmount = filters.minAmount ? Number(filters.minAmount) : null;
  const maxAmount = filters.maxAmount ? Number(filters.maxAmount) : null;
  if (minAmount != null && !Number.isFinite(minAmount)) return '最小金额格式不正确';
  if (maxAmount != null && !Number.isFinite(maxAmount)) return '最大金额格式不正确';
  if (minAmount != null && maxAmount != null && minAmount > maxAmount) return '最小金额不能大于最大金额';
  if (filters.startTime && filters.endTime && filters.startTime > filters.endTime) return '开始时间不能晚于结束时间';
  return null;
}

function buildRelationFilterPayload(filters: CaseGraphFilterState): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (filters.minAmount) payload.minAmount = Number(filters.minAmount);
  if (filters.maxAmount) payload.maxAmount = Number(filters.maxAmount);
  if (filters.startTime) payload.startTime = normalizeDateTimeLocal(filters.startTime, false);
  if (filters.endTime) payload.endTime = normalizeDateTimeLocal(filters.endTime, true);
  return payload;
}

function buildRelationDrillConfig(tab: Pick<GraphTabState, 'drillNums' | 'drillType'>): {
  drillNums: number;
  drillType: string | number | null;
} {
  return {
    drillNums: Number(tab.drillNums || 10),
    drillType: tab.drillType ?? 1,
  };
}

function normalizeDateTimeLocal(value: string, endOfDay: boolean): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const normalized = trimmed.replace('T', ' ');
  return normalized.length === 16 ? `${normalized}:${endOfDay ? '59' : '00'}` : normalized;
}

function buildRelationSeeds(
  accounts: CaseGraphSelectableAccount[],
  selectedAccountIds: string[],
) {
  const selected = new Set(selectedAccountIds.map((item) => String(item || '').trim()).filter(Boolean));
  const buckets = new Map<string, CaseGraphSelectableAccount[]>();
  for (const account of accounts) {
    if (!selected.has(account.accountId)) continue;
    const key = String(account.suspectId || account.suspectName || account.accountName || account.accountId).trim();
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(account);
    } else {
      buckets.set(key, [account]);
    }
  }
  return [...buckets.values()].map((items) => ({
    suspectId: items[0]?.suspectId || '',
    suspectName: items[0]?.suspectName || items[0]?.accountName || '',
    accountIds: items.map((item) => item.accountId),
    excludedAccountIds: [],
    accounts: items.map((item) => ({
      accountId: item.accountId,
      tradeCard: item.tradeCard,
      accountName: item.accountName,
      suspectId: item.suspectId,
      suspectName: item.suspectName,
    })),
  }));
}

function resolveGraphAccounts(tab: GraphTabState): CaseGraphTradeCard[] {
  const byKey = new Map<string, CaseGraphTradeCard>();
  for (const card of tab.tradeCards) {
    const key = String(card.accountId || card.tradeCard || '').trim();
    if (key) byKey.set(key, card);
  }
  for (const node of tab.graphData?.nodes ?? []) {
    if (node.isExcluded) {
      continue;
    }
    for (const account of node.accounts ?? []) {
      const key = String(account.accountId || account.tradeCard || '').trim();
      if (key && !byKey.has(key)) byKey.set(key, account);
    }
    const key = String(node.accountId || node.tradeCard || '').trim();
    if (key && !byKey.has(key)) {
      byKey.set(key, {
        accountId: node.accountId ?? undefined,
        tradeCard: node.tradeCard,
        accountName: node.accountName || node.label || node.name,
      });
    }
  }
  return [...byKey.values()];
}

function filterExcludedGraphData(graphData: CaseGraphData | null, showExcludedNodes: boolean): CaseGraphData | null {
  if (!graphData) return null;
  if (showExcludedNodes) return graphData;
  const visibleNodeIds = new Set(
    graphData.nodes
      .filter((node) => !node.isExcluded)
      .map((node) => String(node.id || '').trim())
      .filter(Boolean),
  );
  return {
    ...graphData,
    nodes: graphData.nodes.filter((node) => visibleNodeIds.has(String(node.id || '').trim())),
    edges: graphData.edges.filter((edge) => {
      const source = String(edge.source || edge.from || '').trim();
      const target = String(edge.target || edge.to || '').trim();
      return !edge.isExcluded && visibleNodeIds.has(source) && visibleNodeIds.has(target);
    }),
  };
}

function buildNodeDetailAnalysisRelationships(
  node: CaseGraphNode,
  tab: GraphTabState,
): NodeDetailAnalysisRelation[] {
  const nodeId = String(node.id || '').trim();
  if (!nodeId || !tab.graphData) {
    return [];
  }
  return tab.graphData.edges
    .filter((edge) => !edge.isExcluded)
    .map((edge) => {
      const source = String(edge.source || edge.from || '').trim();
      const target = String(edge.target || edge.to || '').trim();
      return { edge, source, target };
    })
    .filter(({ source, target }) => source === nodeId || target === nodeId)
    .map(({ edge, source, target }) => {
      const direction: 'in' | 'out' = target === nodeId ? 'in' : 'out';
      const counterpartyId = direction === 'in' ? source : target;
      const counterparty = tab.graphData?.nodes.find((item) => item.id === counterpartyId);
      const counterpartyName = resolveNodeDisplayName(counterparty, counterpartyId, tab.groupMap);
      return {
        edge,
        edgeId: resolveWorkbenchEdgeId(edge),
        direction,
        counterpartyName,
      };
    });
}

function setTradeSelection(current: string[], tradeIds: string[], selected: boolean): string[] {
  const normalizedTradeIds = tradeIds.map((tradeId) => tradeId.trim()).filter(Boolean);
  if (!normalizedTradeIds.length) {
    return current;
  }
  const next = new Set(current.map((tradeId) => tradeId.trim()).filter(Boolean));
  for (const tradeId of normalizedTradeIds) {
    if (selected) {
      next.add(tradeId);
    } else {
      next.delete(tradeId);
    }
  }
  return [...next];
}

function buildAppliedExcludedTradeIds(currentExcludedTradeIds: string[], selectedTradeIds: string[]): string[] {
  return [...new Set(
    [...currentExcludedTradeIds, ...selectedTradeIds]
      .map((tradeId) => String(tradeId || '').trim())
      .filter(Boolean),
  )];
}

export function buildAppliedExcludedTradeIdsForTest(currentExcludedTradeIds: string[], selectedTradeIds: string[]): string[] {
  return buildAppliedExcludedTradeIds(currentExcludedTradeIds, selectedTradeIds);
}

interface ExcludedTradeItem {
  tradeId: string;
  payerName: string;
  payerCard: string;
  payeeName: string;
  payeeCard: string;
  amount: number;
  tradeTime: string;
  summary: string;
}

function buildExcludedTradeItems(tab: GraphTabState): ExcludedTradeItem[] {
  const facts = tab.tradeFacts ?? tab.graphData?.tradeFacts ?? {};
  return [...new Set(tab.excludedTrades.map((tradeId) => String(tradeId || '').trim()).filter(Boolean))]
    .map((tradeId) => {
      const fact = facts[tradeId];
      return {
        tradeId,
        payerName: fact?.payerAccountName || '',
        payerCard: fact?.payerTradeCard || '',
        payeeName: fact?.payeeAccountName || '',
        payeeCard: fact?.payeeTradeCard || '',
        amount: Number(fact?.tradeAmount || 0),
        tradeTime: String(fact?.tradeTime || ''),
        summary: String(fact?.tradeAbstract || fact?.remark || fact?.tradeType || ''),
      };
    })
    .sort((left, right) => {
      const leftTime = Date.parse(left.tradeTime || '');
      const rightTime = Date.parse(right.tradeTime || '');
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return rightTime - leftTime;
      }
      return right.amount - left.amount;
    });
}

function renderExcludedTradeParty(name: string, card: string): ReactNode {
  return (
    <span className="case-graph-edge-party-cell">
      <strong className="case-graph-edge-party-name">{name || card || '-'}</strong>
      {card && card !== name ? <span className="case-graph-edge-party-raw">{card}</span> : null}
    </span>
  );
}

function formatExcludedTradeAmount(value: number): string {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return '0';
  return amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function buildTradeFactsFromDetails(
  detailByEdgeId: Record<string, CaseGraphTargetDetailResult>,
): Record<string, CaseGraphTradeFact> {
  const facts: Record<string, CaseGraphTradeFact> = {};
  for (const detail of Object.values(detailByEdgeId)) {
    for (const item of detail) {
      const key = resolveTradeFactKey(item);
      if (!key) continue;
      facts[key] = {
        tradeId: String(item.tradeId ?? key),
        serialNumber: item.serialNumber ?? null,
        tradeAmount: Number(item.tradeAmount || 0),
        tradeTime: item.tradeTime ?? null,
        tradeAbstract: item.tradeAbstract || '',
        method: item.method || '转账',
        payerAccountId: item.payerAccountId ?? null,
        payerAccountName: item.payerAccountName || '',
        payerTradeCard: item.payerTradeCard || '',
        payeeAccountId: item.payeeAccountId ?? null,
        payeeAccountName: item.payeeAccountName || '',
        payeeTradeCard: item.payeeTradeCard || '',
      };
    }
  }
  return facts;
}

function buildEdgeTradeIdsFromGraph(graphData: CaseGraphData | null): Record<string, string[]> {
  const edgeTradeIds: Record<string, string[]> = {};
  for (const edge of graphData?.edges ?? []) {
    const tradeIds = (edge.tradeIds ?? []).map((tradeId) => String(tradeId || '').trim()).filter(Boolean);
    if (tradeIds.length) {
      edgeTradeIds[resolveWorkbenchEdgeId(edge)] = tradeIds;
    }
  }
  return edgeTradeIds;
}

function buildDetailItemsFromGraphTradeFacts(
  edge: CaseGraphData['edges'][number],
  tab: GraphTabState,
): CaseGraphTargetDetailResult {
  const tradeIds = new Set((edge.tradeIds ?? []).map((item) => String(item || '').trim()).filter(Boolean));
  if (!tradeIds.size) return [];
  const facts = tab.graphData?.tradeFacts ?? tab.tradeFacts ?? {};
  return [...tradeIds]
    .map((tradeId) => facts[tradeId])
    .filter((fact): fact is CaseGraphTradeFact => Boolean(fact))
    .map((fact) => ({
      tradeId: fact.tradeId || fact.serialNumber || null,
      serialNumber: fact.serialNumber ?? null,
      tradeAmount: Number(fact.tradeAmount || 0),
      tradeTime: fact.tradeTime ?? null,
      tradeAbstract: fact.tradeAbstract || fact.method || '人工补充资金往来',
      method: fact.method || '转账',
      payerAccountId: fact.payerAccountId ?? null,
      payerAccountName: fact.payerAccountName || '',
      payerTradeCard: fact.payerTradeCard || '',
      payeeAccountId: fact.payeeAccountId ?? null,
      payeeAccountName: fact.payeeAccountName || '',
      payeeTradeCard: fact.payeeTradeCard || '',
    }));
}

function mergeTargetDetailItems(
  primary: CaseGraphTargetDetailResult,
  extra: CaseGraphTargetDetailResult,
): CaseGraphTargetDetailResult {
  const seen = new Set<string>();
  const merged: CaseGraphTargetDetailResult = [];
  for (const item of [...primary, ...extra]) {
    const key = resolveTradeFactKey(item);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(item);
  }
  return merged;
}

function buildEdgeTradeIdsFromDetails(
  detailByEdgeId: Record<string, CaseGraphTargetDetailResult>,
): Record<string, string[]> {
  const edgeTradeIds: Record<string, string[]> = {};
  for (const [edgeId, detail] of Object.entries(detailByEdgeId)) {
    const tradeIds = detail.map(resolveTradeFactKey).filter(Boolean);
    if (tradeIds.length) {
      edgeTradeIds[edgeId] = tradeIds;
    }
  }
  return edgeTradeIds;
}

function resolveWorkbenchEdgeId(edge: CaseGraphData['edges'][number]): string {
  const source = String(edge.source || edge.from || '').trim();
  const target = String(edge.target || edge.to || '').trim();
  const id = String(edge.id || '').trim();
  return id || `money:${source}->${target}`;
}

function mergeGraphData(
  current: CaseGraphData | null,
  incoming: CaseGraphData | null,
  options: MergeGraphOptions = {},
): CaseGraphData | null {
  if (!current) return incoming;
  if (!incoming) return current;
  const nodesById = new Map<string, CaseGraphData['nodes'][number]>();
  const canonicalNodeIds = buildCanonicalNodeIdIndex(current.nodes);
  const endpointRemap = new Map<string, string>();
  for (const node of current.nodes) {
    const id = String(node.id || '').trim();
    if (!id) continue;
    endpointRemap.set(id, id);
    nodesById.set(id, { ...node });
  }
  for (const node of incoming.nodes) {
    const rawId = String(node.id || '').trim();
    const id = resolveCanonicalNodeId(node, canonicalNodeIds) || rawId;
    if (!id) continue;
    if (rawId) endpointRemap.set(rawId, id);
    const existing = nodesById.get(id);
    nodesById.set(id, {
      ...existing,
      ...node,
      id,
      x: finiteNumber(existing?.x) ?? finiteNumber(node.x),
      y: finiteNumber(existing?.y) ?? finiteNumber(node.y),
      isExcluded: Boolean(existing?.isExcluded || node.isExcluded),
    });
  }
  const edgesById = new Map<string, CaseGraphData['edges'][number]>();
  for (const edge of [...current.edges, ...incoming.edges]) {
    const rawSource = String(edge.source || edge.from || '').trim();
    const rawTarget = String(edge.target || edge.to || '').trim();
    const source = endpointRemap.get(rawSource) || rawSource;
    const target = endpointRemap.get(rawTarget) || rawTarget;
    if (!source || !target || source === target) continue;
    const id = `money:${source}->${target}`;
    const existing = edgesById.get(id);
    edgesById.set(id, {
      ...existing,
      ...edge,
      id,
      from: source,
      to: target,
      source,
      target,
      isExcluded: Boolean(existing?.isExcluded || edge.isExcluded),
    });
  }
  return {
    nodes: [...nodesById.values()],
    edges: [...edgesById.values()],
    tradeFacts: { ...(current.tradeFacts ?? {}), ...(incoming.tradeFacts ?? {}) },
    realityRelations: [...(current.realityRelations ?? []), ...(incoming.realityRelations ?? [])],
    excludedNodes: mergeExcludedNodes(current.excludedNodes, incoming.excludedNodes),
    investigationGroups: mergeInvestigationGroups(current.investigationGroups, incoming.investigationGroups),
  };
}

function mergeInvestigationGroups(
  current: CaseGraphData['investigationGroups'] | undefined,
  incoming: CaseGraphData['investigationGroups'] | undefined,
): CaseGraphData['investigationGroups'] {
  const groupsById = new Map<string, CaseGraphData['investigationGroups'][number]>();
  for (const group of current ?? []) {
    if (!group?.id) continue;
    groupsById.set(group.id, { ...group, memberNodeIds: [...(group.memberNodeIds ?? [])] });
  }
  for (const group of incoming ?? []) {
    if (!group?.id) continue;
    const existing = groupsById.get(group.id);
    groupsById.set(group.id, {
      ...existing,
      ...group,
      memberNodeIds: [...(group.memberNodeIds ?? existing?.memberNodeIds ?? [])],
      collapsed: group.collapsed ?? existing?.collapsed ?? true,
      x: finiteNumber(group.x) ?? finiteNumber(existing?.x) ?? undefined,
      y: finiteNumber(group.y) ?? finiteNumber(existing?.y) ?? undefined,
    });
  }
  return [...groupsById.values()];
}

function mergeOriginData(
  current: CaseGraphOriginData | null,
  incoming: CaseGraphOriginData | null,
  options: MergeGraphOptions = {},
): CaseGraphOriginData | null {
  if (!current) return incoming;
  if (!incoming) return current;
  const mergedCanvas = mergeGraphData(
    { nodes: current.nodes, edges: current.money },
    { nodes: incoming.nodes, edges: incoming.money },
    options,
  );
  return {
    ...current,
    nodes: mergedCanvas?.nodes ?? current.nodes,
    money: mergedCanvas?.edges ?? current.money,
    phone: [...current.phone, ...incoming.phone],
    groups: { ...current.groups, ...incoming.groups },
    investigationGroups: mergeInvestigationGroups(current.investigationGroups, incoming.investigationGroups),
    excludedTrades: [...new Set([...current.excludedTrades, ...incoming.excludedTrades])],
    tradeFacts: { ...(current.tradeFacts ?? {}), ...(incoming.tradeFacts ?? {}) },
    excludedNodes: mergeExcludedNodes(current.excludedNodes, incoming.excludedNodes),
    excludedAccountId: incoming.excludedAccountId ?? current.excludedAccountId,
    sourceSelectId: [...new Set([...current.sourceSelectId, ...incoming.sourceSelectId])],
  };
}

function buildCanonicalNodeIdIndex(nodes: CaseGraphData['nodes']): Map<string, string> {
  const index = new Map<string, string>();
  for (const node of nodes) {
    const nodeId = String(node.id || '').trim();
    if (!nodeId) continue;
    index.set(nodeId, nodeId);
    for (const key of nodeIdentityKeys(node)) {
      if (!index.has(key)) {
        index.set(key, nodeId);
      }
    }
  }
  return index;
}

function resolveCanonicalNodeId(
  node: CaseGraphData['nodes'][number],
  index: Map<string, string>,
): string | null {
  const nodeId = String(node.id || '').trim();
  if (nodeId && index.has(nodeId)) {
    return index.get(nodeId) ?? nodeId;
  }
  for (const key of nodeIdentityKeys(node)) {
    const canonical = index.get(key);
    if (canonical) return canonical;
  }
  return nodeId || null;
}

function nodeIdentityKeys(node: CaseGraphData['nodes'][number]): string[] {
  const keys: string[] = [];
  const pushAccountId = (value: unknown) => {
    const accountId = String(value || '').trim();
    if (accountId) {
      keys.push(`account:${accountId}`, `accountId:${accountId}`);
    }
  };
  const pushTradeCard = (value: unknown) => {
    const tradeCard = String(value || '').trim();
    if (tradeCard) {
      keys.push(`tradeCard:${tradeCard}`);
    }
  };
  pushAccountId(node.accountId);
  for (const accountId of node.accountIds ?? []) {
    pushAccountId(accountId);
  }
  pushTradeCard(node.tradeCard);
  for (const account of node.accounts ?? []) {
    pushAccountId(account.accountId);
    pushTradeCard(account.tradeCard);
  }
  return keys;
}

export function mergeGraphDataForTest(
  current: CaseGraphData | null,
  incoming: CaseGraphData | null,
  options: MergeGraphOptions = {},
): CaseGraphData | null {
  return mergeGraphData(current, incoming, options);
}

export function buildRelationOptionsForTest(
  graphData: CaseGraphData | null,
  positions: Record<string, GraphNodePoint>,
): Record<string, unknown> {
  return buildRelationOptions(graphData, positions);
}

export function buildRestoreNodesRelationOptionsForTest(
  graphData: CaseGraphData | null,
  positions: Record<string, GraphNodePoint>,
  restoreNodeIds: string[],
): Record<string, unknown> {
  void restoreNodeIds;
  return buildRelationOptions(graphData, positions);
}

export function resolveInvestigationGroupOperationPositionForTest(
  graphData: CaseGraphData | null,
  operationPayload: Omit<ApplyCaseGraphInvestigationGroupPayload, 'caseId' | 'graphId' | 'options'>,
): GraphNodePoint | null {
  return resolveInvestigationGroupOperationPosition(graphData, operationPayload);
}

export function shouldPersistGraphPositionsForTest(
  graphData: CaseGraphData | null,
  positions: Record<string, GraphNodePoint>,
  reason: 'drag',
): boolean {
  return shouldPersistGraphPositions(graphData, positions, reason);
}

export function shouldPersistLatestStepLayoutForTest(
  graphData: CaseGraphData | null,
  positions: Record<string, GraphNodePoint>,
): boolean {
  const options = buildRelationOptions(graphData, positions);
  return Boolean((options.nodePositions as Record<string, GraphNodePoint> | undefined) && Object.keys(options.nodePositions as Record<string, GraphNodePoint>).length);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function applyNodePositions(
  graphData: CaseGraphData | null,
  positions: Record<string, GraphNodePoint>,
): CaseGraphData | null {
  if (!graphData || !Object.keys(positions).length) {
    return graphData;
  }
  return {
    ...graphData,
    nodes: graphData.nodes.map((node) => {
      const point = positions[node.id];
      return point ? { ...node, x: point.x, y: point.y } : node;
    }),
  };
}

function applyGraphLayoutPositions(
  graphData: CaseGraphData | null,
  layout: CaseGraphLayoutState,
): CaseGraphData | null {
  const positionedGraphData = applyNodePositions(graphData, layout.nodePositions);
  if (!positionedGraphData) {
    return positionedGraphData;
  }
  const groupPositions = Object.fromEntries(
    Object.entries(layout.groupLayout ?? {})
      .filter(([, groupState]) => groupState?.collapsedPosition)
      .map(([groupId, groupState]) => [groupId, groupState.collapsedPosition]),
  );
  return applyInvestigationGroupPositions(positionedGraphData, groupPositions);
}

function applyInvestigationGroupPositions(
  graphData: CaseGraphData | null,
  positions: Record<string, GraphNodePoint>,
): CaseGraphData | null {
  if (!graphData || !Object.keys(positions).length) {
    return graphData;
  }
  return {
    ...graphData,
    investigationGroups: (graphData.investigationGroups ?? []).map((group) => {
      const point = positions[group.id];
      return point ? { ...group, x: point.x, y: point.y } : group;
    }),
  };
}

function resolveInvestigationGroupDragPositions(
  graphData: CaseGraphData | null,
  positions: Record<string, GraphNodePoint>,
): Record<string, GraphNodePoint> {
  const groupIds = new Set((graphData?.investigationGroups ?? []).map((group) => group.id));
  return Object.fromEntries(
    Object.entries(positions).filter(([nodeId, point]) => groupIds.has(nodeId) && finiteNumber(point.x) != null && finiteNumber(point.y) != null),
  );
}

function applyGroupDragPositionsToLayout(
  groupLayout: CaseGraphLayoutState['groupLayout'],
  graphData: CaseGraphData | null,
  positions: Record<string, GraphNodePoint>,
): CaseGraphLayoutState['groupLayout'] {
  if (!Object.keys(positions).length) {
    return { ...(groupLayout ?? {}) };
  }
  const groupsById = new Map((graphData?.investigationGroups ?? []).map((group) => [group.id, group]));
  const next = { ...(groupLayout ?? {}) };
  for (const [groupId, point] of Object.entries(positions)) {
    const group = groupsById.get(groupId);
    if (!group) continue;
    next[groupId] = {
      groupId,
      collapsedPosition: { x: point.x, y: point.y },
      memberPositionsBeforeCollapse: next[groupId]?.memberPositionsBeforeCollapse ?? collectInvestigationGroupMemberPositions(graphData, group.memberNodeIds ?? []),
      locked: true,
    };
  }
  return next;
}

function resolveMovedGroupLayoutPositions(
  groupLayout: CaseGraphLayoutState['groupLayout'],
  movedPositions: Record<string, GraphNodePoint>,
): Record<string, GraphNodePoint> {
  return Object.fromEntries(
    Object.keys(movedPositions)
      .map((groupId) => {
        const point = groupLayout?.[groupId]?.collapsedPosition;
        return point ? [groupId, point] : null;
      })
      .filter((entry): entry is [string, GraphNodePoint] => Boolean(entry)),
  );
}

function collectInvestigationGroupMemberPositions(
  graphData: CaseGraphData | null,
  memberNodeIds: string[],
): Record<string, GraphNodePoint> {
  const nodeById = new Map((graphData?.nodes ?? []).map((node) => [node.id, node]));
  const positions: Record<string, GraphNodePoint> = {};
  for (const nodeId of memberNodeIds) {
    const point = resolveNodePoint(nodeById.get(nodeId) ?? null, {});
    if (point) {
      positions[nodeId] = point;
    }
  }
  return positions;
}

function layoutStateFromPlan(plan: LayoutPlan, previous?: CaseGraphLayoutState): CaseGraphLayoutState {
  return {
    version: 2,
    nodePositions: { ...plan.nodePositions },
    positionMeta: { ...plan.positionMeta },
    groupLayout: { ...plan.groupLayout },
    viewport: previous?.viewport ?? { x: 0, y: 0, zoom: 1 },
  };
}

function addedNodeIdsFromResult(result: { delta?: Partial<CaseGraphRelationResponse['delta']> }): string[] {
  return (result.delta.addedNodes ?? [])
    .map((node) => String(node.id || '').trim())
    .filter(Boolean);
}

function resolvePrimaryNodeIdsForAccounts(
  graphData: CaseGraphData | null,
  selectedAccountIds: string[],
): string[] {
  const selected = new Set(selectedAccountIds.map((item) => String(item || '').trim()).filter(Boolean));
  if (!selected.size) return [];
  return (graphData?.nodes ?? [])
    .filter((node) => {
      const values = [
        node.id,
        node.accountId,
        node.tradeCard,
        ...(node.accounts ?? []).flatMap((account) => [account.accountId, account.tradeCard]),
      ].map((item) => String(item || '').trim());
      return values.some((value) => selected.has(value));
    })
    .map((node) => node.id);
}

function applyLayoutEventToTabPatch(
  tab: GraphTabState,
  graphData: CaseGraphData | null,
  originData: CaseGraphOriginData | null,
  event: LayoutEvent,
): { graphData: CaseGraphData | null; originData: CaseGraphOriginData | null; layout: CaseGraphLayoutState; plan: LayoutPlan } {
  const previousLayout = normalizeLayoutState(tab.layout);
  const layoutEvent = inferAddedNodeIdsForLayoutEvent(event, graphData, previousLayout);
  const plan = computeCaseGraphLayoutPlan({
    graphData,
    previousLayout,
    event: layoutEvent,
    ...LAYOUT_ENGINE_DIMENSIONS,
  });
  const positionedGraphData = applyGraphLayoutPositions(graphData, layoutStateFromPlan(plan, tab.layout));
  const positionedOriginData = originData && positionedGraphData
    ? { ...originData, nodes: positionedGraphData.nodes, money: positionedGraphData.edges }
    : originData;
  return {
    graphData: positionedGraphData,
    originData: positionedOriginData,
    layout: layoutStateFromPlan(plan, tab.layout),
    plan,
  };
}

export function applyLayoutEventToTabPatchForTest(
  tab: GraphTabState,
  graphData: CaseGraphData | null,
  originData: CaseGraphOriginData | null,
  event: LayoutEvent,
): { graphData: CaseGraphData | null; originData: CaseGraphOriginData | null; layout: CaseGraphLayoutState; plan: LayoutPlan } {
  return applyLayoutEventToTabPatch(tab, graphData, originData, event);
}

function inferAddedNodeIdsForLayoutEvent(
  event: LayoutEvent,
  graphData: CaseGraphData | null,
  previousLayout: CaseGraphLayoutState,
): LayoutEvent {
  if (!graphData || !('addedNodeIds' in event)) {
    return event;
  }
  const previousNodeIds = new Set(Object.keys(previousLayout.nodePositions ?? {}));
  const inferredAddedNodeIds = graphData.nodes
    .map((node) => String(node.id || '').trim())
    .filter((nodeId) => nodeId && !previousNodeIds.has(nodeId));
  if (!inferredAddedNodeIds.length) {
    return event;
  }
  const addedNodeIds = [...new Set([...(event.addedNodeIds ?? []), ...inferredAddedNodeIds])];
  return { ...event, addedNodeIds };
}

async function applyInitialLayoutEventToTabPatch(
  tab: GraphTabState,
  graphData: CaseGraphData | null,
  originData: CaseGraphOriginData | null,
  event: Extract<LayoutEvent, { type: 'initial_graph' }>,
): Promise<{ graphData: CaseGraphData | null; originData: CaseGraphOriginData | null; layout: CaseGraphLayoutState; plan: LayoutPlan }> {
  const plan = await computeInitialG6LayoutPlan({
    graphData,
    previousLayout: normalizeLayoutState(tab.layout),
    event,
    ...LAYOUT_ENGINE_DIMENSIONS,
  });
  const positionedGraphData = applyGraphLayoutPositions(graphData, layoutStateFromPlan(plan, tab.layout));
  const positionedOriginData = originData && positionedGraphData
    ? { ...originData, nodes: positionedGraphData.nodes, money: positionedGraphData.edges }
    : originData;
  return {
    graphData: positionedGraphData,
    originData: positionedOriginData,
    layout: layoutStateFromPlan(plan, tab.layout),
    plan,
  };
}

function hasGraphPositionsChanged(
  graphData: CaseGraphData,
  positions: Record<string, GraphNodePoint>,
): boolean {
  const hasNodeChange = graphData.nodes.some((node) => {
    const point = positions[node.id];
    if (!point) return false;
    return finiteNumber(node.x) !== point.x || finiteNumber(node.y) !== point.y;
  });
  if (hasNodeChange) {
    return true;
  }
  return (graphData.investigationGroups ?? []).some((group) => {
    const point = positions[group.id];
    if (!point) return false;
    return finiteNumber(group.x) !== point.x || finiteNumber(group.y) !== point.y;
  });
}

function shouldPersistGraphPositions(
  graphData: CaseGraphData | null,
  positions: Record<string, GraphNodePoint>,
  reason: 'drag',
): graphData is CaseGraphData {
  return reason === 'drag' &&
    Boolean(graphData?.nodes.length) &&
    Object.keys(positions).length > 0 &&
    hasGraphPositionsChanged(graphData, positions);
}

function buildRelationOptions(
  graphData: CaseGraphData | null,
  positions: Record<string, GraphNodePoint>,
): Record<string, unknown> {
  const nodePositions: Record<string, GraphNodePoint> = {};
  for (const node of graphData?.nodes ?? []) {
    const nodeId = String(node.id || '').trim();
    if (!nodeId) continue;
    const point = positions[nodeId];
    const x = finiteNumber(point?.x) ?? finiteNumber(node.x);
    const y = finiteNumber(point?.y) ?? finiteNumber(node.y);
    if (x == null || y == null) continue;
    nodePositions[nodeId] = { x, y };
  }
  return Object.keys(nodePositions).length ? { nodePositions } : {};
}

function investigationGroupLayoutEvent(
  graphData: CaseGraphData | null,
  operationPayload: Omit<ApplyCaseGraphInvestigationGroupPayload, 'caseId' | 'graphId' | 'options'>,
): LayoutEvent {
  const group = resolveInvestigationGroupForOperation(graphData, operationPayload);
  const groupId = String(group?.id || operationPayload.groupId || '').trim();
  const memberNodeIds = resolveInvestigationGroupMemberNodeIds(group, operationPayload);
  if (!groupId || !memberNodeIds.length) {
    return { type: 'layout_refresh' };
  }
  if (operationPayload.operation === 'collapse' || operationPayload.operation === 'create') {
    return { type: 'group_collapse', groupId, memberNodeIds };
  }
  if (operationPayload.operation === 'expand') {
    return { type: 'group_expand', groupId, memberNodeIds };
  }
  if (operationPayload.operation === 'ungroup') {
    return { type: 'group_split', groupId, memberNodeIds };
  }
  return { type: 'layout_refresh' };
}

function resolveInvestigationGroupOperationPosition(
  graphData: CaseGraphData | null,
  operationPayload: Omit<ApplyCaseGraphInvestigationGroupPayload, 'caseId' | 'graphId' | 'options'>,
): GraphNodePoint | null {
  if (!graphData) {
    return null;
  }
  if (operationPayload.operation === 'create') {
    return resolveNodesBoundingBoxCenter(graphData, operationPayload.nodeIds ?? []);
  }
  const groupId = String(operationPayload.groupId || '').trim();
  const group = groupId
    ? (graphData.investigationGroups ?? []).find((item) => item.id === groupId) ?? null
    : null;
  if (!group) {
    return null;
  }
  const groupX = finiteNumber(group.x);
  const groupY = finiteNumber(group.y);
  if (groupX != null && groupY != null) {
    return { x: groupX, y: groupY };
  }
  return resolveNodesBoundingBoxCenter(graphData, group.memberNodeIds ?? []);
}

function resolveInvestigationGroupForOperation(
  graphData: CaseGraphData | null,
  operationPayload: Omit<ApplyCaseGraphInvestigationGroupPayload, 'caseId' | 'graphId' | 'options'>,
) {
  const groups = graphData?.investigationGroups ?? [];
  const groupId = String(operationPayload.groupId || '').trim();
  if (groupId) {
    return groups.find((group) => group.id === groupId) ?? null;
  }
  const payloadNodeIds = new Set((operationPayload.nodeIds ?? []).map((nodeId) => String(nodeId || '').trim()).filter(Boolean));
  if (!payloadNodeIds.size) {
    return null;
  }
  return groups.find((group) => {
    const members = new Set((group.memberNodeIds ?? []).map((nodeId) => String(nodeId || '').trim()).filter(Boolean));
    return payloadNodeIds.size === members.size && [...payloadNodeIds].every((nodeId) => members.has(nodeId));
  }) ?? null;
}

function resolveInvestigationGroupMemberNodeIds(
  group: CaseGraphData['investigationGroups'][number] | null | undefined,
  operationPayload: Omit<ApplyCaseGraphInvestigationGroupPayload, 'caseId' | 'graphId' | 'options'>,
): string[] {
  const ids = operationPayload.nodeIds?.length
    ? operationPayload.nodeIds
    : operationPayload.memberNodeIds?.length
      ? operationPayload.memberNodeIds
      : group?.memberNodeIds ?? [];
  return ids.map((nodeId) => String(nodeId || '').trim()).filter(Boolean);
}

function resolveNodesBoundingBoxCenter(
  graphData: CaseGraphData,
  nodeIds: string[],
): GraphNodePoint | null {
  const nodeById = new Map(graphData.nodes.map((node) => [node.id, node]));
  const points = nodeIds
    .map((nodeId) => resolveNodePoint(nodeById.get(nodeId) ?? null, {}))
    .filter((point): point is GraphNodePoint => Boolean(point));
  if (!points.length) {
    return null;
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

function resolveNodePoint(
  node: CaseGraphData['nodes'][number] | null | undefined,
  positions: Record<string, GraphNodePoint>,
): GraphNodePoint | null {
  if (!node) {
    return null;
  }
  const nodeId = String(node.id || '').trim();
  const point = positions[nodeId];
  const x = finiteNumber(point?.x) ?? finiteNumber(node.x);
  const y = finiteNumber(point?.y) ?? finiteNumber(node.y);
  return x == null || y == null ? null : { x, y };
}

function buildRelationSeedFromNode(
  node: CaseGraphNode,
  fallbackTradeCard: CaseGraphTradeCard | null,
) {
  const accounts = (Array.isArray(node.accounts) && node.accounts.length
    ? node.accounts
    : fallbackTradeCard
      ? [fallbackTradeCard]
      : [
          {
            accountId: node.accountId ?? undefined,
            tradeCard: node.tradeCard,
            accountName: node.accountName || node.label || node.name,
          },
        ])
    .map((account) => ({
      ...account,
      accountId: account.accountId == null ? undefined : String(account.accountId),
      tradeCard: account.tradeCard == null ? undefined : String(account.tradeCard),
      accountName: account.accountName == null ? undefined : String(account.accountName),
    }))
    .filter((account) => String(account.accountId || account.tradeCard || '').trim());
  const accountIds = [...new Set(accounts.map((account) => String(account.accountId || '').trim()).filter(Boolean))];
  const suspectId = String(node.accounts?.[0]?.suspectId || fallbackTradeCard?.suspectId || '').trim();
  const suspectName = String(node.accounts?.[0]?.suspectName || fallbackTradeCard?.suspectName || node.accountName || node.label || node.name || '').trim();
  return {
    suspectId,
    suspectName,
    accountIds,
    excludedAccountIds: [],
    accounts,
  };
}

function mergeActionFilters(base: CaseGraphFilterState, filters: CaseGraphChatActionFilters): CaseGraphFilterState {
  return {
    minAmount: filters.minAmount == null ? base.minAmount : String(filters.minAmount).trim(),
    maxAmount: filters.maxAmount == null ? base.maxAmount : String(filters.maxAmount).trim(),
    startTime: filters.startTime == null ? base.startTime : String(filters.startTime).trim(),
    endTime: filters.endTime == null ? base.endTime : String(filters.endTime).trim(),
  };
}

function normalizeActionDirectionForExecute(direction: CaseGraphChatActionDirection | undefined): DrillDirection {
  return direction === 'in' || direction === 'out' || direction === 'both' ? direction : 'both';
}

function resolveNodeForAction(
  action: CaseGraphChatAction,
  tab: GraphTabState,
  focus: CaseGraphConversationFocus | null,
): { node: CaseGraphNode | null; error?: string } {
  const nodes = tab.graphData?.nodes ?? [];
  if (!nodes.length) {
    return { node: null, error: '当前图上还没有主体' };
  }
  const explicitId = normalizeActionSearchText(action.nodeId || '');
  if (explicitId) {
    const node = nodes.find((item) => normalizeActionSearchText(item.id) === explicitId);
    if (node) return { node };
  }
  const query = normalizeActionSearchText(action.nodeQuery || action.nodeName || '');
  if (!query && focus?.type === 'node') {
    const focusedNode = nodes.find((item) => item.id === focus.nodeId);
    if (focusedNode) return { node: focusedNode };
  }
  if (!query) {
    return { node: null, error: '请先在图上选中主体，或在对话中说清楚主体名称、账号或卡号' };
  }
  const exactMatches = nodes.filter((node) => collectNodeSearchTexts(node, tab.groupMap).some((text) => text === query));
  if (exactMatches.length === 1) return { node: exactMatches[0]! };
  if (exactMatches.length > 1) return { node: null, error: '找到多个同名主体，请补充账号或节点名称' };
  const partialMatches = nodes.filter((node) => collectNodeSearchTexts(node, tab.groupMap).some((text) => text.includes(query) || query.includes(text)));
  if (partialMatches.length === 1) return { node: partialMatches[0]! };
  if (partialMatches.length > 1) return { node: null, error: '找到多个相近主体，请补充账号或更完整名称' };
  return { node: null, error: '没有在当前图上找到这个主体' };
}

function resolveExcludedNodeForAction(
  action: CaseGraphChatAction,
  tab: GraphTabState,
): { node: CaseGraphExcludedNode | null; error?: string } {
  const nodes = tab.excludedNodes ?? [];
  if (!nodes.length) {
    return { node: null, error: '当前没有已取消上图的主体' };
  }
  const explicitId = normalizeActionSearchText(action.nodeId || '');
  if (explicitId) {
    const node = nodes.find((item) => normalizeActionSearchText(item.nodeId) === explicitId);
    if (node) return { node };
  }
  const query = normalizeActionSearchText(action.nodeQuery || action.nodeName || '');
  if (!query) {
    return { node: null, error: '请说明要恢复哪个主体' };
  }
  const matches = nodes.filter((node) => collectExcludedNodeSearchTexts(node).some((text) => text === query));
  if (matches.length === 1) return { node: matches[0]! };
  if (matches.length > 1) return { node: null, error: '找到多个已取消上图主体，请补充账号或完整名称' };
  const partialMatches = nodes.filter((node) => collectExcludedNodeSearchTexts(node).some((text) => text.includes(query) || query.includes(text)));
  if (partialMatches.length === 1) return { node: partialMatches[0]! };
  if (partialMatches.length > 1) return { node: null, error: '找到多个相近主体，请补充账号或完整名称' };
  return { node: null, error: '没有找到这个已取消上图的主体' };
}

type TradeActionScope =
  | { kind: 'all' }
  | { kind: 'node'; node: CaseGraphNode; direction: DrillDirection }
  | { kind: 'pair'; fromNode: CaseGraphNode; toNode: CaseGraphNode; direction: DrillDirection };

function resolveTradeIdsForAction(
  action: CaseGraphChatAction,
  tab: GraphTabState,
  focus: CaseGraphConversationFocus | null,
): { tradeIds: string[]; error?: string } {
  const facts = tab.tradeFacts ?? tab.graphData?.tradeFacts ?? {};
  const factEntries = Object.entries(facts);
  if (!factEntries.length) {
    return { tradeIds: [], error: '当前图还没有可用于筛选的交易流水事实' };
  }
  const scope = resolveTradeActionScope(action, tab, focus);
  if (scope.error || !scope.scope) {
    return { tradeIds: [], error: scope.error || '请说明要处理哪一段交易流水' };
  }
  const filterCount = Object.keys(action.filters ?? {}).length;
  if (action.selection === 'outside' && filterCount === 0) {
    return { tradeIds: [], error: '保留交易流水需要说明金额、时间或关键词条件' };
  }

  const graphTradeIds = new Set(
    (tab.graphData?.edges ?? [])
      .flatMap((edge) => edge.tradeIds ?? [])
      .map(normalizeTradeId)
      .filter(Boolean),
  );
  const excludedTradeIds = new Set(tab.excludedTrades.map(normalizeTradeId).filter(Boolean));
  const candidateIds = new Set(action.type === 'restore_trades' ? excludedTradeIds : graphTradeIds);
  if (!candidateIds.size && action.type === 'restore_trades') {
    return { tradeIds: [], error: '当前没有已排除的交易流水' };
  }
  if (!candidateIds.size) {
    return { tradeIds: [], error: '当前图上没有可处理的交易流水' };
  }

  const scopedTradeIds = factEntries
    .map(([key, fact]) => ({ tradeId: resolveTradeFactId(key, fact), fact }))
    .filter(({ tradeId }) => tradeId && candidateIds.has(tradeId))
    .filter(({ fact }) => tradeFactMatchesScope(fact, scope.scope!, tab))
    .filter(({ fact }) => {
      const matches = tradeFactMatchesFilters(fact, action.filters ?? {});
      return action.selection === 'outside' ? !matches : matches;
    })
    .map(({ tradeId }) => tradeId);
  const matchedTradeIds = action.type === 'restore_trades'
    ? scopedTradeIds
    : scopedTradeIds.filter((tradeId) => !excludedTradeIds.has(tradeId));

  const uniqueTradeIds = [...new Set(matchedTradeIds)];
  if (!uniqueTradeIds.length) {
    const uniqueScopedTradeIds = [...new Set(scopedTradeIds)];
    if (action.type === 'exclude_trades' && uniqueScopedTradeIds.length) {
      return { tradeIds: [], error: '符合条件的交易流水已经全部排除' };
    }
    return { tradeIds: [], error: action.type === 'restore_trades' ? '没有找到符合条件的已排除交易流水' : '没有找到符合条件的交易流水' };
  }
  return { tradeIds: uniqueTradeIds };
}

function resolveClueExtensionScopeForAction(
  action: CaseGraphChatAction,
  tab: GraphTabState,
  focus: CaseGraphConversationFocus | null,
): { scope: 'node' | 'global'; node: CaseGraphNode | null; error?: string } {
  if (action.clueScope === 'global' || action.all) {
    return { scope: 'global', node: null };
  }
  const node = resolveNodeForAction(action, tab, focus);
  if (node.error || !node.node) {
    return { scope: 'node', node: null, error: node.error || '请说明要围绕哪个主体做综合筛选' };
  }
  return { scope: 'node', node: node.node };
}

function buildManualTradeFormForAction(
  action: CaseGraphChatAction,
  tab: GraphTabState,
): {
  payload?: Omit<AddCaseGraphManualTradePayload, 'caseId' | 'graphId' | 'options'>;
  error?: string;
} {
  const amount = parseActionAmount(action.amount);
  if (amount == null || amount <= 0) {
    return { error: '请说明补充资金往来的交易金额' };
  }
  const payer = resolveManualPartyForAction(action, tab, 'payer');
  if (payer.error || !payer.payload) {
    return { error: payer.error || '请说明付款方' };
  }
  const payee = resolveManualPartyForAction(action, tab, 'payee');
  if (payee.error || !payee.payload) {
    return { error: payee.error || '请说明收款方' };
  }
  if (payer.created && payee.created) {
    return { error: '补充资金往来至少需要一端是当前图上的主体' };
  }
  const payerId = String(payer.payload.nodeId || payer.payload.id || '').trim();
  const payeeId = String(payee.payload.nodeId || payee.payload.id || '').trim();
  if (payerId && payeeId && payerId === payeeId) {
    return { error: '付款方和收款方不能是同一个主体' };
  }
  return {
    payload: {
      payer: payer.payload,
      payee: payee.payload,
      amount,
      tradeTime: action.tradeTime?.trim() || null,
      method: '现金交易',
      summary: action.summary?.trim() || action.reason?.trim() || '',
      sourceNote: action.sourceNote?.trim() || action.note?.trim() || '',
    },
  };
}

function resolveManualPartyForAction(
  action: CaseGraphChatAction,
  tab: GraphTabState,
  side: 'payer' | 'payee',
): { payload?: CaseGraphManualPartyPayload; created: boolean; error?: string } {
  const query = String(side === 'payer' ? action.payerQuery || '' : action.payeeQuery || '').trim();
  const tradeCard = String(side === 'payer' ? action.payerTradeCard || '' : action.payeeTradeCard || '').trim();
  const createNew = side === 'payer' ? Boolean(action.payerCreateNew) : Boolean(action.payeeCreateNew);
  const label = query || tradeCard;
  const sideLabel = side === 'payer' ? '付款方' : '收款方';
  if (createNew) {
    if (!label) {
      return { created: true, error: `请说明新建${sideLabel}的名称或账号` };
    }
    return {
      created: true,
      payload: {
        label,
        name: label,
        accountName: label,
        tradeCard: tradeCard || undefined,
        createNew: true,
      },
    };
  }
  if (!query && !tradeCard) {
    return { created: false, error: `请说明${sideLabel}` };
  }
  const resolved = resolveNodeByActionQuery(query || tradeCard, tab);
  if (resolved.error || !resolved.node) {
    return { created: false, error: `没有找到${sideLabel}：${query || tradeCard}` };
  }
  return { created: false, payload: manualPartyPayloadFromGraphNode(resolved.node) };
}

function manualPartyPayloadFromGraphNode(node: CaseGraphNode): CaseGraphManualPartyPayload {
  const primaryAccount = Array.isArray(node.accounts) ? node.accounts[0] : undefined;
  return {
    nodeId: node.id,
    id: node.id,
    label: node.label || node.name || node.accountName || primaryAccount?.accountName || node.tradeCard || node.id,
    name: node.name || node.label || node.accountName || primaryAccount?.accountName,
    accountName: node.accountName || node.name || node.label || primaryAccount?.accountName,
    accountId: node.accountId ?? primaryAccount?.accountId ?? null,
    tradeCard: node.tradeCard || primaryAccount?.tradeCard || undefined,
  };
}

function buildRealityRelationFormForAction(
  action: CaseGraphChatAction,
  tab: GraphTabState,
): {
  payload?: Omit<AddCaseGraphRealityRelationPayload, 'caseId' | 'graphId' | 'options'>;
  error?: string;
} {
  const sourceQuery = String(action.sourceNodeQuery || action.fromQuery || action.nodeQuery || '').trim();
  const targetQuery = String(action.targetNodeQuery || action.toQuery || action.counterpartyQuery || '').trim();
  if (!sourceQuery || !targetQuery) {
    return { error: '请说明要标注现实关系的两个主体' };
  }
  const relationType = String(action.relationType || action.label || '').trim();
  if (!relationType) {
    return { error: '请说明现实关系类型，例如母女、亲属、同伙或上下级' };
  }
  const source = resolveNodeByActionQuery(sourceQuery, tab);
  if (source.error || !source.node) {
    return { error: `没有找到关系一方：${sourceQuery}` };
  }
  const target = resolveNodeByActionQuery(targetQuery, tab);
  if (target.error || !target.node) {
    return { error: `没有找到关系另一方：${targetQuery}` };
  }
  if (source.node.id === target.node.id) {
    return { error: '现实关系两端不能是同一个主体' };
  }
  return {
    payload: {
      sourceNodeId: source.node.id,
      targetNodeId: target.node.id,
      relationType,
      label: relationType,
      note: action.note?.trim() || action.reason?.trim() || '',
    },
  };
}

function filterSummaryCandidatesForAction(items: SummaryAnalysisItem[], action: CaseGraphChatAction): SummaryAnalysisItem[] {
  return items
    .filter((item) => item.status === 'candidate' || (!item.isOnGraph && !item.isExcluded))
    .filter((item) => summaryCandidateMatchesFilters(item, action));
}

function summaryCandidateMatchesFilters(item: SummaryAnalysisItem, action: CaseGraphChatAction): boolean {
  const filters = action.filters ?? {};
  const direction = normalizeActionDirectionForExecute(action.direction);
  const amount = summaryCandidateAmountForDirection(item, direction);
  const tradeCount = summaryCandidateCountForDirection(item, direction);
  const minAmount = parseActionAmount(filters.minAmount);
  const maxAmount = parseActionAmount(filters.maxAmount);
  const minTradeCount = parseActionCount(filters.minTradeCount);
  const maxTradeCount = parseActionCount(filters.maxTradeCount);
  if (minAmount != null && amount < minAmount) return false;
  if (maxAmount != null && amount > maxAmount) return false;
  if (minTradeCount != null && tradeCount < minTradeCount) return false;
  if (maxTradeCount != null && tradeCount > maxTradeCount) return false;
  if (filters.startTime && item.endTime && String(item.endTime).slice(0, 10) < String(filters.startTime).slice(0, 10)) return false;
  if (filters.endTime && item.startTime && String(item.startTime).slice(0, 10) > String(filters.endTime).slice(0, 10)) return false;
  const keyword = normalizeActionSearchText(filters.keyword || '');
  if (keyword) {
    const text = [
      item.label,
      item.accountText,
      ...(item.accounts ?? []).flatMap((account) => [account.accountId, account.accountName, account.tradeCard]),
    ].map((value) => normalizeActionSearchText(value)).join(' ');
    if (!text.includes(keyword)) return false;
  }
  return true;
}

function summaryCandidateAmountForDirection(item: SummaryAnalysisItem, direction: DrillDirection): number {
  if (direction === 'in') return Number(item.receivedAmount || 0);
  if (direction === 'out') return Number(item.paidAmount || 0);
  return Number(item.totalAmount || 0);
}

function summaryCandidateCountForDirection(item: SummaryAnalysisItem, direction: DrillDirection): number {
  if (direction === 'in') return Number(item.receivedCount || 0);
  if (direction === 'out') return Number(item.paidCount || 0);
  return Number((item.receivedCount || 0) + (item.paidCount || 0)) || (item.tradeIds ?? []).length;
}

function resolveTradeActionScope(
  action: CaseGraphChatAction,
  tab: GraphTabState,
  focus: CaseGraphConversationFocus | null,
): { scope: TradeActionScope | null; error?: string } {
  const direction = normalizeActionDirectionForExecute(action.direction);
  const fromQuery = String(action.fromQuery || '').trim();
  const toQuery = String(action.toQuery || '').trim();
  if (fromQuery && toQuery) {
    const fromNode = resolveNodeByActionQuery(fromQuery, tab);
    if (fromNode.error || !fromNode.node) return { scope: null, error: `没有找到付款方：${fromQuery}` };
    const toNode = resolveNodeByActionQuery(toQuery, tab);
    if (toNode.error || !toNode.node) return { scope: null, error: `没有找到收款方：${toQuery}` };
    return { scope: { kind: 'pair', fromNode: fromNode.node, toNode: toNode.node, direction } };
  }

  const nodeQuery = String(action.nodeQuery || action.nodeName || '').trim();
  const counterpartyQuery = String(action.counterpartyQuery || '').trim();
  if (nodeQuery && counterpartyQuery) {
    const node = resolveNodeByActionQuery(nodeQuery, tab);
    if (node.error || !node.node) return { scope: null, error: `没有找到主体：${nodeQuery}` };
    const counterparty = resolveNodeByActionQuery(counterpartyQuery, tab);
    if (counterparty.error || !counterparty.node) return { scope: null, error: `没有找到交易对手：${counterpartyQuery}` };
    if (direction === 'in') {
      return { scope: { kind: 'pair', fromNode: counterparty.node, toNode: node.node, direction: 'out' } };
    }
    if (direction === 'out') {
      return { scope: { kind: 'pair', fromNode: node.node, toNode: counterparty.node, direction: 'out' } };
    }
    return { scope: { kind: 'pair', fromNode: node.node, toNode: counterparty.node, direction: 'both' } };
  }

  const resolvedNode = resolveNodeForAction(action, tab, focus);
  if (resolvedNode.node) {
    return { scope: { kind: 'node', node: resolvedNode.node, direction } };
  }

  if (focus?.type === 'edge') {
    const nodes = tab.graphData?.nodes ?? [];
    const sourceNode = nodes.find((node) => node.id === focus.from);
    const targetNode = nodes.find((node) => node.id === focus.to);
    if (sourceNode && targetNode) {
      return { scope: { kind: 'pair', fromNode: sourceNode, toNode: targetNode, direction: 'both' } };
    }
  }

  if (action.all || Object.keys(action.filters ?? {}).length) {
    return { scope: { kind: 'all' } };
  }
  return { scope: null, error: '请说明主体、交易对手，或给出要处理的金额/时间条件' };
}

function resolveNodeByActionQuery(query: string, tab: GraphTabState): { node: CaseGraphNode | null; error?: string } {
  return resolveNodeForAction({ type: 'exclude_node', nodeQuery: query }, tab, null);
}

function resolveTradeFactId(key: string, fact: CaseGraphTradeFact): string {
  return normalizeTradeId(fact.tradeId || fact.serialNumber || key);
}

function normalizeTradeId(value: unknown): string {
  return String(value ?? '').trim();
}

function tradeFactMatchesScope(fact: CaseGraphTradeFact, scope: TradeActionScope, tab: GraphTabState): boolean {
  if (scope.kind === 'all') return true;
  if (scope.kind === 'node') {
    const payer = tradeFactMatchesNodeSide(fact, scope.node, tab, 'payer');
    const payee = tradeFactMatchesNodeSide(fact, scope.node, tab, 'payee');
    if (scope.direction === 'in') return payee;
    if (scope.direction === 'out') return payer;
    return payer || payee;
  }
  const forward = tradeFactMatchesNodeSide(fact, scope.fromNode, tab, 'payer')
    && tradeFactMatchesNodeSide(fact, scope.toNode, tab, 'payee');
  const backward = tradeFactMatchesNodeSide(fact, scope.toNode, tab, 'payer')
    && tradeFactMatchesNodeSide(fact, scope.fromNode, tab, 'payee');
  if (scope.direction === 'out') return forward;
  if (scope.direction === 'in') return backward;
  return forward || backward;
}

function tradeFactMatchesNodeSide(
  fact: CaseGraphTradeFact,
  node: CaseGraphNode,
  tab: GraphTabState,
  side: 'payer' | 'payee',
): boolean {
  const nodeTexts = collectNodeSearchTexts(node, tab.groupMap);
  const values = side === 'payer'
    ? [fact.payerAccountId, fact.payerAccountName, fact.payerTradeCard]
    : [fact.payeeAccountId, fact.payeeAccountName, fact.payeeTradeCard];
  const factTexts = values.map((value) => normalizeActionSearchText(value)).filter(Boolean);
  return factTexts.some((factText) =>
    nodeTexts.some((nodeText) => factText === nodeText || factText.includes(nodeText) || nodeText.includes(factText)),
  );
}

function tradeFactMatchesFilters(fact: CaseGraphTradeFact, filters: CaseGraphChatActionFilters): boolean {
  const amount = Number(fact.tradeAmount || 0);
  const minAmount = parseActionAmount(filters.minAmount);
  const maxAmount = parseActionAmount(filters.maxAmount);
  if (minAmount != null && amount < minAmount) return false;
  if (maxAmount != null && amount > maxAmount) return false;
  const tradeDate = String(fact.tradeTime || '').slice(0, 10);
  if (filters.startTime && tradeDate && tradeDate < String(filters.startTime).slice(0, 10)) return false;
  if (filters.endTime && tradeDate && tradeDate > String(filters.endTime).slice(0, 10)) return false;
  const keyword = normalizeActionSearchText(filters.keyword || '');
  if (keyword) {
    const text = [
      fact.tradeId,
      fact.serialNumber,
      fact.tradeAbstract,
      fact.payerAccountName,
      fact.payerTradeCard,
      fact.payeeAccountName,
      fact.payeeTradeCard,
    ].map((value) => normalizeActionSearchText(value)).join(' ');
    if (!text.includes(keyword)) return false;
  }
  return true;
}

function parseActionAmount(value: unknown): number | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const normalized = Number(text.replace(/[,\s，]/g, '').replace(/[元]/g, '').replace(/万$/, '')) * (/万/.test(text) ? 10000 : 1);
  return Number.isFinite(normalized) ? normalized : null;
}

function parseActionCount(value: unknown): number | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const normalized = Number(text.replace(/[,\s，]/g, '').replace(/[笔次条]/g, ''));
  return Number.isFinite(normalized) ? normalized : null;
}

function buildExcludedNodePayloadFromGraphNode(node: CaseGraphNode): CaseGraphExcludedNode {
  const accounts = Array.isArray(node.accounts) ? node.accounts : [];
  const accountIds = accounts.map((account) => String(account.accountId || '').trim()).filter(Boolean);
  const tradeCards = accounts.map((account) => String(account.tradeCard || '').trim()).filter(Boolean);
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

function summaryAnalysisItemAction(item: SummaryAnalysisItem): SummaryAnalysisItemAction {
  if (item.status === 'on_graph' || item.isOnGraph) return 'exclude';
  if (item.status === 'excluded' || item.isExcluded) return 'restore';
  return 'add';
}

function buildExcludedNodePayloadsFromSummaryItems(
  items: SummaryAnalysisItem[],
  tab: GraphTabState,
): CaseGraphExcludedNode[] {
  const graphNodes = new Map((tab.graphData?.nodes ?? []).map((node) => [String(node.id || '').trim(), node]));
  return items
    .map((item) => {
      const nodeId = String(item.nodeId || '').trim();
      const graphNode = graphNodes.get(nodeId);
      if (graphNode) {
        return buildExcludedNodePayloadFromGraphNode(graphNode);
      }
      const accountIds = (item.accounts ?? [])
        .map((account) => String(account.accountId || '').trim())
        .filter(Boolean);
      const tradeCards = (item.accounts ?? [])
        .map((account) => String(account.tradeCard || '').trim())
        .filter(Boolean);
      if (!nodeId && !accountIds.length && !tradeCards.length) {
        return null;
      }
      return {
        nodeId,
        label: String(item.label || nodeId || '').trim(),
        type: 'account',
        accountIds: [...new Set(accountIds)],
        tradeCards: [...new Set(tradeCards)],
        reason: 'manual',
      };
    })
    .filter((node): node is CaseGraphExcludedNode => Boolean(node));
}

function resolveTradeCardForGraphNode(
  node: CaseGraphNode,
  availableAccounts: CaseGraphSelectableAccount[],
): CaseGraphTradeCard | null {
  const candidateIds = [
    String(node.accountId || '').trim(),
    String(node.tradeCard || '').trim(),
    String(node.id || '').trim(),
  ].filter(Boolean);
  const matched = availableAccounts.find((account) =>
    candidateIds.includes(String(account.accountId || '').trim())
    || candidateIds.includes(String(account.tradeCard || '').trim()),
  );
  if (matched) {
    return {
      accountId: matched.accountId,
      tradeCard: matched.tradeCard,
      accountName: matched.accountName,
      suspectId: matched.suspectId,
      suspectName: matched.suspectName,
    };
  }
  if (Array.isArray(node.accounts) && node.accounts.length) {
    return node.accounts[0] ?? null;
  }
  if (node.tradeCard || node.accountId || node.id) {
    return {
      accountId: node.accountId ?? null,
      tradeCard: node.tradeCard || undefined,
      accountName: node.accountName || node.label || node.name,
    };
  }
  return null;
}

function collectNodeSearchTexts(node: CaseGraphNode, groupMap: CaseGraphGroupMap): string[] {
  const group = groupMap[node.id] || (node.groupId ? groupMap[node.groupId] : undefined);
  const values = [
    node.id,
    node.label,
    node.name,
    node.accountName,
    node.accountId,
    node.tradeCard,
    node.groupId,
    node.groupName,
    group?.groupId,
    group?.groupName,
    ...(node.accounts ?? []).flatMap((account) => [
      account.accountId,
      account.accountName,
      account.tradeCard,
      account.suspectName,
    ]),
  ];
  return [...new Set(values.map((value) => normalizeActionSearchText(value)).filter(Boolean))];
}

function collectExcludedNodeSearchTexts(node: CaseGraphExcludedNode): string[] {
  return [...new Set([
    node.nodeId,
    node.label,
    ...(node.accountIds ?? []),
    ...(node.tradeCards ?? []),
  ].map((value) => normalizeActionSearchText(value)).filter(Boolean))];
}

function normalizeActionSearchText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

function mergeExcludedNodes(
  current: CaseGraphOriginData['excludedNodes'],
  incoming: CaseGraphOriginData['excludedNodes'],
): CaseGraphOriginData['excludedNodes'] {
  const nodesById = new Map<string, CaseGraphOriginData['excludedNodes'][number]>();
  for (const node of [...(current ?? []), ...(incoming ?? [])]) {
    const id = String(node.nodeId || '').trim();
    if (!id) continue;
    nodesById.set(id, { ...nodesById.get(id), ...node });
  }
  return [...nodesById.values()];
}

function resolveFocusLabels(
  cards: FocusLabelSource[],
  selectedAccountIds: string[],
): string[] {
  const selectedIdSet = new Set(selectedAccountIds.map((item) => String(item || '').trim()).filter(Boolean));
  const sourceCards = selectedIdSet.size
    ? cards.filter((card) => selectedIdSet.has(String(card.accountId || '').trim()))
    : cards;
  const values = sourceCards.flatMap((card) => [
    String(card.accountName || '').trim(),
    String(card.suspectName || '').trim(),
    String(card.tradeCard || '').trim(),
  ]);
  return [...new Set(values.filter(Boolean))];
}

function resolveNodePartyCards(
  node: CaseGraphData['nodes'][number] | undefined,
  tab: GraphTabState,
): CaseGraphTradeCard[] {
  if (!node) {
    return [];
  }
  const nodeId = String(node.id || '').trim();
  const direct = tab.tradeCards.filter((item) => {
    const accountId = String(item.accountId || '').trim();
    const tradeCard = String(item.tradeCard || '').trim();
    return nodeId === accountId || nodeId === tradeCard;
  });
  if (direct.length > 0) {
    return direct;
  }
  const groupItem = tab.groupMap[nodeId];
  if (groupItem?.tradeCard && Array.isArray(groupItem.tradeCard)) {
    return [...groupItem.tradeCard];
  }
  const groupById = Object.values(tab.groupMap).find((item) => String(item.groupId || '').trim() === nodeId);
  if (groupById?.tradeCard) {
    return [...groupById.tradeCard];
  }
  const groupByMember = Object.values(tab.groupMap).find((item) =>
    Array.isArray(item.tradeCard) &&
    item.tradeCard.some((card) => {
      const accountId = String(card.accountId || '').trim();
      const tradeCard = String(card.tradeCard || '').trim();
      const accountName = String(card.accountName || '').trim();
      return nodeId === accountId || nodeId === tradeCard || nodeId === accountName;
    }),
  );
  if (groupByMember?.tradeCard) {
    return [...groupByMember.tradeCard];
  }
  return [
    {
      accountId: node.accountId ?? null,
      tradeCard: node.tradeCard || undefined,
      accountName: node.accountName || node.label || node.name,
    },
  ].filter((item) => item.accountId || item.tradeCard || item.accountName);
}

function resolveNodeDisplayName(
  node: CaseGraphData['nodes'][number] | undefined,
  fallbackId: string,
  groupMap: CaseGraphGroupMap,
): string {
  if (node?.accountName || node?.label || node?.name) {
    return String(node.accountName || node.label || node.name || fallbackId).trim();
  }
  const directGroup = groupMap[fallbackId];
  if (directGroup?.groupName) {
    return String(directGroup.groupName).trim();
  }
  const byGroupId = Object.values(groupMap).find((item) => String(item.groupId || '').trim() === fallbackId);
  if (byGroupId?.groupName) {
    return String(byGroupId.groupName).trim();
  }
  return fallbackId;
}

function findCaseGraphSkill(skills: SkillCandidate[]): SkillCandidate | null {
  return skills.find((skill) => {
    const normalized = skill.name.trim().toLowerCase();
    return skill.name.trim() === '图谱研判助手'
      || normalized === 'case graph analyst'
      || normalized === 'case-graph-analyst'
      || normalized.includes('graph analyst');
  }) ?? null;
}

function formatCaseGraphSkillLabel(skill: SkillCandidate | null): string {
  if (!skill) {
    return '';
  }
  const normalized = skill.name.trim().toLowerCase();
  if (
    skill.name.trim() === '图谱研判助手'
    || normalized === 'case graph analyst'
    || normalized === 'case-graph-analyst'
    || normalized.includes('graph analyst')
  ) {
    return '图谱研判助手';
  }
  return skill.name;
}

function findCaseGraphOperatorSkill(skills: SkillCandidate[]): SkillCandidate | null {
  return skills.find((skill) => {
    const normalized = skill.name.trim().toLowerCase();
    return skill.name.trim() === '图谱操作助手'
      || normalized === 'case graph operator'
      || normalized === 'case-graph-operator'
      || normalized.includes('graph operator');
  }) ?? null;
}

function formatCaseGraphOperatorSkillLabel(skill: SkillCandidate | null): string {
  if (!skill) {
    return '';
  }
  const normalized = skill.name.trim().toLowerCase();
  if (
    skill.name.trim() === '图谱操作助手'
    || normalized === 'case graph operator'
    || normalized === 'case-graph-operator'
    || normalized.includes('graph operator')
  ) {
    return '图谱操作助手';
  }
  return skill.name;
}

function isCaseGraphOperationIntent(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }
  return (
    /(上钻|下钻|双向钻取|钻取|扩展|查看上游|查看下游|查上游|查下游)/.test(normalized)
    || /(取消|移除|排除).{0,8}(上图|主体|节点|对象)/.test(normalized)
    || /(恢复|还原).{0,12}(上图|主体|节点|对象|已取消上图|已排除)/.test(normalized)
    || /(清空|重置|清除).{0,8}筛选/.test(normalized)
    || /(补全|核查).{0,12}(关系|资金关系|资金往来)/.test(normalized)
    || /(筛选|过滤|只看|只保留).{0,16}(金额|资金线|交易|时间)/.test(normalized)
    || /(金额|资金线|交易).{0,12}(不少于|不低于|大于等于|超过|高于|不超过|低于|小于等于)/.test(normalized)
    || /(创建|新增|新建).{0,12}(交易主体|主体|交易对象|节点)/.test(normalized)
    || /(补充|新增|添加|手动).{0,12}(资金往来|交易流水|交易|转账)/.test(normalized)
    || /(标注|添加|新增|记录).{0,12}(现实关系|亲属关系|关系)/.test(normalized)
    || /有个新的交易主体|有一笔.{0,12}(交易|资金往来|转账)/.test(normalized)
  );
}

function resolveNodePartyCardsById(
  nodeId: string,
  tab: GraphTabState,
): CaseGraphTradeCard[] {
  if (isGroupNodeId(nodeId)) {
    const groupId = nodeId.slice('group:'.length);
    const directGroup = Object.values(tab.groupMap).find((item) => String(item.groupId || '').trim() === groupId);
    if (directGroup?.tradeCard) {
      return [...directGroup.tradeCard];
    }
  }
  const directNode = (tab.graphData?.nodes ?? []).find((item) => item.id === nodeId);
  if (directNode) {
    return resolveNodePartyCards(directNode, tab);
  }
  return tab.tradeCards.filter((item) => String(item.accountId || '').trim() === nodeId || String(item.tradeCard || '').trim() === nodeId);
}
