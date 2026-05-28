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
  saveCaseGraphLatestStepLayout,
  saveCaseGraphLayoutOperation,
  updateCaseGraphContext,
  updateCaseGraphConfig,
} from './api';
import { CaseRail } from './case-rail';
import { EdgeDetailDrawer, filterEdgeDetailItemsForGraphEdge, type EdgeDetailPartyContext } from './edge-detail-drawer';
import { GraphView } from './graph-view';
import { buildMergedNetworkGraph, isGroupNodeId, parseGroupEdgeId } from './graph-view-adapters';
import { CaseGraphDateInput } from './date-input';
import {
  NodeDetailAnalysisDrawer,
  resolveTradeFactKey,
  type NodeDetailAnalysisRelation,
} from './node-detail-analysis-drawer';
import { ManualClueDrawer } from './manual-clue-drawer';
import { SummaryAnalysisDrawer, type SummaryAnalysisItem } from './summary-analysis-drawer';
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
  AddCaseGraphRealityRelationPayload,
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

const DRILL_NODE_COLUMN_GAP = 374;
const DRILL_NODE_ROW_GAP = 112;
const DRILL_NODE_WIDTH = 248;
const DRILL_NODE_HEIGHT = 84;
const DRILL_NODE_COLLISION_PADDING_X = 32;
const DRILL_NODE_COLLISION_PADDING_Y = 28;

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
  const [manualClueOpen, setManualClueOpen] = useState(false);
  const [manualClueMode, setManualClueMode] = useState<'node' | 'trade' | 'relation'>('trade');
  const [manualClueFocusNode, setManualClueFocusNode] = useState<CaseGraphNode | null>(null);
  const [manualCluePosition, setManualCluePosition] = useState<{ x: number; y: number } | null>(null);
  const [manualClueApplying, setManualClueApplying] = useState(false);
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
  const [originPanelOpen, setOriginPanelOpen] = useState(false);
  const [deleteGraphTarget, setDeleteGraphTarget] = useState<GraphTabState | null>(null);
  const [newGraphForm, setNewGraphForm] = useState({
    graphName: '',
    saveToClue: '1',
    clueName: '',
  });
  const [graphConfigForm, setGraphConfigForm] = useState({
    drillNums: '10',
    drillType: '1',
    minAmount: '',
    maxAmount: '',
  });

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
  const pendingStepLayoutRef = useRef<{ caseId: string; graphId: string } | null>(null);
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
  const appliedFilterLabels = useMemo(
    () => activeTab ? buildFilterLabels(activeTab.appliedFilters) : [],
    [activeTab],
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
      saveToClue: '1',
      clueName: '',
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
    if (newGraphForm.saveToClue === '1' && !newGraphForm.clueName.trim()) {
      setError('请输入线索名称');
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
        const nextTab = state ? graphStateToTab(state, graph) : graphToTab(graph);
        setGraphTabs((current) => [...current.filter((item) => item.graphId !== nextTab.graphId), nextTab]);
        setActiveTabId(nextTab.graphId);
        setCaseIdDraft(graph.caseId);
        void refreshGraphSteps(nextTab);
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
    reason: 'layout' | 'drag',
  ) => {
    if (!shouldPersistGraphPositions(tab.graphData, positions, reason)) {
      return;
    }
    const positionedGraphData = applyNodePositions(tab.graphData, positions);
    const positionedOriginData = tab.originData && positionedGraphData
      ? { ...tab.originData, nodes: positionedGraphData.nodes, money: positionedGraphData.edges }
      : tab.originData;
    if (!positionedGraphData || !positionedOriginData) {
      return;
    }
    updateActiveTab((current) => (
      current.graphId === tab.graphId
        ? { ...current, graphData: positionedGraphData, originData: positionedOriginData }
        : current
    ));
    void saveCaseGraphLayoutOperation(
      tab.caseId,
      tab.graphId,
      { graphName: tab.graphName, nodePositions: positions },
      token,
    ).then((state) => {
      updateActiveTab((current) => (
        current.graphId === tab.graphId
          ? { ...current, ...graphStateToTab(state, current), graphContent: current.graphContent, chatId: current.chatId }
          : current
      ));
    }).catch((err: unknown) => {
      console.warn('保存图谱布局失败', err);
    });
  }, [token, updateActiveTab]);

  const markPendingStepLayout = useCallback((tab: Pick<GraphTabState, 'caseId' | 'graphId'>) => {
    pendingStepLayoutRef.current = { caseId: tab.caseId, graphId: tab.graphId };
  }, []);

  const persistLatestStepLayout = useCallback((
    tab: GraphTabState,
    positions: Record<string, GraphNodePoint>,
  ) => {
    const pending = pendingStepLayoutRef.current;
    if (!pending || pending.caseId !== tab.caseId || pending.graphId !== tab.graphId) {
      return;
    }
    const options = buildRelationOptions(tab.graphData, positions);
    const nodePositions = options.nodePositions as Record<string, GraphNodePoint> | undefined;
    if (!nodePositions || !Object.keys(nodePositions).length) {
      return;
    }
    pendingStepLayoutRef.current = null;
    void saveCaseGraphLatestStepLayout(
      tab.caseId,
      tab.graphId,
      { nodePositions },
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
      },
      token,
    )
      .then((result) => {
        const nextFromState = result.graphState ? graphStateToTab(result.graphState, activeTab) : null;
        const originData = nextFromState?.originData ?? normalizeCaseGraphOriginData(result);
        updateActiveTab((tab) => ({
          ...tab,
          ...(nextFromState ? { ...nextFromState, graphContent: tab.graphContent, chatId: tab.chatId } : {}),
          loaded: true,
          graphContent: tab.graphContent,
          graphData: nextFromState?.graphData ?? originDataToCanvasData(originData),
          originData,
          tradeFacts: nextFromState?.tradeFacts ?? originData?.tradeFacts ?? tab.tradeFacts,
          tradeCards: nextTradeCards,
          queryBaselineTradeCards: nextTradeCards,
          groupMap: nextFromState?.groupMap ?? {},
          sourceSelectId: nextFromState?.sourceSelectId ?? [],
          excludedTrades: nextFromState?.excludedTrades ?? [],
          excludedAccountId: tab.excludedAccountId,
          excludedNodes: nextFromState?.excludedNodes ?? originData?.excludedNodes ?? [],
          appliedFilters: currentFilterState(tab),
        }));
        markPendingStepLayout(activeTab);
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
  }, [activeTab, selectedTradeCards, token, updateActiveTab, requestGraphStepInsight]);

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
      },
      token,
    )
      .then((result) => {
        const nextFromState = result.graphState ? graphStateToTab(result.graphState, activeTab) : null;
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
        updateActiveTab((tab) => ({
          ...tab,
          ...(nextFromState ? { ...nextFromState, graphContent: tab.graphContent, chatId: tab.chatId } : {}),
          loaded: true,
          graphContent: tab.graphContent,
          graphData: mergedGraphData,
          originData: mergedOriginData,
          tradeFacts: nextFromState?.tradeFacts ?? tab.tradeFacts,
          groupMap: nextFromState?.groupMap ?? {},
          excludedNodes: nextFromState?.excludedNodes ?? originData?.excludedNodes ?? tab.excludedNodes,
        }));
        markPendingStepLayout(activeTab);
        setError(null);
        requestGraphStepInsight(result, activeTab);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '钻取上下游失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, drilling: false }));
      });
  }, [activeTab, token, updateActiveTab, requestGraphStepInsight]);

  const handleCompleteGraphRelations = useCallback(() => {
    if (!activeTab) return;
    const accounts = resolveGraphAccounts(activeTab);
    if (accounts.length < 2) {
      setError('当前图上至少需要两个账号节点才能分析节点关系');
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
      },
      token,
    )
      .then((result) => {
        const nextFromState = result.graphState ? graphStateToTab(result.graphState, activeTab) : null;
        const originData = nextFromState?.originData ?? normalizeCaseGraphOriginData(result);
        updateActiveTab((tab) => ({
          ...tab,
          ...(nextFromState ? { ...nextFromState, graphContent: tab.graphContent, chatId: tab.chatId } : {}),
          loaded: true,
          graphContent: tab.graphContent,
          graphData: nextFromState?.graphData ?? mergeGraphData(positionedCurrent, originDataToCanvasData(originData), { mode: 'complete' }),
          originData: nextFromState?.originData ?? mergeOriginData(tab.originData, originData, { mode: 'complete' }),
          tradeFacts: nextFromState?.tradeFacts ?? tab.tradeFacts,
          groupMap: nextFromState?.groupMap ?? {},
          excludedNodes: nextFromState?.excludedNodes ?? originData?.excludedNodes ?? tab.excludedNodes,
        }));
        markPendingStepLayout(activeTab);
        setError(null);
        requestGraphStepInsight(result, activeTab);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '分析图上节点关系失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, drilling: false }));
      });
  }, [activeTab, token, updateActiveTab, requestGraphStepInsight]);

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
        const nextFromState = result.graphState ? graphStateToTab(result.graphState, activeTab) : null;
        const originData = nextFromState?.originData ?? normalizeCaseGraphOriginData(result);
        updateActiveTab((tab) => ({
          ...tab,
          ...(nextFromState ? { ...nextFromState, graphContent: tab.graphContent, chatId: tab.chatId } : {}),
          loaded: true,
          graphData: nextFromState?.graphData ?? originDataToCanvasData(originData),
          originData,
          tradeFacts: nextFromState?.tradeFacts ?? originData?.tradeFacts ?? tab.tradeFacts,
          groupMap: nextFromState?.groupMap ?? {},
          excludedNodes: nextFromState?.excludedNodes ?? originData?.excludedNodes ?? tab.excludedNodes,
          minAmount: filterState.minAmount,
          maxAmount: filterState.maxAmount,
          startTime: filterState.startTime,
          endTime: filterState.endTime,
          appliedFilters: filterState,
        }));
        markPendingStepLayout(activeTab);
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

  const applyRelationResultToActiveTab = useCallback((result: { graph: CaseGraphData; graphState?: CaseGraphStateSnapshot }) => {
    const nextFromState = result.graphState ? graphStateToTab(result.graphState, activeTab ?? undefined) : null;
    const originData = nextFromState?.originData ?? normalizeCaseGraphOriginData(result as any);
    updateActiveTab((tab) => ({
      ...tab,
      ...(nextFromState ? { ...nextFromState, graphContent: tab.graphContent, chatId: tab.chatId } : {}),
      loaded: true,
      graphData: nextFromState?.graphData ?? originDataToCanvasData(originData),
      originData,
      tradeFacts: nextFromState?.tradeFacts ?? originData?.tradeFacts ?? tab.tradeFacts,
      groupMap: nextFromState?.groupMap ?? {},
      excludedNodes: nextFromState?.excludedNodes ?? originData?.excludedNodes ?? [],
    }));
  }, [activeTab, updateActiveTab]);

  const handleExcludeNode = useCallback((node: CaseGraphExcludedNode) => {
    if (!activeTab) return;
    setReplaySelection(null);
    setRequests((current) => ({ ...current, excluding: true }));
    excludeCaseGraphNode(
      {
        caseId: activeTab.caseId,
        graphId: activeTab.graphId,
        node,
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
  }, [activeTab, applyRelationResultToActiveTab, refreshGraphSteps, requestGraphStepInsight, token]);

  const handleExcludeNodes = useCallback((nodes: CaseGraphExcludedNode[]) => {
    if (!activeTab || !nodes.length) return;
    setReplaySelection(null);
    setRequests((current) => ({ ...current, excluding: true }));
    excludeCaseGraphNode(
      {
        caseId: activeTab.caseId,
        graphId: activeTab.graphId,
        nodes,
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
  }, [activeTab, applyRelationResultToActiveTab, refreshGraphSteps, requestGraphStepInsight, token]);

  const handleRestoreNode = useCallback((nodeId: string) => {
    if (!activeTab) return;
    setReplaySelection(null);
    setRequests((current) => ({ ...current, excluding: true }));
    restoreCaseGraphNode(
      {
        caseId: activeTab.caseId,
        graphId: activeTab.graphId,
        nodeId,
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
        setError(err instanceof Error ? err.message : '恢复节点失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, excluding: false }));
      });
  }, [activeTab, applyRelationResultToActiveTab, refreshGraphSteps, requestGraphStepInsight, token]);

  const handleRestoreAllExcludedNodes = useCallback(() => {
    if (!activeTab || !activeTab.excludedNodes.length) return;
    setReplaySelection(null);
    setRequests((current) => ({ ...current, excluding: true }));
    activeTab.excludedNodes.reduce(
      (chain, node) => chain.then(() => restoreCaseGraphNode({
        caseId: activeTab.caseId,
        graphId: activeTab.graphId,
        nodeId: node.nodeId,
      }, token)),
      Promise.resolve(null as unknown as Awaited<ReturnType<typeof restoreCaseGraphNode>>),
    )
      .then((result) => {
        if (result) {
          applyRelationResultToActiveTab(result);
          requestGraphStepInsight(result, activeTab);
        }
        void refreshGraphSteps(activeTab);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '恢复全部节点失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, excluding: false }));
      });
  }, [activeTab, applyRelationResultToActiveTab, refreshGraphSteps, requestGraphStepInsight, token]);

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
  }, [activeTab, applyRelationResultToActiveTab, refreshGraphSteps, requestGraphStepInsight, token]);

  const handleRestoreSelectedExcludedTrades = useCallback(() => {
    handleRestoreExcludedTrades(excludedTradeSelection);
  }, [excludedTradeSelection, handleRestoreExcludedTrades]);

  const handleOpenEdgeDetail = useCallback((edgeId: string, edgeFocus?: CaseGraphConversationFocus) => {
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
    const edge = (activeTab.graphData?.edges ?? []).find((item) => item.id === edgeId);
    if (!edge) return;
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
      setEdgeDetailPartyContext({
        payerName: resolveNodeDisplayName(source, edge.source, activeTab.groupMap),
        payeeName: resolveNodeDisplayName(target, edge.target, activeTab.groupMap),
      });
      setEdgeDetailContext({ edgeId: resolveWorkbenchEdgeId(edge), edge });
      setEdgeDetailSelectedTradeIds([]);
      setEdgeDetailOpen(true);
      setEdgeDetail(factDetail);
      setEdgeDetailLoading(false);
      setError(null);
      return;
    }
    setEdgeDetailPartyContext({
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

  const applyEdgeDetailExclusion = useCallback((tradeIds: string[]) => {
    const selectedTradeIds = [...new Set(tradeIds.map((tradeId) => tradeId.trim()).filter(Boolean))];
    if (!activeTab || !edgeDetailContext || !selectedTradeIds.length) return;
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

  const handleApplyDetailAnalysis = useCallback(() => {
    if (!activeTab || !detailAnalysisSelectedTradeIds.length) return;
    const tradeFacts = buildTradeFactsFromDetails(detailAnalysisByEdgeId);
    const edgeTradeIds = buildEdgeTradeIdsFromDetails(detailAnalysisByEdgeId);
    if (!Object.keys(edgeTradeIds).length) {
      setError('请先加载至少一条交易线的明细');
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
        setSummaryAnalysisSelectedNodeIds(
          items
            .filter((item) => item.status === 'candidate' || (!item.isOnGraph && !item.isExcluded))
            .map((item) => item.nodeId),
        );
        if (!items.length) {
          setError('当前主体暂时没有可补充上图的关联主体');
        } else {
          setError(null);
        }
      })
      .catch((err: unknown) => {
        setSummaryAnalysisNode(null);
        setSummaryAnalysisItems([]);
        setSummaryAnalysisSelectedNodeIds([]);
        setError(err instanceof Error ? err.message : '线索候选读取失败');
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
        setSummaryAnalysisSelectedNodeIds(
          items
            .filter((item) => item.status === 'candidate' || (!item.isOnGraph && !item.isExcluded))
            .map((item) => item.nodeId),
        );
        if (!items.length) {
          setError('案件交易流水中暂时没有可补充上图的主体');
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
        setError(err instanceof Error ? err.message : '线索候选读取失败');
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
      setError(summaryAnalysisScope === 'global' ? '案件交易流水中暂时没有可补充的线索' : '当前主体暂时没有可补充的线索');
      return;
    }
    const candidateNodeIdSet = new Set(candidateNodeIds);
    const selectedCandidates = items
      .filter((item) => summaryAnalysisSelectedNodeIds.includes(item.nodeId))
      .map((item) => ({ nodeId: item.nodeId, label: item.label, accounts: item.accounts ?? [] }));
    setReplaySelection(null);
    setSummaryAnalysisApplying(true);
    applyCaseGraphSummarySelection(
      {
        caseId: activeTab.caseId,
        graphId: activeTab.graphId,
        focusNodeId: summaryAnalysisScope === 'node' ? summaryAnalysisNode?.id ?? null : null,
        scope: summaryAnalysisScope,
        candidateNodeIds,
        selectedNodeIds: summaryAnalysisSelectedNodeIds.filter((nodeId) => candidateNodeIdSet.has(nodeId)),
        selectedCandidates,
        options: buildRelationOptions(activeTab.graphData, graphNodePositionsRef.current),
      },
      token,
    )
      .then((result) => {
        applyRelationResultToActiveTab(result);
        void refreshGraphSteps(activeTab);
        handleCloseSummaryAnalysis();
        setError(null);
        requestGraphStepInsight(result, activeTab);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '线索扩展失败');
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
    summaryAnalysisItems,
    summaryAnalysisSelectedNodeIds,
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
        const nextTab = graphToTab(graph);
        setGraphTabs((current) => current.map((tab) => (tab.graphId === nextTab.graphId ? { ...tab, ...nextTab } : tab)));
        setSavedGraphs((current) =>
          current.map((item) => (item.graphId === nextTab.graphId ? { ...item, chatId: nextTab.chatId } : item)),
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
  }, [activeTab, graphConfigForm, token]);

  const graphActionBusy = requests.querying || requests.drilling || requests.filtering || requests.excluding || requests.creating || requests.deleting;

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
      handleCompleteGraphRelations();
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
      handleExcludeNode(buildExcludedNodePayloadFromGraphNode(resolved.node));
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
            <div className="case-graph-applied-filters" aria-label="当前筛选">
              <strong>当前筛选</strong>
              {appliedFilterLabels.length ? (
                appliedFilterLabels.map((label) => <span key={label}>{label}</span>)
              ) : (
                <em>未应用筛选</em>
              )}
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
              onOpenNodeDetailAnalysis={(node) => {
                if (replayActive) {
                  return;
                }
                handleOpenNodeDetailAnalysis(node);
              }}
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
              excluding={requests.excluding}
              onOpenEdgeDetail={(edgeId, edgeFocus) => {
                if (replayActive) {
                  return;
                }
                handleOpenEdgeDetail(edgeId, edgeFocus);
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
                  if (reason === 'layout') {
                    persistLatestStepLayout(activeTab, positions);
                  }
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

      {originPanelOpen ? (
        <div className="case-graph-modal-mask case-graph-origin-mask" role="presentation" onClick={() => setOriginPanelOpen(false)}>
          <section
            className="case-graph-origin-panel"
            role="dialog"
            aria-modal="true"
            aria-label="选择侦办起点"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="case-graph-origin-header">
              <div>
                <h2>选择侦办起点</h2>
                <span>{activeTab ? `${activeTab.graphName} · ${selectedAccountIds.length} 已选` : '请先新建图形'}</span>
              </div>
              <button className="case-graph-icon-button" type="button" onClick={() => setOriginPanelOpen(false)}>
                <X size={16} />
              </button>
            </div>
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
            <div className="case-graph-origin-footer">
              <button className="case-graph-secondary-button" type="button" onClick={() => setOriginPanelOpen(false)}>
                取消
              </button>
              <button className="case-graph-primary-button" type="button" onClick={handleAnalyze} disabled={!activeTab || replayActive || requests.querying || selectedAccountIds.length === 0}>
                <Sparkles size={14} />
                <span>{requests.querying ? '分析中' : '分析上图'}</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {deleteGraphTarget ? (
        <div className="case-graph-modal-mask" role="presentation" onClick={() => (requests.deleting ? undefined : setDeleteGraphTarget(null))}>
          <div className="case-graph-modal case-graph-delete-modal" role="dialog" aria-modal="true" aria-label="删除图确认" onClick={(event) => event.stopPropagation()}>
            <div className="case-graph-modal-header">
              <div>
                <h2>删除图</h2>
                <span>将删除这张图、绑定的研判对话以及相关工作文件，操作不可恢复。</span>
              </div>
              <button className="case-graph-icon-button" type="button" disabled={requests.deleting} onClick={() => setDeleteGraphTarget(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="case-graph-delete-copy">
              确认删除「{deleteGraphTarget.graphName}」吗？
            </div>
            <div className="case-graph-modal-footer">
              <button className="case-graph-secondary-button" type="button" disabled={requests.deleting} onClick={() => setDeleteGraphTarget(null)}>
                取消
              </button>
              <button className="case-graph-danger-button" type="button" disabled={requests.deleting} onClick={handleConfirmDeleteGraph}>
                {requests.deleting ? '删除中' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {excludedDialogOpen ? (
        <div className="case-graph-modal-mask" role="presentation" onClick={() => setExcludedDialogOpen(false)}>
          <div className="case-graph-modal case-graph-excluded-modal" role="dialog" aria-modal="true" aria-label="排除管理" onClick={(event) => event.stopPropagation()}>
            <div className="case-graph-modal-header">
              <div>
                <strong>排除管理</strong>
                <span>
                  已取消上图 {activeTab?.excludedNodes.length ?? 0} 个主体，已排除 {activeTab?.excludedTrades.length ?? 0} 笔交易流水
                </span>
              </div>
              <button className="case-graph-icon-button" type="button" onClick={() => setExcludedDialogOpen(false)}>
                <X size={16} />
              </button>
            </div>
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
          </div>
        </div>
      ) : null}

      {newGraphDialogOpen ? (
        <div className="case-graph-modal-mask" role="presentation">
          <div className="case-graph-modal">
            <div className="case-graph-modal-header">
              <h2>新建图形</h2>
              <button type="button" onClick={() => setNewGraphDialogOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <label className="case-graph-field">
              <span>案件</span>
              <select
                className="case-graph-select"
                value={caseIdDraft}
                onChange={(event) => handleCaseIdChange(event.target.value)}
                disabled={casesLoading}
              >
                <option value="">{casesLoading ? '案件加载中...' : '请选择案件'}</option>
                {cases.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.caseName || item.caseCode || item.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="case-graph-field">
              <span>图形名称</span>
              <input
                value={newGraphForm.graphName}
                onChange={(event) => setNewGraphForm((current) => ({ ...current, graphName: event.target.value }))}
                placeholder="请输入"
              />
            </label>
            <div className="case-graph-radio-row">
              <span>是否保存为线索</span>
              <label><input type="radio" checked={newGraphForm.saveToClue === '1'} onChange={() => setNewGraphForm((current) => ({ ...current, saveToClue: '1' }))} />是</label>
              <label><input type="radio" checked={newGraphForm.saveToClue === '0'} onChange={() => setNewGraphForm((current) => ({ ...current, saveToClue: '0', clueName: '' }))} />否</label>
            </div>
            {newGraphForm.saveToClue === '1' ? (
              <label className="case-graph-field">
                <span>线索名称</span>
                <input
                  value={newGraphForm.clueName}
                  onChange={(event) => setNewGraphForm((current) => ({ ...current, clueName: event.target.value }))}
                  placeholder="请输入"
                />
              </label>
            ) : null}
            <div className="case-graph-modal-footer">
              <button className="case-graph-secondary-button" type="button" onClick={() => setNewGraphDialogOpen(false)}>取消</button>
              <button className="case-graph-primary-button" type="button" onClick={handleCreateGraph} disabled={requests.creating}>
                <span>{requests.creating ? '创建中' : '确认'}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {graphConfigDialogOpen ? (
        <div className="case-graph-modal-mask" role="presentation" onClick={() => setGraphConfigDialogOpen(false)}>
          <div className="case-graph-modal" onClick={(event) => event.stopPropagation()}>
            <div className="case-graph-modal-header">
              <h2>当前图钻取配置</h2>
              <button type="button" onClick={() => setGraphConfigDialogOpen(false)}>
                <X size={18} />
              </button>
            </div>
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
            <div className="case-graph-modal-footer">
              <button className="case-graph-secondary-button" type="button" onClick={() => setGraphConfigDialogOpen(false)}>取消</button>
              <button className="case-graph-primary-button" type="button" onClick={handleSaveGraphConfig} disabled={requests.querying}>
                <span>{requests.querying ? '保存中' : '确认'}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
    };
  });
}

function countActiveGraphElements(graph: CaseGraphStateBody): { nodeCount: number; edgeCount: number } {
  const excludedNodeIds = new Set(
    graph.nodes
      .filter((node) => node.isExcluded)
      .map((node) => String(node.id || '').trim())
      .filter(Boolean),
  );
  const nodeCount = graph.nodes.filter((node) => !node.isExcluded).length;
  const edgeCount = graph.edges.filter((edge) => {
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
    summary_analysis: '线索扩展',
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
    summary_analysis: '线索扩展',
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
    candidateNodeCount: '候选主体',
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
  };
}

function graphStateToTab(state: CaseGraphStateSnapshot, fallback?: Partial<GraphTabState> | CaseGraphSnapshot): GraphTabState {
  const graphData = graphStateToCanvasData(state);
  const originData = graphStateToOriginData(state);
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
    originData,
    tradeFacts: { ...(state.graph.tradeFacts ?? {}) },
    groupMap: normalizeCaseGraphGroupMap(state.graph.groupMap),
    sourceSelectId: [...(state.graph.sourceSelectId ?? [])],
    excludedTrades: [...(state.graph.excludedTrades ?? [])],
    excludedAccountId: state.graph.excludedAccountId?.[0] ?? null,
    excludedNodes: [...(state.graph.excludedNodes ?? [])],
    showExcludedNodes: fallbackTab?.showExcludedNodes ?? false,
    drillNums: Number(fallbackTab?.drillNums ?? fallbackSnapshot?.drillNums ?? 10),
    drillType: fallbackTab?.drillType ?? fallbackSnapshot?.drillType ?? 1,
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
  };
}

export function graphStateToTabForTest(state: CaseGraphStateSnapshot): GraphTabState {
  return graphStateToTab(state);
}

function emptyFilterState(overrides: Partial<CaseGraphFilterState> = {}): CaseGraphFilterState {
  return {
    minAmount: formatFilterValue(overrides.minAmount),
    maxAmount: formatFilterValue(overrides.maxAmount),
    startTime: overrides.startTime || '',
    endTime: overrides.endTime || '',
  };
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

function buildFilterLabels(filters: CaseGraphFilterState): string[] {
  const labels: string[] = [];
  if (filters.minAmount || filters.maxAmount) {
    labels.push(`金额 ${filters.minAmount || '不限'} ~ ${filters.maxAmount || '不限'}`);
  }
  if (filters.startTime || filters.endTime) {
    labels.push(`时间 ${filters.startTime || '不限'} ~ ${filters.endTime || '不限'}`);
  }
  return labels;
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
  const currentNodeIds = new Set<string>();
  const canonicalNodeIds = buildCanonicalNodeIdIndex(current.nodes);
  const endpointRemap = new Map<string, string>();
  for (const node of current.nodes) {
    const id = String(node.id || '').trim();
    if (!id) continue;
    currentNodeIds.add(id);
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
  if (options.mode === 'drill') {
    assignDrillNodePositions(nodesById, currentNodeIds, [...edgesById.values()], options);
  }
  return {
    nodes: [...nodesById.values()],
    edges: [...edgesById.values()],
    tradeFacts: { ...(current.tradeFacts ?? {}), ...(incoming.tradeFacts ?? {}) },
    realityRelations: [...(current.realityRelations ?? []), ...(incoming.realityRelations ?? [])],
  };
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

export function shouldPersistGraphPositionsForTest(
  graphData: CaseGraphData | null,
  positions: Record<string, GraphNodePoint>,
  reason: 'layout' | 'drag',
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

function assignDrillNodePositions(
  nodesById: Map<string, CaseGraphData['nodes'][number]>,
  currentNodeIds: Set<string>,
  edges: CaseGraphData['edges'],
  options: MergeGraphOptions,
): void {
  const anchorId = String(options.anchorNodeId || '').trim();
  const anchor = anchorId ? nodesById.get(anchorId) : null;
  const anchorX = finiteNumber(anchor?.x);
  const anchorY = finiteNumber(anchor?.y);
  if (!anchor || anchorX == null || anchorY == null) {
    return;
  }

  const newNodes = [...nodesById.values()].filter((node) => {
    const id = String(node.id || '').trim();
    return id && !currentNodeIds.has(id) && (finiteNumber(node.x) == null || finiteNumber(node.y) == null);
  });
  const left: CaseGraphData['nodes'] = [];
  const right: CaseGraphData['nodes'] = [];
  for (const node of newNodes) {
    const side = resolveDrillNodeSide(node.id, anchorId, edges, options.direction);
    if (side === 'left') {
      left.push(node);
    } else {
      right.push(node);
    }
  }
  const occupied = buildOccupiedDrillSlots([...nodesById.values()], currentNodeIds);
  placeDrillColumn(left, anchorX, anchorY, 'left', occupied);
  placeDrillColumn(right, anchorX, anchorY, 'right', occupied);
}

function resolveDrillNodeSide(
  nodeId: string,
  anchorId: string,
  edges: CaseGraphData['edges'],
  direction: DrillDirection | undefined,
): 'left' | 'right' {
  const directEdge = edges.find((edge) => {
    const source = String(edge.source || edge.from || '').trim();
    const target = String(edge.target || edge.to || '').trim();
    return (source === nodeId && target === anchorId) || (source === anchorId && target === nodeId);
  });
  if (directEdge) {
    const source = String(directEdge.source || directEdge.from || '').trim();
    return source === nodeId ? 'left' : 'right';
  }
  return direction === 'in' ? 'left' : 'right';
}

function placeDrillColumn(
  nodes: CaseGraphData['nodes'],
  anchorX: number,
  anchorY: number,
  side: 'left' | 'right',
  occupied: DrillSlot[],
): void {
  const sorted = [...nodes].sort((left, right) => String(left.label || left.name || left.id).localeCompare(String(right.label || right.name || right.id), 'zh-Hans-CN'));
  const middle = (sorted.length - 1) / 2;
  sorted.forEach((node, index) => {
    const preferredY = anchorY + (index - middle) * DRILL_NODE_ROW_GAP;
    const point = findAvailableDrillSlot(anchorX, preferredY, side, occupied);
    node.x = point.x;
    node.y = point.y;
    occupied.push(toDrillSlot(point.x, point.y));
  });
}

type DrillSlot = { left: number; right: number; top: number; bottom: number };

function buildOccupiedDrillSlots(
  nodes: CaseGraphData['nodes'],
  currentNodeIds: Set<string>,
): DrillSlot[] {
  return nodes
    .filter((node) => currentNodeIds.has(String(node.id || '').trim()))
    .map((node) => {
      const x = finiteNumber(node.x);
      const y = finiteNumber(node.y);
      return x == null || y == null ? null : toDrillSlot(x, y);
    })
    .filter((slot): slot is DrillSlot => Boolean(slot));
}

function findAvailableDrillSlot(
  anchorX: number,
  preferredY: number,
  side: 'left' | 'right',
  occupied: DrillSlot[],
): GraphNodePoint {
  const direction = side === 'left' ? -1 : 1;
  const yOffsets = buildDrillYOffsetCandidates();
  for (let column = 1; column <= 8; column += 1) {
    const x = anchorX + direction * DRILL_NODE_COLUMN_GAP * column;
    for (const yOffset of yOffsets) {
      const y = preferredY + yOffset;
      if (!doesDrillSlotCollide(toDrillSlot(x, y), occupied)) {
        return { x, y };
      }
    }
  }
  return {
    x: anchorX + direction * DRILL_NODE_COLUMN_GAP * 9,
    y: preferredY,
  };
}

function buildDrillYOffsetCandidates(): number[] {
  const offsets = [0];
  for (let step = 1; step <= 12; step += 1) {
    offsets.push(step * DRILL_NODE_ROW_GAP, -step * DRILL_NODE_ROW_GAP);
  }
  return offsets;
}

function toDrillSlot(x: number, y: number): DrillSlot {
  const halfWidth = DRILL_NODE_WIDTH / 2 + DRILL_NODE_COLLISION_PADDING_X;
  const halfHeight = DRILL_NODE_HEIGHT / 2 + DRILL_NODE_COLLISION_PADDING_Y;
  return {
    left: x - halfWidth,
    right: x + halfWidth,
    top: y - halfHeight,
    bottom: y + halfHeight,
  };
}

function doesDrillSlotCollide(candidate: DrillSlot, occupied: DrillSlot[]): boolean {
  return occupied.some((slot) => (
    candidate.left < slot.right &&
    candidate.right > slot.left &&
    candidate.top < slot.bottom &&
    candidate.bottom > slot.top
  ));
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

function hasGraphPositionsChanged(
  graphData: CaseGraphData,
  positions: Record<string, GraphNodePoint>,
): boolean {
  return graphData.nodes.some((node) => {
    const point = positions[node.id];
    if (!point) return false;
    return finiteNumber(node.x) !== point.x || finiteNumber(node.y) !== point.y;
  });
}

function shouldPersistGraphPositions(
  graphData: CaseGraphData | null,
  positions: Record<string, GraphNodePoint>,
  reason: 'layout' | 'drag',
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
