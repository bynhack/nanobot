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

export interface CaseGraphOriginData {
  graphId?: string;
  nodes: CaseGraphNode[];
  money: CaseGraphMoneyEdge[];
  phone: CaseGraphPhoneEdge[];
  groups: CaseGraphGroupMap;
  excludedTrades: string[];
  excludedAccountId?: string | string[] | null;
  sourceSelectId: string[];
}

export interface CaseGraphData {
  nodes: CaseGraphNode[];
  edges: CaseGraphMoneyEdge[];
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
  graphData?: CaseGraphQueryResult | null;
}

export interface UpdateCaseGraphConfigPayload {
  drillNums: number;
  drillType: string | number | null;
  minAmount?: number | string | null;
  maxAmount?: number | string | null;
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
  graph?: CaseGraphData;
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
