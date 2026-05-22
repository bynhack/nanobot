export interface CaseGraphTradeCard {
  tradeId?: string;
  accountId?: string | null;
  tradeCard?: string;
  accountName?: string;
  suspectId?: string;
  suspectName?: string;
  amount?: number;
  [key: string]: unknown;
}

export interface CaseGraphCaseOption {
  id: string;
  caseCode: string;
  caseName: string;
  isCurrent: boolean;
}

export interface CaseGraphSelectableAccount {
  accountId: string;
  tradeCard: string;
  accountName: string;
  suspectId?: string;
  suspectName?: string;
  accountCategory?: number | null;
  isObtain?: number | null;
}

export interface CaseGraphSavedGraph {
  graphId: string;
  caseId: string;
  graphName: string;
  tradeCardCount: number;
  updatedAt: number;
  chatId?: string;
}

export interface CaseGraphNode {
  id: string;
  label?: string;
  accountId?: string | null;
  tradeCard?: string;
  accountName?: string;
  groupId?: string | null;
  groupName?: string;
  isGroup?: boolean;
  name?: string;
  x?: number;
  y?: number;
  role?: string;
  type?: string;
  accounts?: CaseGraphTradeCard[];
}

export interface CaseGraphMoneyEdge {
  id: string;
  from: string;
  to: string;
  source?: string;
  target?: string;
  tradeCount: number;
  tradeAmount: number;
  amount?: number;
  count?: number;
  startDate?: string | null;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  scope?: string;
  isExcluded?: boolean;
}

export interface CaseGraphPhoneEdge {
  id: string;
  from: string;
  to: string;
  count?: number;
  phoneCount?: number;
}

export interface CaseGraphGroupItem {
  groupId: string;
  groupName: string;
  tradeCard: CaseGraphTradeCard[];
  [key: string]: unknown;
}

export type CaseGraphGroupMap = Record<string, CaseGraphGroupItem>;

export interface CaseGraphExcludedNode {
  nodeId: string;
  label: string;
  type?: string;
  accountIds?: string[];
  tradeCards?: string[];
  reason?: string;
  excludedAt?: string;
}

export interface CaseGraphOriginData {
  graphId?: string;
  nodes: CaseGraphNode[];
  money: CaseGraphMoneyEdge[];
  phone: CaseGraphPhoneEdge[];
  groups: CaseGraphGroupMap;
  excludedTrades: string[];
  excludedAccountId?: string | string[] | null;
  excludedNodes?: CaseGraphExcludedNode[];
  sourceSelectId: string[];
}

export interface CaseGraphData {
  nodes: CaseGraphNode[];
  edges: CaseGraphMoneyEdge[];
  excludedNodes?: CaseGraphExcludedNode[];
}

export interface CaseGraphSnapshot {
  graph_id: string;
  caseId: string;
  graphName: string;
  graphContent?: string;
  tradeCards: CaseGraphTradeCard[];
  groupMap?: CaseGraphGroupMap;
  excludedTrades: string[];
  excludedAccountId: string | string[] | null;
  excludedAccountName?: string[];
  summarySelectedAccountId?: string[];
  summarySelectedAccountName?: string[];
  sourceSelectId?: string[];
  drillNums: number;
  drillType: string | number | null;
  minAmount?: number | string | null;
  maxAmount?: number | string | null;
  graphData?: CaseGraphQueryResult | CaseGraphRelationResponse | null;
  excludedNodes?: CaseGraphExcludedNode[];
  chatId?: string;
}

export interface UpdateCaseGraphConfigPayload {
  drillNums?: number;
  drillType?: string | number | null;
  minAmount?: number | string | null;
  maxAmount?: number | string | null;
  chatId?: string;
  graphData?: CaseGraphQueryResult | CaseGraphRelationResponse | null;
}

export interface CaseGraphTargetDetailItem {
  tradeId: string | number | null;
  serialNumber: string | null;
  tradeAmount: number;
  tradeTime: string | null;
  tradeAbstract: string;
  payerAccountId: string | number | null;
  payerAccountName: string;
  payerTradeCard: string;
  payeeAccountId: string | number | null;
  payeeAccountName: string;
  payeeTradeCard: string;
}

export type CaseGraphTargetDetailResult = CaseGraphTargetDetailItem[];

export interface CaseGraphQueryResult {
  nodes: CaseGraphNode[];
  money: CaseGraphMoneyEdge[];
  phone: CaseGraphPhoneEdge[];
  groups: CaseGraphGroupMap;
  sourceSelectId: string[];
  tradeCards?: CaseGraphTradeCard[];
  excludedTrades?: string[];
  excludedAccountId?: string | string[] | null;
  excludedNodes?: CaseGraphExcludedNode[];
  graph?: CaseGraphData;
}

export interface CaseGraphRelationSeed {
  suspectId?: string;
  suspectName?: string;
  accountIds: string[];
  excludedAccountIds?: string[];
  accounts?: CaseGraphTradeCard[];
}

export interface CaseGraphRelationResponse {
  schemaVersion: string;
  caseId: string;
  graphId: string;
  queryMode: string;
  graph: CaseGraphData;
  graphState?: CaseGraphStateSnapshot;
  delta: {
    addedNodes?: CaseGraphNode[];
    addedEdges?: CaseGraphMoneyEdge[];
    updatedNodes?: CaseGraphNode[];
    updatedEdges?: CaseGraphMoneyEdge[];
  };
  step: {
    stepId: string;
    type: string;
    createdAt?: string;
    request?: Record<string, unknown>;
    summary?: Record<string, unknown>;
    file?: string;
  };
}

export interface CaseGraphLayoutState {
  nodePositions: Record<string, { x: number; y: number }>;
  viewport: { x: number; y: number; zoom: number };
}

export interface CaseGraphAppliedFilters {
  minAmount: number | string | null;
  maxAmount: number | string | null;
  startTime: string;
  endTime: string;
}

export interface CaseGraphStateBody {
  nodes: CaseGraphNode[];
  edges: CaseGraphMoneyEdge[];
  tradeCards: CaseGraphTradeCard[];
  groupMap: CaseGraphGroupMap;
  sourceSelectId: string[];
  summarySelectedAccountId: string[];
  summarySelectedAccountName: string[];
  excludedTrades: string[];
  excludedAccountId: string[];
  excludedAccountName: string[];
  layout: CaseGraphLayoutState;
  filters: CaseGraphAppliedFilters;
  excludedNodes: CaseGraphExcludedNode[];
  manualEdges: CaseGraphMoneyEdge[];
  annotations: Array<Record<string, unknown>>;
  graphData?: CaseGraphQueryResult | null;
}

export interface CaseGraphStateSnapshot {
  schemaVersion: 'case-graph.state.v1';
  caseId: string;
  graphId: string;
  graphName: string;
  revision: number;
  updatedAt: string;
  lastStepId: string;
  graph: CaseGraphStateBody;
}

export interface QueryCaseGraphRelationPayload {
  graphId: string;
  caseId: string;
  seeds: CaseGraphRelationSeed[];
  direction?: 'in' | 'out' | 'both';
  drillNums?: number;
  drillType?: string | number | null;
  filters?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface CompleteCaseGraphRelationPayload {
  graphId: string;
  caseId: string;
  accounts: CaseGraphTradeCard[];
  filters?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface FilterCaseGraphRelationPayload {
  graphId: string;
  caseId: string;
  filters?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface ExcludeCaseGraphNodePayload {
  graphId: string;
  caseId: string;
  node: CaseGraphExcludedNode;
}

export interface RestoreCaseGraphNodePayload {
  graphId: string;
  caseId: string;
  nodeId: string;
}

export interface CreateCaseGraphPayload {
  caseId: string;
  graphName: string;
  tradeCards: CaseGraphTradeCard[];
}

export interface QueryCaseGraphPayload {
  graphId: string;
  caseId: string;
  tradeCards: CaseGraphTradeCard[];
  groupMap?: CaseGraphGroupMap;
  groupNames?: string[];
  direction?: string;
  limit?: number;
  excludedTrades?: string[];
  excludedAccountId?: string | string[] | null;
  excludedAccountName?: string[];
  summarySelectedAccountId?: string[];
  summarySelectedAccountName?: string[];
  sourceSelectId?: string[];
  isSelectedTradeCardChanged?: boolean;
  minAmount?: number | string | null;
  maxAmount?: number | string | null;
  startTime?: string | null;
  endTime?: string | null;
  tradeDirectionList?: string[];
}

export interface DrillDownCaseGraphPayload {
  graphId: string;
  caseId: string;
  tradeCards?: CaseGraphTradeCard[];
  tradeCard?: CaseGraphTradeCard[];
  payer?: string;
  payee?: string;
  drill_type?: string;
  drillType?: string | number | null;
  direction?: string;
  limit?: number;
  excludedCards?: CaseGraphTradeCard[];
  excludedTrades?: string[];
  excludedAccountId?: string | string[] | null;
  minAmount?: number | string | null;
  maxAmount?: number | string | null;
  startTime?: string | null;
  endTime?: string | null;
}

export interface CaseGraphTargetDetailPayload {
  graphId: string;
  caseId: string;
  payerCards: CaseGraphTradeCard[];
  payeeCards: CaseGraphTradeCard[];
  limit?: number;
  min_amount?: number;
  max_amount?: number;
  startTime?: string | null;
  endTime?: string | null;
}

export interface CaseGraphRequestState {
  graphLoading: boolean;
  graphQueryLoading: boolean;
  drilldownLoading: boolean;
  edgeDetailLoading: boolean;
  graphCreateLoading: boolean;
}

export type CaseGraphConversationFocus =
  | {
      type: 'graph';
      graphId: string;
      caseId: string;
      graphName: string;
    }
  | {
      type: 'node';
      graphId: string;
      caseId: string;
      graphName: string;
      nodeId: string;
      label?: string;
      accountId?: string | null;
      accountName?: string;
      tradeCard?: string;
    }
  | {
      type: 'edge';
      graphId: string;
      caseId: string;
      graphName: string;
      from: string;
      to: string;
      fromName?: string;
      toName?: string;
    };

export interface CaseGraphState {
  activeCaseId: string | null;
  activeGraphId: string | null;
  graphDetail: CaseGraphSnapshot | null;
  graphData: CaseGraphData | null;
  originData: CaseGraphOriginData | null;
  groupMap: CaseGraphGroupMap;
  tradeCards: CaseGraphTradeCard[];
  edgeDetail: CaseGraphTargetDetailResult | null;
  requests: CaseGraphRequestState;
  error: string | null;
}
