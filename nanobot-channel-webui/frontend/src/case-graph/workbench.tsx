import { ArrowLeft, AlertCircle, Bot, Eye, EyeOff, Filter, Maximize2, MessageSquarePlus, Minimize2, Plus, RotateCcw, Sparkles, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { appStore, useAppSelector } from '../app-state';
import { buildTextAppendMessage } from '../app-helpers';
import { ChatWorkspace, type ChatWorkspaceRenderContext } from '../components/chat/chat-workspace';
import type { ToolDetailPayload } from '../components/chat/detail-preview-context';
import { DetailPreviewPane, type DetailView } from '../detail-preview-pane';
import {
  graphStateToCanvasData,
  graphStateToOriginData,
  normalizeCaseGraphGroupMap,
  normalizeCaseGraphOriginData,
  originDataToCanvasData,
  snapshotTradeCards,
} from './adapters';
import {
  completeCaseGraphRelation,
  createCaseGraph,
  deleteCaseGraph,
  excludeCaseGraphNode,
  filterCaseGraphRelation,
  loadCaseGraphState,
  loadCaseGraph,
  loadCaseGraphAccounts,
  loadCaseGraphCases,
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
import { EdgeDetailDrawer, type EdgeDetailPartyContext } from './edge-detail-drawer';
import { GraphView } from './graph-view';
import { isGroupNodeId, parseGroupEdgeId } from './graph-view-adapters';
import type {
  CaseGraphCaseOption,
  CaseGraphConversationFocus,
  CaseGraphData,
  CaseGraphExcludedNode,
  CaseGraphGroupMap,
  CaseGraphNode,
  CaseGraphOriginData,
  CaseGraphSavedGraph,
  CaseGraphSelectableAccount,
  CaseGraphSnapshot,
  CaseGraphStateSnapshot,
  CaseGraphTargetDetailResult,
  CaseGraphTradeCard,
} from './types';
import type { SkillCandidate } from '../skill-quick-select';
import { runConfigWithSelectedSkill } from '../skill-quick-select';
import type { MediaItem } from '../types';
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
  headerSlot,
  title,
  authResolved,
  currentUser,
  showFlash,
}: {
  token: string;
  onBack: () => void;
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
  const [edgeDetail, setEdgeDetail] = useState<CaseGraphTargetDetailResult | null>(null);
  const [edgeDetailLoading, setEdgeDetailLoading] = useState(false);
  const [edgeDetailOpen, setEdgeDetailOpen] = useState(false);
  const [edgeDetailPartyContext, setEdgeDetailPartyContext] = useState<EdgeDetailPartyContext | null>(null);
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
  const [conversationFocus, setConversationFocus] = useState<CaseGraphConversationFocus | null>(null);
  const [chatFullscreen, setChatFullscreen] = useState(false);
  const [detailView, setDetailView] = useState<DetailView | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [detailPanelWidth, setDetailPanelWidth] = useState(() =>
    clampDetailWidth(getPreferredDetailPanelWidth(window.innerWidth), window.innerWidth, false),
  );
  const [resizingDetailPanel, setResizingDetailPanel] = useState(false);
  const fullscreenPreviewOpen = chatFullscreen && Boolean(detailView);
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
  const visibleGraphData = useMemo(
    () => activeTab ? filterExcludedGraphData(activeTab.graphData, activeTab.showExcludedNodes) : null,
    [activeTab],
  );

  const activeCaseLabel = useMemo(() => {
    if (!activeTab) {
      return null;
    }
    const matchedCase = cases.find((item) => item.id === activeTab.caseId);
    return matchedCase?.caseName || matchedCase?.caseCode || activeTab.caseId;
  }, [activeTab, cases]);

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

  const openMedia = useCallback((item: MediaItem) => {
    setChatFullscreen(true);
    setDetailPanelWidth((current) =>
      clampDetailWidth(
        Math.max(current, getPreferredDetailPanelWidth(window.innerWidth)),
        window.innerWidth,
        shouldUseImmersivePreview(window.innerWidth),
      ),
    );
    setDetailView({ type: 'media', item });
  }, []);

  const openTool = useCallback((titleText: string, payload: ToolDetailPayload) => {
    setChatFullscreen(true);
    setDetailPanelWidth((current) =>
      clampDetailWidth(
        Math.max(current, getPreferredDetailPanelWidth(window.innerWidth)),
        window.innerWidth,
        shouldUseImmersivePreview(window.innerWidth),
      ),
    );
    setDetailView({ type: 'tool', title: titleText, payload });
  }, []);

  const previewActions = useMemo(
    () => ({ openMedia, openTool }),
    [openMedia, openTool],
  );

  const quickPrompts = useMemo(() => {
    const prompts = [];
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
  }, [activeTab, conversationFocus]);

  const handleCaseIdChange = useCallback((value: string) => {
    setCaseIdDraft(value);
    setAccountQuery('');
    setAvailableAccounts([]);
    setSavedGraphs([]);
    setGraphTabs([]);
    setActiveTabId(null);
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
        setError(null);
        appStore.dispatch({ type: 'caseGraph.graph.loaded', graph });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '加载图形失败');
      });
  }, [graphTabs, token]);

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
    }).catch((err: unknown) => {
      console.warn('保存步骤布局失败', err);
    });
  }, [token, updateActiveTab]);

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
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '分析上图失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, querying: false }));
      });
  }, [activeTab, selectedTradeCards, token, updateActiveTab]);

  const handleDrill = useCallback((direction: DrillDirection, node: CaseGraphNode, tradeCard: CaseGraphTradeCard | null) => {
    if (!activeTab) return;
    const seed = buildRelationSeedFromNode(node, tradeCard);
    if (!seed.accountIds.length && !seed.accounts?.length) {
      setError('当前节点缺少账号信息，无法钻取上下游');
      return;
    }
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
          groupMap: nextFromState?.groupMap ?? {},
          excludedNodes: nextFromState?.excludedNodes ?? originData?.excludedNodes ?? tab.excludedNodes,
        }));
        markPendingStepLayout(activeTab);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '钻取上下游失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, drilling: false }));
      });
  }, [activeTab, token, updateActiveTab]);

  const handleCompleteGraphRelations = useCallback(() => {
    if (!activeTab) return;
    const accounts = resolveGraphAccounts(activeTab);
    if (accounts.length < 2) {
      setError('当前图上至少需要两个账号节点才能分析节点关系');
      return;
    }
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
          groupMap: nextFromState?.groupMap ?? {},
          excludedNodes: nextFromState?.excludedNodes ?? originData?.excludedNodes ?? tab.excludedNodes,
        }));
        markPendingStepLayout(activeTab);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '分析图上节点关系失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, drilling: false }));
      });
  }, [activeTab, token, updateActiveTab]);

  const handleFilterFieldChange = useCallback((field: keyof CaseGraphFilterState, value: string) => {
    if (!activeTabId) return;
    updateActiveTab((tab) => ({
      ...tab,
      [field]: value,
    }));
  }, [activeTabId, updateActiveTab]);

  const handleApplyFilters = useCallback(() => {
    if (!activeTab) {
      setError('请先新增图形或打开已有图');
      return;
    }
    if (!activeTab.graphData?.nodes.length) {
      setError('当前图还没有可筛选的数据，请先分析上图');
      return;
    }
    const filterState = currentFilterState(activeTab);
    const validationError = validateFilterState(filterState);
    if (validationError) {
      setError(validationError);
      return;
    }
    setRequests((current) => ({ ...current, filtering: true }));
    filterCaseGraphRelation(
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
          groupMap: nextFromState?.groupMap ?? {},
          excludedNodes: nextFromState?.excludedNodes ?? originData?.excludedNodes ?? tab.excludedNodes,
          appliedFilters: filterState,
        }));
        markPendingStepLayout(activeTab);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '筛选关系图失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, filtering: false }));
      });
  }, [activeTab, token, updateActiveTab]);

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
      groupMap: nextFromState?.groupMap ?? {},
      excludedNodes: nextFromState?.excludedNodes ?? originData?.excludedNodes ?? [],
    }));
  }, [activeTab, updateActiveTab]);

  const handleExcludeNode = useCallback((node: CaseGraphExcludedNode) => {
    if (!activeTab) return;
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
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '排除节点失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, excluding: false }));
      });
  }, [activeTab, applyRelationResultToActiveTab, token]);

  const handleExcludeNodes = useCallback((nodes: CaseGraphExcludedNode[]) => {
    if (!activeTab || !nodes.length) return;
    setRequests((current) => ({ ...current, excluding: true }));
    nodes.reduce(
      (chain, node) => chain.then(() => excludeCaseGraphNode({
        caseId: activeTab.caseId,
        graphId: activeTab.graphId,
        node,
      }, token)),
      Promise.resolve(null as unknown as Awaited<ReturnType<typeof excludeCaseGraphNode>>),
    )
      .then((result) => {
        if (result) {
          applyRelationResultToActiveTab(result);
        }
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '批量取消上图失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, excluding: false }));
      });
  }, [activeTab, applyRelationResultToActiveTab, token]);

  const handleRestoreNode = useCallback((nodeId: string) => {
    if (!activeTab) return;
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
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '恢复节点失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, excluding: false }));
      });
  }, [activeTab, applyRelationResultToActiveTab, token]);

  const handleRestoreAllExcludedNodes = useCallback(() => {
    if (!activeTab || !activeTab.excludedNodes.length) return;
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
        }
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '恢复全部节点失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, excluding: false }));
      });
  }, [activeTab, applyRelationResultToActiveTab, token]);

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
      if (!payerCards.length || !payeeCards.length) {
        setError('当前交易线缺少明细定位字段');
        return;
      }
      setEdgeDetailPartyContext({
        payerName: resolveNodeDisplayName(graphNodesById.get(groupedEdge.sourceId), groupedEdge.sourceId, activeTab.groupMap),
        payeeName: resolveNodeDisplayName(graphNodesById.get(groupedEdge.targetId), groupedEdge.targetId, activeTab.groupMap),
      });
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
          setEdgeDetail(detail);
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
    if (!payerCards.length || !payeeCards.length) {
      setError('当前交易线缺少明细定位字段');
      return;
    }
    setEdgeDetailPartyContext({
      payerName: resolveNodeDisplayName(source, edge.source, activeTab.groupMap),
      payeeName: resolveNodeDisplayName(target, edge.target, activeTab.groupMap),
    });
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
        setEdgeDetail(detail);
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
  }, []);

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
    setRequests((current) => ({ ...current, deleting: true }));
    deleteCaseGraph(graphId, token)
      .then(() => {
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

  const renderChatHeader = useCallback(({
    currentChatId,
    availableSkills,
    fullscreen,
  }: ChatWorkspaceRenderContext & { fullscreen: boolean }) => {
    const caseGraphSkill = findCaseGraphSkill(availableSkills);
    const caseGraphSkillLabel = formatCaseGraphSkillLabel(caseGraphSkill);
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

  const renderChatContext = useCallback(({ availableSkills, sendAppendMessage }: ChatWorkspaceRenderContext) => (
    <div className="case-graph-chat-context">
      <div className="case-graph-chat-context-title">当前上下文</div>
      <div className="case-graph-chat-context-tags">
        {activeCaseLabel ? <span>{activeCaseLabel}</span> : null}
        {activeTab ? <span>{activeTab.graphName}</span> : null}
        {conversationFocus?.type === 'node' ? (
          <span>主体: {conversationFocus.accountName || conversationFocus.label || conversationFocus.nodeId}</span>
        ) : null}
        {conversationFocus?.type === 'edge' ? (
          <span>交易线: {conversationFocus.fromName || conversationFocus.from} → {conversationFocus.toName || conversationFocus.to}</span>
        ) : null}
        {!activeTab ? <span>未选中图</span> : null}
      </div>
      {quickPrompts.length ? (
        <div className="case-graph-chat-quick-actions">
          {quickPrompts.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                className="case-graph-chat-quick-action"
                onClick={() => {
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
                <Icon size={14} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  ), [activeCaseLabel, activeTab, conversationFocus, quickPrompts, showFlash]);

  const renderFullscreenTopControls = useCallback(() => (
    <button
      type="button"
      className="workspace-open-button case-graph-chat-fullscreen-exit"
      onClick={() => setChatFullscreen(false)}
    >
      <Minimize2 size={14} />
      退出全屏
    </button>
  ), []);

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
                    disabled={!activeTab || requests.filtering}
                  />
                  <i />
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="最大"
                    value={filterState.maxAmount}
                    onChange={(event) => handleFilterFieldChange('maxAmount', event.target.value)}
                    disabled={!activeTab || requests.filtering}
                  />
                </label>
                <label className="case-graph-filter-field case-graph-filter-field--wide">
                  <span>时间</span>
                  <input
                    type="datetime-local"
                    value={filterState.startTime}
                    onChange={(event) => handleFilterFieldChange('startTime', event.target.value)}
                    disabled={!activeTab || requests.filtering}
                  />
                  <i />
                  <input
                    type="datetime-local"
                    value={filterState.endTime}
                    onChange={(event) => handleFilterFieldChange('endTime', event.target.value)}
                    disabled={!activeTab || requests.filtering}
                  />
                </label>
              </div>
              <div className="case-graph-filter-actions">
                {filterDirty ? <span className="case-graph-filter-dirty">条件已修改</span> : null}
                <button
                  type="button"
                  className="case-graph-secondary-button case-graph-filter-button"
                  onClick={() => setExcludedDialogOpen(true)}
                  disabled={!activeTab}
                >
                  <EyeOff size={14} />
                  <span>已排除 {activeTab?.excludedNodes.length ?? 0}</span>
                </button>
                <button
                  type="button"
                  className="case-graph-secondary-button case-graph-filter-button"
                  onClick={handleToggleShowExcludedNodes}
                  disabled={!activeTab || !activeTab.excludedNodes.length}
                >
                  {activeTab?.showExcludedNodes ? <Eye size={14} /> : <EyeOff size={14} />}
                  <span>{activeTab?.showExcludedNodes ? '隐藏排除' : '显示排除'}</span>
                </button>
                <button
                  type="button"
                  className="case-graph-secondary-button case-graph-filter-button"
                  onClick={handleResetFilters}
                  disabled={!activeTab || requests.filtering}
                >
                  <RotateCcw size={14} />
                  <span>重置</span>
                </button>
                <button
                  type="button"
                  className="case-graph-primary-button case-graph-filter-button"
                  onClick={handleApplyFilters}
                  disabled={!activeTab || requests.filtering || requests.querying}
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
              graphContent={activeTab?.graphContent ?? null}
              groupMap={activeTab?.groupMap ?? {}}
              tradeCards={activeTab?.tradeCards ?? []}
              focusAccountIds={activeTab?.selectedAccountIds ?? []}
              focusLabels={focusLabels}
              loading={requests.querying}
              drilldownLoading={requests.drilling}
              hasActiveTab={Boolean(activeTab)}
              onChooseInvestigationOrigin={() => setOriginPanelOpen(true)}
              onCompleteGraphRelations={handleCompleteGraphRelations}
              onOpenGraphConfig={openGraphConfigDialog}
              onDrillDown={handleDrill}
              onExcludeNode={handleExcludeNode}
              onExcludeNodes={handleExcludeNodes}
              excluding={requests.excluding}
              onOpenEdgeDetail={handleOpenEdgeDetail}
              onFocusChange={(focus) => {
                if (!activeTab) {
                  return;
                }
                if (!focus || focus.type !== 'node') {
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
          {!chatFullscreen ? (
            <ChatWorkspace
              authResolved={authResolved}
              authToken={token}
              currentUser={currentUser}
              title={title}
              showFlash={showFlash}
              previewActions={previewActions}
              className="case-graph-chat-workspace"
              threadWrapperClassName="case-graph-chat-thread"
              compact={true}
              showSidebar={false}
              sidebarCollapsed={true}
              showWorkspaceButton={false}
              showWorkspacePanel={false}
              onOpenMedia={openMedia}
              onSessionReady={handleCaseGraphSessionReady}
              headerSlot={(context) => renderChatHeader({ ...context, fullscreen: false })}
              contextSlot={renderChatContext}
            />
          ) : null}
        </aside>

      </div>

      <EdgeDetailDrawer
        detail={edgeDetail}
        loading={edgeDetailLoading}
        open={edgeDetailOpen}
        onClose={handleCloseEdgeDetail}
        partyContext={edgeDetailPartyContext}
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
              <button className="case-graph-primary-button" type="button" onClick={handleAnalyze} disabled={!activeTab || requests.querying || selectedAccountIds.length === 0}>
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
                <span>将删除这张图以及相关工作文件，操作不可恢复。</span>
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
          <div className="case-graph-modal case-graph-excluded-modal" role="dialog" aria-modal="true" aria-label="已排除节点" onClick={(event) => event.stopPropagation()}>
            <div className="case-graph-modal-header">
              <div>
                <strong>已排除节点</strong>
                <span>{activeTab?.excludedNodes.length ?? 0} 个节点暂不参与后续分析</span>
              </div>
              <button className="case-graph-icon-button" type="button" onClick={() => setExcludedDialogOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="case-graph-excluded-tools">
              <label className="case-graph-toggle-row">
                <input
                  type="checkbox"
                  checked={Boolean(activeTab?.showExcludedNodes)}
                  onChange={handleToggleShowExcludedNodes}
                  disabled={!activeTab?.excludedNodes.length}
                />
                <span>在图上显示已排除节点</span>
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
                <div className="case-graph-empty">当前没有手动排除的节点。</div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {chatFullscreen ? (
        <div className="case-graph-chat-fullscreen-mask" role="presentation">
          <div className="case-graph-chat-fullscreen-shell">
            <div
              className={`shell case-graph-chat-fullscreen-main${fullscreenPreviewOpen ? ' detail-open' : ''}${immersivePreview ? ' detail-immersive' : ''}`}
              style={
                immersiveChatContentWidth !== null
                  ? ({
                      '--immersive-chat-workspace-width': `${immersiveChatContentWidth}px`,
                      '--immersive-chat-content-width': `${immersiveChatContentWidth}px`,
                    } as CSSProperties)
                  : undefined
              }
            >
              {resizingDetailPanel ? <div className="detail-resize-overlay" aria-hidden="true" /> : null}
              <ChatWorkspace
                authResolved={authResolved}
                authToken={token}
                currentUser={currentUser}
                title={title}
                showFlash={showFlash}
                previewActions={previewActions}
                className="chat-workspace case-graph-chat-fullscreen-workspace"
                compact={immersivePreview}
                showSidebar={false}
                sidebarCollapsed={true}
                showSidebarToggle={false}
                showWorkspaceButton={true}
                showWorkspacePanel={true}
                previewOpen={fullscreenPreviewOpen}
                immersivePreview={immersivePreview}
                onOpenMedia={openMedia}
                onSessionReady={handleCaseGraphSessionReady}
                topControlsSlot={renderFullscreenTopControls}
              />
              <DetailPreviewPane
                detailView={detailView}
                immersive={immersivePreview}
                open={Boolean(detailView)}
                width={detailPanelWidth}
                token={token}
                onClose={() => setDetailView(null)}
                onResizeStart={() => setResizingDetailPanel(true)}
              />
            </div>
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
    return normalized === 'case graph analyst'
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
    normalized === 'case graph analyst'
    || normalized === 'case-graph-analyst'
    || normalized.includes('graph analyst')
  ) {
    return '图谱研判助手';
  }
  return skill.name;
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
