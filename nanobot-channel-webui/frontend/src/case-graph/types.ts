export interface CaseGraphTradeCard {
  tradeId?: string;
  accountId?: string | null;
  accountIds?: string[];
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
  source?: string;
  isManual?: boolean;
  discoveryReason?: string;
  sourceNote?: string;
  note?: string;
  createdAt?: string;
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
  tradeIds?: string[];
  hasManualTrade?: boolean;
  manualTradeCount?: number;
  sourceTypes?: string[];
  edgeKind?: 'money' | 'reality';
  relationType?: string;
  label?: string;
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
  tradeFacts?: Record<string, CaseGraphTradeFact>;
  excludedAccountId?: string | string[] | null;
  excludedNodes?: CaseGraphExcludedNode[];
  sourceSelectId: string[];
}

export interface CaseGraphData {
  nodes: CaseGraphNode[];
  edges: CaseGraphMoneyEdge[];
  tradeFacts?: Record<string, CaseGraphTradeFact>;
  excludedNodes?: CaseGraphExcludedNode[];
  realityRelations?: CaseGraphRealityRelation[];
}

export interface CaseGraphTradeFact {
  tradeId: string;
  serialNumber?: string | null;
  tradeAmount: number;
  tradeTime?: string | null;
  tradeAbstract?: string;
  remark?: string;
  debitCreditFlag?: string;
  tradeType?: string;
  tradeChannel?: string;
  tradeChannelCode?: string;
  thirdPayType?: string;
  thirdPayTypeCode?: string;
  ipAddress?: string;
  macAddress?: string;
  terminalNo?: string;
  posNo?: string;
  deviceType?: string;
  deviceNo?: string;
  orderNo?: string | number;
  thirdOrderNo?: string | number;
  outerSerialNumber?: string | number;
  merchantName?: string;
  merchantCode?: string;
  counterpartyInstitution?: string;
  payerBankName?: string;
  payeeBankName?: string;
  payerAccountId?: string | number | null;
  payerAccountName?: string;
  payerTradeCard?: string;
  payeeAccountId?: string | number | null;
  payeeAccountName?: string;
  payeeTradeCard?: string;
  source?: string;
  method?: string;
  sourceNote?: string;
  createdAt?: string;
}

export interface CaseGraphRealityRelation {
  id: string;
  source: string;
  target: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  relationType: string;
  label?: string;
  note?: string;
  sourceType?: string;
  createdAt?: string;
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
  tradeFacts?: Record<string, CaseGraphTradeFact>;
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
  tradeFacts: Record<string, CaseGraphTradeFact>;
  factStore?: {
    tradeFactsPath?: string;
    tradeFactCount?: number;
  };
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
  realityRelations?: CaseGraphRealityRelation[];
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

export interface CaseGraphStepOperation {
  type: string;
  label?: string;
  params?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CaseGraphStepDelta {
  addedNodes?: CaseGraphNode[];
  addedEdges?: CaseGraphMoneyEdge[];
  updatedNodes?: CaseGraphNode[];
  updatedEdges?: CaseGraphMoneyEdge[];
  addedRealityRelations?: CaseGraphRealityRelation[];
  updatedRealityRelations?: CaseGraphRealityRelation[];
  removedNodeIds?: string[];
  removedEdgeIds?: string[];
  [key: string]: unknown;
}

export interface CaseGraphStepSnapshot {
  schemaVersion: 'case-graph.step.v1';
  caseId: string;
  graphId: string;
  stepId: string;
  operation: CaseGraphStepOperation;
  baseRevision?: number;
  revision: number;
  createdAt: string;
  actor?: string;
  source?: string;
  graph: CaseGraphStateBody;
  delta?: CaseGraphStepDelta;
  summary?: Record<string, unknown>;
  file?: string;
}

export interface CaseGraphReplayTimelineStep {
  stepId: string;
  time: number;
  label: string;
  operationLabel: string;
  nodeCount: number;
  edgeCount: number;
  addedNodeCount: number;
  addedEdgeCount: number;
}

export interface CaseGraphReplayTimeline {
  steps: CaseGraphReplayTimelineStep[];
  activeStepId: string | null;
  loading?: boolean;
  onStepSelect: (stepId: string | null) => void;
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

export interface ExcludeCaseGraphTradesPayload {
  graphId: string;
  caseId: string;
  excludedTrades: string[];
  tradeFacts: Record<string, CaseGraphTradeFact> | CaseGraphTradeFact[];
  edgeTradeIds: Record<string, string[]>;
  options?: Record<string, unknown>;
}

export interface ApplyCaseGraphSummarySelectionPayload {
  graphId: string;
  caseId: string;
  focusNodeId?: string | null;
  candidateNodeIds: string[];
  selectedNodeIds: string[];
  selectedCandidates?: Array<{
    nodeId: string;
    label?: string;
    accounts?: CaseGraphTradeCard[];
  }>;
  scope?: 'node' | 'global';
  direction?: 'in' | 'out' | 'both';
  drillNums?: number;
  drillType?: string | number | null;
  filters?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface QueryCaseGraphSummaryCandidatesPayload {
  graphId: string;
  caseId: string;
  focusNodeId?: string | null;
  scope?: 'node' | 'global';
  direction?: 'in' | 'out' | 'both';
  drillNums?: number;
  drillType?: string | number | null;
  filters?: Record<string, unknown>;
}

export interface ExcludeCaseGraphNodePayload {
  graphId: string;
  caseId: string;
  node?: CaseGraphExcludedNode;
  nodes?: CaseGraphExcludedNode[];
}

export interface RestoreCaseGraphNodePayload {
  graphId: string;
  caseId: string;
  nodeId: string;
}

export interface CaseGraphManualPartyPayload {
  nodeId?: string;
  id?: string;
  label?: string;
  name?: string;
  accountName?: string;
  accountId?: string | null;
  tradeCard?: string;
  createNew?: boolean;
}

export interface AddCaseGraphManualTradePayload {
  graphId: string;
  caseId: string;
  payer: CaseGraphManualPartyPayload;
  payee: CaseGraphManualPartyPayload;
  amount: number | string;
  tradeTime?: string | null;
  method?: string;
  summary?: string;
  sourceNote?: string;
  options?: Record<string, unknown>;
}

export interface AddCaseGraphManualNodePayload {
  graphId: string;
  caseId: string;
  label: string;
  tradeCard?: string;
  discoveryReason?: string;
  sourceNote?: string;
  note?: string;
  position?: { x: number; y: number };
  options?: Record<string, unknown>;
}

export interface AddCaseGraphRealityRelationPayload {
  graphId: string;
  caseId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType: string;
  label?: string;
  note?: string;
  options?: Record<string, unknown>;
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
