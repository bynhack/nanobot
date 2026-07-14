import type { CaseGraphCaseOption } from '../case-graph/types';

export type CaseAuditCaseOption = CaseGraphCaseOption;

export interface CaseAuditOverview {
  caseId: string;
  tradeCount: number;
  sourceFileCount: number;
  balanceMissingCount: number;
  minTradeTime: string;
  maxTradeTime: string;
  totalTradeAmount: string;
}

export interface CaseAuditRunPayload {
  caseId: string;
  auditId?: string;
  victimCards: string[];
  victimNames: string[];
  suspectCards: string[];
  suspectNames: string[];
  sourceMode?: '' | 'recognized';
  sourceAccountCards?: string[];
  sourceAccountNames?: string[];
  sourceAmount?: string;
  sourceLabel?: string;
  sourceFromAuditId?: string;
  sourceLayerIndex?: string;
  startTime?: string;
  endTime?: string;
  minAmount?: string;
  maxAmount?: string;
}

export interface CaseAuditConditions {
  victimCards: string[];
  victimNames: string[];
  suspectCards: string[];
  suspectNames: string[];
  sourceMode?: '' | 'recognized';
  sourceAccountCards?: string[];
  sourceAccountNames?: string[];
  sourceAmount?: string;
  sourceLabel?: string;
  sourceFromAuditId?: string;
  sourceLayerIndex?: string;
}

export interface CaseAuditFilters {
  startTime: string;
  endTime: string;
  minAmount: string;
  maxAmount: string;
}

export interface CaseAuditFileLastRun {
  ranAt: string;
  resultFile: string;
  summary: Partial<CaseAuditSummary>;
  suspectResults: CaseAuditSuspectResult[];
  warningCount: number;
  tradeCount: number;
}

export interface CaseAuditFile {
  schemaVersion: 'case-audit-file.v1';
  auditId: string;
  caseId: string;
  auditName: string;
  createdAt: string;
  updatedAt: string;
  conditions: CaseAuditConditions;
  filters: CaseAuditFilters;
  lastRun: CaseAuditFileLastRun | null;
}

export interface CaseAuditFileListResponse {
  items: CaseAuditFile[];
  activeAuditId: string;
}

export interface CaseAuditSummary {
  tradeCount: number;
  sourceFileCount: number;
  accountGroupCount: number;
  recognizedTradeCount: number;
  suspectCount: number;
  fraudAmount: string;
  fraudAmountNumber: number;
  confirmAmount: string;
  confirmAmountNumber: number;
  caseAmount: string;
  caseAmountNumber: number;
  balanceMissingCount: number;
  unknownDirectionCount: number;
  missingGroupCardCount: number;
  victimInputCount: number;
  suspectInputCount: number;
  sourceInputCount?: number;
}

export interface CaseAuditSuspectResult {
  suspectName: string;
  suspectCard: string;
  confirmAmount: string;
  confirmAmountNumber: number;
  caseAmount: string;
  caseAmountNumber: number;
  fraudAmount: string;
  fraudAmountNumber: number;
  tradeIds: string[];
  relatedTradeIds: string[];
  confirmedRelatedTradeIds?: string[];
  balanceExcludedTradeIds?: string[];
  reasoningStepIds?: string[];
}

export interface CaseAuditReasoningStep {
  id: string;
  kind: 'source_carryover' | 'victim_credit' | 'worst_case_offset' | 'worst_case_clear' | 'suspect_no_confirm' | 'suspect_recognition';
  tradeId: string;
  serialNumber: string;
  tradeTime: string;
  accountCard: string;
  payerName: string;
  payerCard: string;
  payeeName: string;
  payeeCard: string;
  amount: string;
  amountNumber: number;
  poolBefore: string;
  poolBeforeNumber: number;
  poolAfter: string;
  poolAfterNumber: number;
  payerTradeBalance: string;
  payerTradeBalanceNumber: number;
  confirmAmount: string;
  confirmAmountNumber: number;
  fileName: string;
  segmentStepIds?: string[];
}

export interface CaseAuditGraphNode {
  id: string;
  label: string;
  card: string;
  role: 'victim' | 'transfer' | 'suspect';
}

export interface CaseAuditGraphEdge {
  id: string;
  source: string;
  target: string;
  tradeId: string;
  amount: string;
  amountNumber: number;
  confirmAmount: string;
  confirmAmountNumber: number;
  flowStatus?: string;
  flowStatusText?: string;
  fileName: string;
}

export interface CaseAuditTrade {
  id: string;
  tradeRowId: string;
  fileId: string;
  fileName: string;
  serialNumber: string;
  tradeTime: string;
  jdFlag: string;
  payerAccountId: string;
  payerAccountName: string;
  payerTradeCard: string;
  payeeAccountId: string;
  payeeAccountName: string;
  payeeTradeCard: string;
  relationId: string;
  flowStatus: string;
  flowStatusText: string;
  tradeAmount: string;
  tradeAmountNumber: number;
  payerTradeBalance: string;
  payerTradeBalanceNumber: number;
  tradeBalance: string;
  tradeBalanceNumber: number;
  faultAmount: string;
  faultAmountNumber: number;
  confirmAmount: string;
  confirmAmountNumber: number;
  caseAmount: string;
  caseAmountNumber: number;
}

export interface CaseAuditResult {
  schemaVersion: 'case-audit.v1';
  caseId: string;
  scope: 'case';
  algorithm: {
    id: string;
    source: string;
    inputMode: string;
    rules: string[];
  };
  summary: CaseAuditSummary;
  quality: {
    warnings: string[];
  };
  suspectNames: string[];
  suspectResults: CaseAuditSuspectResult[];
  reasoningSteps?: CaseAuditReasoningStep[];
  graph: {
    nodes: CaseAuditGraphNode[];
    edges: CaseAuditGraphEdge[];
  };
  trades: CaseAuditTrade[];
}
