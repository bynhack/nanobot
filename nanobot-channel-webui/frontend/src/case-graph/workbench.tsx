import { AssistantRuntimeProvider, Suggestions, useAui } from '@assistant-ui/react';
import { ArrowLeft, AlertCircle, Bot, Maximize2, MessageSquarePlus, Minimize2, Plus, Settings2, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { buildTextAppendMessage } from '../app-helpers';
import { appStore, useAppSelector } from '../app-state';
import { loadSessionWorkspace } from '../api';
import { DetailPreviewContext, type ToolDetailPayload } from '../components/chat/detail-preview-context';
import { ChatThreadContent } from '../components/chat/thread-content';
import { WorkspacePanel } from '../components/chat/workspace-panel';
import { DetailPreviewPane, type DetailView } from '../detail-preview-pane';
import { DEFAULT_THREAD_SUGGESTIONS } from '../assistant-ui-runtime';
import {
  mergeTradeCards,
  normalizeCaseGraphGroupMap,
  normalizeCaseGraphOriginData,
  originDataToCanvasData,
  snapshotTradeCards,
} from './adapters';
import {
  createCaseGraph,
  drillCaseGraph,
  drillDownCaseGraph,
  drillUpCaseGraph,
  loadCaseGraph,
  loadCaseGraphAccounts,
  loadCaseGraphCases,
  loadCaseGraphTargetDetail,
  loadSavedCaseGraphs,
  queryCaseGraph,
  updateCaseGraphContext,
  updateCaseGraphConfig,
} from './api';
import { CaseRail } from './case-rail';
import { EdgeDetailDrawer } from './edge-detail-drawer';
import { GraphView } from './graph-view';
import { isGroupNodeId, parseGroupEdgeId } from './graph-view-adapters';
import type {
  CaseGraphCaseOption,
  CaseGraphConversationFocus,
  CaseGraphData,
  CaseGraphGroupMap,
  CaseGraphOriginData,
  CaseGraphSavedGraph,
  CaseGraphSelectableAccount,
  CaseGraphSnapshot,
  CaseGraphTargetDetailResult,
  CaseGraphTradeCard,
} from './types';
import type { SkillCandidate } from '../skill-quick-select';
import { runConfigWithSelectedSkill } from '../skill-quick-select';
import type { MediaItem, SessionWorkspaceFile } from '../types';
import { useAuthSession } from '../use-auth-session';
import { useAvailableSkills } from '../use-available-skills';
import { useWebsocketSession } from '../use-websocket-session';
import { useWebuiRuntime } from '../use-webui-runtime';
import { DETAIL_PANEL_MAX_WIDTH, DETAIL_PANEL_MIN_WIDTH, getPreferredDetailPanelWidth } from '../preview-layout';

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
  drillNums: number;
  drillType: string | number | null;
  minAmount: number | string | null;
  maxAmount: number | string | null;
  loaded: boolean;
}

interface FocusLabelSource {
  accountId?: string | null;
  accountName?: string;
  suspectName?: string;
  tradeCard?: string;
}

function clampDetailWidth(width: number, viewportWidth: number): number {
  return Math.min(
    DETAIL_PANEL_MAX_WIDTH,
    Math.max(DETAIL_PANEL_MIN_WIDTH, Math.min(width, Math.max(DETAIL_PANEL_MIN_WIDTH, viewportWidth - 360))),
  );
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
  const [requests, setRequests] = useState({
    creating: false,
    querying: false,
    drilling: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [newGraphDialogOpen, setNewGraphDialogOpen] = useState(false);
  const [graphConfigDialogOpen, setGraphConfigDialogOpen] = useState(false);
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
  const connectionState = useAppSelector((state) => state.connectionState);
  const currentChatId = useAppSelector((state) => state.currentChatId);
  const workspacePanel = useAppSelector((state) => state.workspacePanel);
  const workspaceByChat = useAppSelector((state) => state.workspaceByChat);
  const websocketSession = useWebsocketSession({
    authResolved,
    showFlash,
  });
  const availableSkills = useAvailableSkills({
    authResolved,
    authToken: token,
    currentUser,
  });
  const {
    runtime,
    isReadOnlySession,
    pendingAskUserPrompt,
    activeTurn,
    sendAppendMessage,
  } = useWebuiRuntime({
    showFlash,
    actions: websocketSession,
  });
  const threadSuggestions = useMemo(() => [...DEFAULT_THREAD_SUGGESTIONS], []);
  const aui = useAui({
    suggestions: Suggestions(threadSuggestions),
  });
  const [conversationFocus, setConversationFocus] = useState<CaseGraphConversationFocus | null>(null);
  const [chatFullscreen, setChatFullscreen] = useState(false);
  const [detailView, setDetailView] = useState<DetailView | null>(null);
  const [detailPanelWidth, setDetailPanelWidth] = useState(() =>
    clampDetailWidth(getPreferredDetailPanelWidth(window.innerWidth), window.innerWidth),
  );
  const [resizingDetailPanel, setResizingDetailPanel] = useState(false);
  const workspaceRequestCounterRef = useRef(0);

  const graphNodesById = useMemo(
    () => new Map((activeTab?.graphData?.nodes ?? []).map((node) => [node.id, node])),
    [activeTab?.graphData],
  );
  const currentWorkspace = currentChatId ? workspaceByChat[currentChatId] ?? null : null;
  const panelWorkspace = workspacePanel.chatId ? workspaceByChat[workspacePanel.chatId] ?? null : null;
  const workspaceFileCount = currentWorkspace?.files.length ?? 0;
  const workspaceLoadingForCurrentChat = Boolean(
    currentChatId && workspacePanel.loading && workspacePanel.chatId === currentChatId,
  );

  useEffect(() => {
    const onResize = () => {
      setDetailPanelWidth((current) => clampDetailWidth(current, window.innerWidth));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!resizingDetailPanel) {
      return;
    }
    const onMouseMove = (event: MouseEvent) => {
      const nextWidth = window.innerWidth - event.clientX;
      setDetailPanelWidth(clampDetailWidth(nextWidth, window.innerWidth));
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
          drillNums: 10,
          drillType: 1,
          minAmount: null,
          maxAmount: null,
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

  const caseGraphSkill = useMemo(
    () => findCaseGraphSkill(availableSkills),
    [availableSkills],
  );
  const caseGraphSkillLabel = useMemo(
    () => formatCaseGraphSkillLabel(caseGraphSkill),
    [caseGraphSkill],
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
    void updateCaseGraphContext(activeTab.graphId, payload, token).catch(() => {});
  }, [activeTab, token]);

  useEffect(() => {
    if (!activeTab) {
      setConversationFocus(null);
      return;
    }
    syncGraphContext(null);
  }, [activeTab?.graphId, activeTab?.graphName, activeTab?.caseId, syncGraphContext]);

  const sendGraphPrompt = useCallback((text: string) => {
    const message = buildTextAppendMessage(text);
    if (caseGraphSkill?.name) {
      message.runConfig = runConfigWithSelectedSkill(message.runConfig, caseGraphSkill.name);
    }
    void sendAppendMessage(message).catch((error: unknown) => {
      showFlash(error instanceof Error ? error.message : '发送图谱研判消息失败');
    });
  }, [caseGraphSkill?.name, sendAppendMessage, showFlash]);

  const handleOpenWorkspace = useCallback(() => {
    if (!currentChatId) {
      return;
    }
    workspaceRequestCounterRef.current += 1;
    const requestId = workspaceRequestCounterRef.current;
    appStore.dispatch({ type: 'workspace.open', chatId: currentChatId });
    appStore.dispatch({ type: 'workspace.loading', chatId: currentChatId, requestId });
    loadSessionWorkspace(currentChatId, token)
      .then((workspace) => {
        appStore.dispatch({ type: 'workspace.loaded', chatId: currentChatId, requestId, workspace });
      })
      .catch((error: unknown) => {
        appStore.dispatch({
          type: 'workspace.failed',
          chatId: currentChatId,
          requestId,
          error: error instanceof Error ? error.message : '加载工作空间失败',
        });
      });
  }, [currentChatId, token]);

  const openMedia = useCallback((item: MediaItem) => {
    setChatFullscreen(true);
    setDetailPanelWidth((current) => clampDetailWidth(Math.max(current, getPreferredDetailPanelWidth(window.innerWidth)), window.innerWidth));
    setDetailView({ type: 'media', item });
  }, []);

  const openTool = useCallback((titleText: string, payload: ToolDetailPayload) => {
    setChatFullscreen(true);
    setDetailPanelWidth((current) => clampDetailWidth(Math.max(current, getPreferredDetailPanelWidth(window.innerWidth)), window.innerWidth));
    setDetailView({ type: 'tool', title: titleText, payload });
  }, []);

  const previewActions = useMemo(
    () => ({ openMedia, openTool }),
    [openMedia, openTool],
  );

  const handleOpenWorkspaceFile = useCallback((file: SessionWorkspaceFile) => {
    openMedia({ url: file.url, name: file.name, mime: file.mime });
  }, [openMedia]);

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

  const openNewGraphDialog = useCallback(() => {
    if (!caseIdDraft) {
      setError('请先选择案件');
      return;
    }
    setNewGraphForm({
      graphName: `图${graphTabs.length + 1}`,
      saveToClue: '1',
      clueName: '',
    });
    setNewGraphDialogOpen(true);
  }, [caseIdDraft, graphTabs.length]);

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
      .then((graph) => {
        const nextTab = graphToTab(graph);
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
    const nextGroupMap =
      selectedTradeCards.length > 0
        ? buildSelectionGroupMap(selectedTradeCards)
        : activeTab.groupMap;
    queryCaseGraph(
      {
        graphId: activeTab.graphId,
        caseId: activeTab.caseId,
        tradeCards: nextTradeCards,
        groupMap: nextGroupMap,
        limit: activeTab.drillNums,
        excludedTrades: activeTab.excludedTrades,
        excludedAccountId: activeTab.excludedAccountId,
        sourceSelectId: activeTab.sourceSelectId,
        isSelectedTradeCardChanged: true,
        minAmount: activeTab.minAmount,
        maxAmount: activeTab.maxAmount,
      },
      token,
    )
      .then((result) => {
        const originData = normalizeCaseGraphOriginData(result);
        updateActiveTab((tab) => ({
          ...tab,
          loaded: true,
          graphContent: tab.graphContent,
          graphData: originDataToCanvasData(originData),
          originData,
          tradeCards: result.tradeCards ? [...result.tradeCards] : nextTradeCards,
          queryBaselineTradeCards: result.tradeCards ? [...result.tradeCards] : nextTradeCards,
          groupMap: result.groups ? normalizeCaseGraphGroupMap(result.groups) : nextGroupMap,
          sourceSelectId: result.sourceSelectId ? [...result.sourceSelectId] : tab.sourceSelectId,
          excludedTrades: result.excludedTrades ? [...result.excludedTrades] : [],
          excludedAccountId: result.excludedAccountId ?? tab.excludedAccountId,
        }));
        appStore.dispatch({ type: 'caseGraph.graph.query.loaded', result });
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '分析上图失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, querying: false }));
      });
  }, [activeTab, selectedTradeCards, token, updateActiveTab]);

  const handleDrill = useCallback((direction: 'in' | 'out' | 'both', tradeCard: CaseGraphTradeCard) => {
    if (!activeTab) return;
    const subjectCard = [tradeCard];
    if (!subjectCard.length) {
      setError('当前主体缺少可钻取标识');
      return;
    }
    setRequests((current) => ({ ...current, drilling: true }));
    const drillApi = direction === 'in' ? drillUpCaseGraph : direction === 'out' ? drillDownCaseGraph : drillCaseGraph;
    drillApi(
      {
        caseId: activeTab.caseId,
        graphId: activeTab.graphId,
        tradeCards: activeTab.tradeCards,
        tradeCard: subjectCard,
        limit: activeTab.drillNums,
        drillType: activeTab.drillType,
        excludedCards: direction === 'in' ? [] : activeTab.tradeCards,
        excludedTrades: activeTab.excludedTrades,
        drill_type: direction,
        minAmount: activeTab.minAmount,
        maxAmount: activeTab.maxAmount,
      },
      token,
    )
      .then((payload) => {
        const nextTradeCards = mergeTradeCards(
          activeTab.queryBaselineTradeCards,
          Array.isArray(payload?.tradeCards) ? payload.tradeCards : [],
        );
        updateActiveTab((tab) => ({
          ...tab,
          tradeCards: nextTradeCards,
          queryBaselineTradeCards: nextTradeCards,
        }));
        return queryCaseGraph(
          {
            graphId: activeTab.graphId,
            caseId: activeTab.caseId,
            tradeCards: nextTradeCards,
            groupMap: activeTab.groupMap,
            limit: activeTab.drillNums,
            excludedTrades: activeTab.excludedTrades,
            excludedAccountId: activeTab.excludedAccountId,
            sourceSelectId: activeTab.sourceSelectId,
            isSelectedTradeCardChanged: false,
            minAmount: activeTab.minAmount,
            maxAmount: activeTab.maxAmount,
          },
          token,
        );
      })
      .then((result) => {
        const originData = normalizeCaseGraphOriginData(result);
        updateActiveTab((tab) => ({
          ...tab,
          loaded: true,
          graphContent: tab.graphContent,
          graphData: originDataToCanvasData(originData),
          originData,
          tradeCards: result.tradeCards ? [...result.tradeCards] : tab.tradeCards,
          queryBaselineTradeCards: result.tradeCards ? [...result.tradeCards] : tab.queryBaselineTradeCards,
          groupMap: result.groups ? normalizeCaseGraphGroupMap(result.groups) : tab.groupMap,
          sourceSelectId: result.sourceSelectId ? [...result.sourceSelectId] : tab.sourceSelectId,
          excludedTrades: result.excludedTrades ? [...result.excludedTrades] : tab.excludedTrades,
          excludedAccountId: result.excludedAccountId ?? tab.excludedAccountId,
        }));
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '节点钻取失败');
      })
      .finally(() => {
        setRequests((current) => ({ ...current, drilling: false }));
      });
  }, [activeTab, token, updateActiveTab]);

  const handleOpenEdgeDetail = useCallback((edgeId: string) => {
    if (!activeTab) return;
    const groupedEdge = parseGroupEdgeId(edgeId);
    if (groupedEdge) {
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
      const payerCards = resolveNodePartyCardsById(groupedEdge.sourceId, activeTab);
      const payeeCards = resolveNodePartyCardsById(groupedEdge.targetId, activeTab);
      if (!payerCards.length || !payeeCards.length) {
        setError('当前交易线缺少明细定位字段');
        return;
      }
      setEdgeDetailOpen(true);
      setEdgeDetail(null);
      setEdgeDetailLoading(true);
      loadCaseGraphTargetDetail(
        {
          graphId: activeTab.graphId,
          caseId: activeTab.caseId,
          payerCards,
          payeeCards,
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
    const source = graphNodesById.get(edge.source);
    const target = graphNodesById.get(edge.target);
    const payerCards = resolveNodePartyCards(source, activeTab);
    const payeeCards = resolveNodePartyCards(target, activeTab);
    if (!payerCards.length || !payeeCards.length) {
      setError('当前交易线缺少明细定位字段');
      return;
    }
    setEdgeDetailOpen(true);
    setEdgeDetail(null);
    setEdgeDetailLoading(true);
    loadCaseGraphTargetDetail(
      {
        graphId: activeTab.graphId,
        caseId: activeTab.caseId,
        payerCards,
        payeeCards,
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
  }, []);

  const closeTab = useCallback((graphId: string) => {
    setGraphTabs((current) => current.filter((item) => item.graphId !== graphId));
    setActiveTabId((current) => {
      if (current !== graphId) return current;
      const rest = graphTabs.filter((item) => item.graphId !== graphId);
      return rest.at(-1)?.graphId ?? null;
    });
  }, [graphTabs]);

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

  const chatContextBlock = (
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
                onClick={() => sendGraphPrompt(item.prompt)}
              >
                <Icon size={14} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );

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
                        closeTab(tab.graphId);
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
          <button className="case-graph-secondary-button case-graph-cta" type="button" onClick={openGraphConfigDialog} disabled={!activeTab || requests.querying || requests.drilling}>
            <Settings2 size={16} />
            <span>钻取配置</span>
          </button>
          <button className="case-graph-secondary-button case-graph-cta" type="button" onClick={handleAnalyze} disabled={requests.querying || !activeTab}>
            <span>{requests.querying ? '分析中' : '分析上图'}</span>
          </button>
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
        <CaseRail
          cases={cases}
          casesLoading={casesLoading}
          caseIdDraft={caseIdDraft}
          accountQuery={accountQuery}
          availableAccounts={availableAccounts}
          accountsLoading={accountsLoading}
          selectedAccountIds={selectedAccountIds}
          onCaseIdChange={(value) => {
            setCaseIdDraft(value);
            setAccountQuery('');
            setGraphTabs([]);
            setActiveTabId(null);
          }}
          onAccountQueryChange={setAccountQuery}
          onToggleAccount={handleToggleAccount}
          onToggleAccountGroup={handleToggleAccountGroup}
        />

        <section className="case-graph-main">
          <div className="case-graph-main-frame">
            <GraphView
              graphData={activeTab?.graphData ?? null}
              graphContent={activeTab?.graphContent ?? null}
              groupMap={activeTab?.groupMap ?? {}}
              tradeCards={activeTab?.tradeCards ?? []}
              focusAccountIds={activeTab?.selectedAccountIds ?? []}
              focusLabels={focusLabels}
              loading={requests.querying}
              drilldownLoading={requests.drilling}
              hasActiveTab={Boolean(activeTab)}
              onDrillDown={handleDrill}
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
            />
          </div>
        </section>

        <aside className="case-graph-detail case-graph-chat-panel">
          <div className="case-graph-chat-header">
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
                onClick={() => setChatFullscreen(true)}
              >
                <Maximize2 size={14} />
                <span>全屏</span>
              </button>
            </div>
          </div>

          {chatContextBlock}

          <DetailPreviewContext.Provider value={previewActions}>
            <AssistantRuntimeProvider runtime={runtime} aui={aui}>
              <div className="case-graph-chat-thread">
                <ChatThreadContent
                  title={title}
                  flashMessage={null}
                  activeTurn={activeTurn}
                  pendingAskUserPrompt={pendingAskUserPrompt}
                  connectionState={connectionState}
                  currentChatId={currentChatId}
                  isReadOnlySession={isReadOnlySession}
                  onAnswer={(answer) => {
                    void sendAppendMessage(buildTextAppendMessage(answer));
                  }}
                  availableSkills={availableSkills}
                  compact={true}
                  sidebarCollapsed={true}
                  showSidebarToggle={false}
                  onToggleSidebar={() => {}}
                  canOpenWorkspace={false}
                  workspaceFileCount={0}
                  workspaceLoading={false}
                  onOpenWorkspace={() => {}}
                  showWorkspaceButton={false}
                />
              </div>
            </AssistantRuntimeProvider>
          </DetailPreviewContext.Provider>
        </aside>

      </div>

      <EdgeDetailDrawer
        detail={edgeDetail}
        loading={edgeDetailLoading}
        open={edgeDetailOpen}
        onClose={handleCloseEdgeDetail}
      />

      {chatFullscreen ? (
        <div className="case-graph-chat-fullscreen-mask" role="presentation">
          {resizingDetailPanel ? <div className="detail-resize-overlay" aria-hidden="true" /> : null}
          <div className="case-graph-chat-fullscreen-shell">
            <div className={`case-graph-chat-fullscreen-main${detailView ? ' has-detail' : ''}`}>
              <div className="case-graph-chat-fullscreen-content">
                <div className="case-graph-chat-fullscreen-header">
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
                      onClick={() => setChatFullscreen(false)}
                    >
                      <Minimize2 size={14} />
                      <span>退出全屏</span>
                    </button>
                  </div>
                </div>

                <DetailPreviewContext.Provider value={previewActions}>
                  <AssistantRuntimeProvider runtime={runtime} aui={aui}>
                    <div className="chat-workspace case-graph-chat-fullscreen-workspace">
                      <div className="case-graph-chat-fullscreen-thread">
                        <ChatThreadContent
                          title={title}
                          flashMessage={null}
                          activeTurn={activeTurn}
                          pendingAskUserPrompt={pendingAskUserPrompt}
                          connectionState={connectionState}
                          currentChatId={currentChatId}
                          isReadOnlySession={isReadOnlySession}
                          onAnswer={(answer) => {
                            void sendAppendMessage(buildTextAppendMessage(answer));
                          }}
                          availableSkills={availableSkills}
                          compact={false}
                          sidebarCollapsed={false}
                          showSidebarToggle={false}
                          onToggleSidebar={() => {}}
                          canOpenWorkspace={Boolean(currentChatId)}
                          workspaceFileCount={workspaceFileCount}
                          workspaceLoading={workspaceLoadingForCurrentChat}
                          onOpenWorkspace={handleOpenWorkspace}
                        />
                      </div>
                      <WorkspacePanel
                        open={workspacePanel.open}
                        loading={workspacePanel.loading}
                        error={workspacePanel.error}
                        workspace={panelWorkspace}
                        onClose={() => appStore.dispatch({ type: 'workspace.close' })}
                        onOpenFile={handleOpenWorkspaceFile}
                      />
                    </div>
                  </AssistantRuntimeProvider>
                </DetailPreviewContext.Provider>
              </div>

              {detailView ? (
                <DetailPreviewPane
                  detailView={detailView}
                  immersive={true}
                  open={true}
                  width={detailPanelWidth}
                  token={token}
                  onClose={() => setDetailView(null)}
                  onResizeStart={() => setResizingDetailPanel(true)}
                />
              ) : null}
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
    drillNums: Number(graph.drillNums || 10),
    drillType: graph.drillType ?? 1,
    minAmount: graph.minAmount ?? null,
    maxAmount: graph.maxAmount ?? null,
    loaded: true,
  };
}

function buildSelectionGroupMap(tradeCards: CaseGraphTradeCard[]): CaseGraphGroupMap {
  const groups: CaseGraphGroupMap = {};
  const buckets = new Map<string, CaseGraphTradeCard[]>();

  for (const card of tradeCards) {
    const accountId = String(card.accountId || '').trim();
    if (!accountId) continue;
    const bucketKey =
      String(card.suspectId || '').trim() ||
      String(card.suspectName || '').trim() ||
      String(card.accountName || '').trim();
    if (!bucketKey) continue;
    const bucket = buckets.get(bucketKey);
    if (bucket) {
      bucket.push(card);
    } else {
      buckets.set(bucketKey, [card]);
    }
  }

  for (const cards of buckets.values()) {
    const memberIds = [...new Set(cards.map((card) => String(card.accountId || '').trim()).filter(Boolean))]
      .sort((left, right) => Number(left) - Number(right));
    if (memberIds.length < 2) continue;
    const groupId = memberIds.join('_');
    const groupName = String(
      cards[0]?.suspectName ||
      cards[0]?.accountName ||
      cards[0]?.tradeCard ||
      groupId,
    ).trim();
    const groupItem = {
      groupId,
      groupName,
      tradeCard: cards.map((card) => ({ ...card })),
    };
    for (const memberId of memberIds) {
      groups[memberId] = groupItem;
    }
  }

  return groups;
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
