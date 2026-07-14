import { AlertCircle, ArrowLeft, Calculator, Check, ChevronDown, Download, FileText, Network, Play, Plus, Route, Save, Scale, TableProperties } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { Graph as G6Graph } from '@antv/g6';

import {
  createCaseAuditFile,
  loadCaseAuditCases,
  loadCaseAuditFiles,
  loadCaseAuditOverview,
  runCaseAudit,
  saveCaseAuditFile,
} from './api';
import { Modal } from '../components/ui/modal';
import { Select } from '../components/ui/select';
import type {
  CaseAuditCaseOption,
  CaseAuditConditions,
  CaseAuditFile,
  CaseAuditFilters,
  CaseAuditOverview,
  CaseAuditReasoningStep,
  CaseAuditResult,
  CaseAuditRunPayload,
  CaseAuditSuspectResult,
  CaseAuditTrade,
} from './types';

interface CaseAuditPageProps {
  token: string;
  onBack: () => void;
  navigationSlot?: ReactNode;
}

interface CaseAuditCandidateSuspect {
  name: string;
  card: string;
  sourceTradeId: string;
  sourceSerialNumber: string;
  sourceAmount: string;
  reason: string;
}

interface CaseAuditSuspectStatus {
  key: string;
  name: string;
  card: string;
  reason: string;
  tradeLabel: string;
}

function CaseAuditSecondaryButton({ children, className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`case-audit-secondary-button${className ? ` ${className}` : ''}`} type={type} {...props}>
      {children}
    </button>
  );
}

type AuditVisualRole = 'victim' | 'transfer' | 'suspect' | 'pool' | 'deduction' | 'recognition';
type AuditVisualEdgeKind =
  | 'victim-inflow'
  | 'balance-excluded-inflow'
  | 'suspect-outflow'
  | 'trade'
  | 'pool-increase'
  | 'pool-deduction'
  | 'balance-deduction'
  | 'stage-carryover'
  | 'recognition';

interface AuditVisualNode {
  id: string;
  label: string;
  card: string;
  role: AuditVisualRole;
  totalIn: number;
  totalOut: number;
  tradeCount: number;
  incomingCredit: boolean;
  outgoingDebit: boolean;
  suspectHit: boolean;
  victimSource: boolean;
  subtitle?: string;
  primaryAmount?: string;
  formula?: string;
  detail?: string;
  candidateName?: string;
  candidateCard?: string;
  candidateSourceTradeId?: string;
  candidateSourceSerialNumber?: string;
  candidateSourceAmount?: string;
  candidateReason?: string;
  canPromoteSuspect?: boolean;
}

interface AuditVisualEdge {
  id: string;
  source: string;
  target: string;
  tradeId: string;
  amount: string;
  amountNumber: number;
  confirmAmount: string;
  confirmAmountNumber: number;
  kind: AuditVisualEdgeKind;
  label: string;
  flowStatus: string;
  flowStatusText: string;
  fileName: string;
  title?: string;
}

interface AuditVisualGraph {
  nodes: Array<{
    id: string;
    style: {
      x: number;
      y: number;
    };
    data: AuditVisualNode;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: 'cubic-horizontal';
    style: {
      sourcePort: 'out';
      targetPort: 'in';
    };
    data: AuditVisualEdge;
  }>;
  counts: {
    victim: number;
    transfer: number;
    suspect: number;
  };
}

const AUDIT_NODE_WIDTH = 252;
const AUDIT_NODE_HEIGHT = 144;
const AUDIT_COLUMN_GAP = 430;
const AUDIT_ROW_GAP = 212;
const AUDIT_GRAPH_PADDING = 72;
const AUDIT_GRAPH_MIN_HEIGHT = 640;
const AUDIT_NODE_PORTS = [
  { key: 'in', placement: 'left', r: 0, fill: 'transparent', stroke: 'transparent' },
  { key: 'out', placement: 'right', r: 0, fill: 'transparent', stroke: 'transparent' },
] as const;

function splitInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .replace(/，/g, ',')
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function joinInput(items: string[] | undefined): string {
  return Array.isArray(items) ? items.join('\n') : '';
}

function normalizeDateTime(value: string): string | undefined {
  const text = value.trim();
  if (!text) {
    return undefined;
  }
  const normalized = text.replace('T', ' ');
  return normalized.length === 16 ? `${normalized}:00` : normalized;
}

function toDateTimeInputValue(value: string | undefined): string {
  const text = String(value ?? '').trim();
  if (!text) {
    return '';
  }
  const normalized = text.replace(' ', 'T');
  return normalized.length >= 16 ? normalized.slice(0, 16) : normalized;
}

function emptyAuditConditions(): CaseAuditConditions {
  return {
    victimCards: [],
    victimNames: [],
    suspectCards: [],
    suspectNames: [],
    sourceMode: '',
    sourceAccountCards: [],
    sourceAccountNames: [],
    sourceAmount: '',
    sourceLabel: '',
    sourceFromAuditId: '',
    sourceLayerIndex: '',
  };
}

function emptyAuditFilters(): CaseAuditFilters {
  return {
    startTime: '',
    endTime: '',
    minAmount: '',
    maxAmount: '',
  };
}

function roleLabel(role: AuditVisualRole): string {
  if (role === 'victim') {
    return '被害人来源';
  }
  if (role === 'pool') {
    return '本段被害资金汇总';
  }
  if (role === 'deduction') {
    return '非嫌疑人转出';
  }
  if (role === 'recognition') {
    return '金额认定';
  }
  if (role === 'suspect') {
    return '嫌疑人去向';
  }
  return '中转账户';
}

function auditNodeMeaning(node: AuditVisualNode): string {
  if (node.canPromoteSuspect) {
    return '这是系统发现的候选嫌疑人收款节点。办案人员确认后，可把该收款人加入嫌疑人条件，并按同一套金额认定规则重新计算。';
  }
  if (node.role === 'pool' && node.id.startsWith('reason-calc:')) {
    return '这是暂不认定的计算结果节点。系统判断转出后余额仍能覆盖本段资金池，或本段还没有可用于认定的被害资金，因此本步不形成最低可认定金额。';
  }
  if (node.role === 'victim') {
    return '这是被害人被骗后转入中转账号的一笔入账。它会进入当前审计段的累计金额，作为后续判断嫌疑人可认定金额的起点。';
  }
  if (node.role === 'pool') {
    return '这是被害人被骗入账相加形成的资金池。它不是账户真实余额，而是用于后续金额认定的待判断金额。';
  }
  if (node.role === 'deduction') {
    return '这是转给非嫌疑人或暂不形成认定的处理节点。系统会按最保守口径先扣减，或在余额仍能覆盖时暂不把这笔钱认定给嫌疑人。';
  }
  if (node.role === 'suspect') {
    return '这是中转账号向已设定嫌疑人转出的流水节点。系统会结合转出后余额判断这笔转出是否能形成最低可认定金额。';
  }
  if (node.role === 'recognition') {
    return '这是一次金额认定的结果节点。可认定金额按“本段转出前累计金额 - 转出后账户余额”取最低口径计算，形成认定后本段封段，后续入账重新累计。';
  }
  return '这是资金链上的中转主体节点，用于汇总该主体在本次审计范围内的入账、出账和后续流向。';
}

function toMoneyNumber(value: string | number | null | undefined): number {
  const numeric = Number(String(value ?? 0).replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : 0;
}

function moneyText(value: string | number | null | undefined): string {
  const numeric = toMoneyNumber(value);
  return numeric.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function moneyPayloadValue(value: string | number | null | undefined): string {
  return toMoneyNumber(value).toFixed(2);
}

function evidenceNumber(index: number): string {
  return `证据-${String(index + 1).padStart(3, '0')}`;
}

function csvCell(value: string | number | null | undefined): string {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadTextFile(filename: string, content: string, mimeType = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function normalizedTextList(items: string[] | undefined): string[] {
  return Array.from(new Set((items ?? []).map(normalizePartyText).filter(Boolean))).sort();
}

function textListEquals(left: string[] | undefined, right: string[] | undefined): boolean {
  const normalizedLeft = normalizedTextList(left);
  const normalizedRight = normalizedTextList(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((item, index) => item === normalizedRight[index]);
}

function sameMoneyValue(left: string | number | null | undefined, right: string | number | null | undefined): boolean {
  return moneyPayloadValue(left) === moneyPayloadValue(right);
}

function findMatchingLayerAudit(auditFiles: CaseAuditFile[], conditions: CaseAuditConditions): CaseAuditFile | null {
  return auditFiles.find((item) => {
    const current = item.conditions ?? emptyAuditConditions();
    return current.sourceMode === 'recognized'
      && current.sourceFromAuditId === conditions.sourceFromAuditId
      && current.sourceLayerIndex === conditions.sourceLayerIndex
      && sameMoneyValue(current.sourceAmount, conditions.sourceAmount)
      && textListEquals(current.sourceAccountCards, conditions.sourceAccountCards)
      && textListEquals(current.sourceAccountNames, conditions.sourceAccountNames);
  }) ?? null;
}

function auditFileOptionDescription(auditFile: CaseAuditFile): string {
  const conditions = auditFile.conditions ?? emptyAuditConditions();
  const parts: string[] = [];
  if (conditions.sourceMode === 'recognized') {
    parts.push(conditions.sourceLayerIndex ? `第 ${conditions.sourceLayerIndex} 层追踪` : '下级资金追踪');
    if (conditions.sourceLabel) {
      parts.push(conditions.sourceLabel);
    }
  } else {
    parts.push('被害人入账起点');
  }
  parts.push(auditFile.lastRun ? '已保存审计结果' : '尚未执行审计');
  return parts.join(' / ');
}

function caseAuditErrorText(message: string): string {
  if (message.includes('sourceCondition')) {
    return '下级资金追踪缺少上一层可认定金额或来源账号，请从右侧已认定嫌疑人卡片重新发起。';
  }
  if (message.includes('victimCondition')) {
    return '请先设置被害人账号或姓名，普通审计需要以被害人被骗入账作为起点。';
  }
  return message;
}

function auditFlowStatusText(trade: Pick<CaseAuditTrade, 'flowStatus' | 'flowStatusText' | 'jdFlag'>): string {
  if (trade.flowStatusText) {
    return trade.flowStatusText;
  }
  if (trade.flowStatus === 'confirmed_flow') {
    return '余额无法完全包含，可标识具体流向';
  }
  if (trade.flowStatus === 'balance_excluded') {
    return '余额可包含，应排除具体流向';
  }
  if (trade.flowStatus === 'suspect_outflow') {
    return '嫌疑人收款，计算最低可认定';
  }
  return normalizePartyText(trade.jdFlag) === '贷' ? '参与累计认定' : '-';
}

function auditEvidenceRoleText(trade: CaseAuditTrade, step?: CaseAuditReasoningStep): string {
  if (step?.kind === 'victim_credit') {
    return '被害人入账累计';
  }
  if (step?.kind === 'worst_case_offset') {
    return '最坏结果扣减';
  }
  if (step?.kind === 'worst_case_clear') {
    return '扣减清空本段';
  }
  if (step?.kind === 'suspect_recognition') {
    return '嫌疑人金额认定';
  }
  if (step?.kind === 'suspect_no_confirm') {
    return '嫌疑人收款暂不认定';
  }
  if (trade.flowStatus === 'confirmed_flow') {
    return '可标识具体流向';
  }
  if (trade.flowStatus === 'balance_excluded') {
    return '可包含应排除';
  }
  if (trade.flowStatus === 'suspect_outflow') {
    return '嫌疑人收款';
  }
  return '未参与本次认定';
}

function auditEvidenceRowClass(trade: CaseAuditTrade, step?: CaseAuditReasoningStep): string {
  const kind = step?.kind || trade.flowStatus || 'ignored';
  return `case-audit-evidence-row case-audit-evidence-row--${kind}`;
}

function auditEvidenceProcessText(trade: CaseAuditTrade, step?: CaseAuditReasoningStep): string {
  if (step || trade.flowStatus) {
    return '进入认定链';
  }
  return '保留底稿';
}

function auditEvidenceFormula(trade: CaseAuditTrade, step?: CaseAuditReasoningStep): string {
  if (step) {
    return reasoningStepFormula(step);
  }
  if (trade.flowStatus === 'confirmed_flow') {
    return `${moneyText(trade.tradeAmount)} > 余额 ${moneyText(trade.payerTradeBalance)}`;
  }
  if (trade.flowStatus === 'balance_excluded') {
    return `${moneyText(trade.tradeAmount)} <= 余额 ${moneyText(trade.payerTradeBalance)}`;
  }
  if (trade.confirmAmountNumber > 0) {
    return `可认定 ${moneyText(trade.confirmAmount)}`;
  }
  return '-';
}

function auditEvidenceRemark(trade: CaseAuditTrade, step?: CaseAuditReasoningStep): string {
  if (step?.kind === 'victim_credit') {
    return `进入中转账号 ${step.payeeName || step.payeeCard || step.accountCard}`;
  }
  if (step?.kind === 'worst_case_offset') {
    return '转给非嫌疑人，先从本段涉诈资金池扣减';
  }
  if (step?.kind === 'worst_case_clear') {
    return '转出金额覆盖本段资金池，本段按最坏结果归零';
  }
  if (step?.kind === 'suspect_recognition') {
    return '用本段资金池扣除转出后余额，得到最低可认定金额';
  }
  if (step?.kind === 'suspect_no_confirm') {
    return '转出后余额仍可覆盖本段资金池，本笔暂不认定';
  }
  if (trade.flowStatus === 'confirmed_flow') {
    return '该入账金额大于嫌疑人出账后的余额，可作为具体流向证据';
  }
  if (trade.flowStatus === 'balance_excluded') {
    return '该入账金额可被余额覆盖，按规则不单独指向嫌疑人';
  }
  return '保留原始流水记录，但未命中本次被害人入账或嫌疑人出账认定条件';
}

function buildReasoningStepByTradeId(result: CaseAuditResult | null): Map<string, CaseAuditReasoningStep> {
  const steps = result?.reasoningSteps ?? [];
  return new Map(steps.map((step) => [step.tradeId, step]));
}

function auditTradeTimelineSort(left: CaseAuditTrade, right: CaseAuditTrade): number {
  const timeDelta = normalizePartyText(left.tradeTime).localeCompare(normalizePartyText(right.tradeTime));
  if (timeDelta !== 0) {
    return timeDelta;
  }
  const leftSerial = Number(left.serialNumber || 0);
  const rightSerial = Number(right.serialNumber || 0);
  if (Number.isFinite(leftSerial) && Number.isFinite(rightSerial) && leftSerial !== rightSerial) {
    return leftSerial - rightSerial;
  }
  return normalizePartyText(left.tradeRowId || left.id).localeCompare(normalizePartyText(right.tradeRowId || right.id));
}

function normalizePartyText(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

function buildSuspectKeySet(suspectCards: string[], suspectNames: string[]): Set<string> {
  const keys = new Set<string>();
  suspectCards.forEach((card) => {
    const normalized = normalizePartyText(card);
    if (normalized) {
      keys.add(`card:${normalized}`);
    }
  });
  suspectNames.forEach((name) => {
    const normalized = normalizePartyText(name);
    if (normalized) {
      keys.add(`name:${normalized}`);
    }
  });
  return keys;
}

function buildConfiguredSuspectStatuses(
  result: CaseAuditResult | null,
  suspectCards: string[],
  suspectNames: string[],
): CaseAuditSuspectStatus[] {
  if (!result) {
    return [];
  }
  const recognizedKeys = buildSuspectKeySet(
    result.suspectResults.map((item) => item.suspectCard),
    result.suspectResults.map((item) => item.suspectName),
  );
  const configured: CaseAuditSuspectStatus[] = [];
  const seen = new Set<string>();
  const addConfigured = (name: string, card: string) => {
    const normalizedName = normalizePartyText(name);
    const normalizedCard = normalizePartyText(card);
    const key = normalizedCard ? `card:${normalizedCard}` : `name:${normalizedName}`;
    if ((!normalizedName && !normalizedCard) || seen.has(key)) {
      return;
    }
    seen.add(key);
    if (isKnownSuspect(recognizedKeys, normalizedCard, normalizedName)) {
      return;
    }
    const matchedSteps = (result.reasoningSteps ?? []).filter((step) => (
      step.kind === 'suspect_no_confirm'
      && (
        (normalizedCard && normalizePartyText(step.payeeCard) === normalizedCard)
        || (normalizedName && normalizePartyText(step.payeeName) === normalizedName)
      )
    ));
    const lastStep = matchedSteps[matchedSteps.length - 1];
    configured.push({
      key,
      name: normalizedName || lastStep?.payeeName || '',
      card: normalizedCard || lastStep?.payeeCard || '',
      tradeLabel: lastStep ? `流水 ${lastStep.serialNumber || lastStep.tradeId || '-'}` : '-',
      reason: lastStep
        ? `命中${lastStep.serialNumber ? `流水 ${lastStep.serialNumber}` : '一笔出账'}，但${lastStep.payerName || lastStep.payerCard || '中转账号'}转出后余额 ${moneyText(lastStep.payerTradeBalanceNumber || lastStep.payerTradeBalance)} 仍能覆盖本段资金池 ${moneyText(lastStep.poolBeforeNumber || lastStep.poolBefore)}，按最低认定原则暂不认定。`
        : `本轮未在被害资金池之后命中该嫌疑人的可认定出账。若前序嫌疑人已经形成认定，前序资金池会封段清零，后续入账重新累计。`,
    });
  };
  suspectNames.forEach((name) => addConfigured(name, ''));
  suspectCards.forEach((card) => addConfigured('', card));
  return configured;
}

function isKnownSuspect(keys: Set<string>, card: string | null | undefined, name: string | null | undefined): boolean {
  const normalizedCard = normalizePartyText(card);
  const normalizedName = normalizePartyText(name);
  return Boolean(
    (normalizedCard && keys.has(`card:${normalizedCard}`))
    || (normalizedName && keys.has(`name:${normalizedName}`)),
  );
}

function appendUniqueInputValue(value: string, nextItem: string): string {
  const normalized = normalizePartyText(nextItem);
  if (!normalized) {
    return value;
  }
  const items = splitInput(value);
  if (!items.includes(normalized)) {
    items.push(normalized);
  }
  return joinInput(items);
}

function resolvePartyId(accountId: string, card: string, name: string, fallback: string): string {
  const key = accountId || card || name || fallback;
  return `audit-party:${key}`;
}

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isReasoningCalcNode(node: AuditVisualNode): boolean {
  return node.id.startsWith('reason-calc:');
}

function nodeTradeTimeText(node: AuditVisualNode): string {
  return isReasoningCalcNode(node) ? '不适用，当前节点是计算结果' : node.formula || '未记录';
}

function resolveTradeParty(trade: CaseAuditTrade, side: 'payer' | 'payee', index: number) {
  const accountId = normalizePartyText(side === 'payer' ? trade.payerAccountId : trade.payeeAccountId);
  const card = normalizePartyText(side === 'payer' ? trade.payerTradeCard : trade.payeeTradeCard);
  const name = normalizePartyText(side === 'payer' ? trade.payerAccountName : trade.payeeAccountName);
  const fallback = `${side}-${trade.id || trade.tradeRowId || index}`;
  return {
    id: resolvePartyId(accountId, card, name, fallback),
    label: name || card || '未知主体',
    card,
  };
}

function buildAuditEdgeLabel(trade: CaseAuditTrade, amount: number, confirmAmount: number): string {
  if (confirmAmount > 0) {
    return `${moneyText(amount)} / 认定 ${moneyText(confirmAmount)}`;
  }
  if (trade.flowStatus === 'balance_excluded') {
    return `${moneyText(amount)} / 可包含应排除`;
  }
  if (trade.flowStatus === 'confirmed_flow') {
    return `${moneyText(amount)} / 可标识流向`;
  }
  return moneyText(amount);
}

function rankAuditNode(node: AuditVisualNode): number {
  return node.tradeCount * 10_000 + Math.max(node.totalIn, node.totalOut);
}

function compareAuditNodes(left: AuditVisualNode, right: AuditVisualNode): number {
  const rankDelta = rankAuditNode(right) - rankAuditNode(left);
  if (rankDelta !== 0) {
    return rankDelta;
  }
  return left.label.localeCompare(right.label, 'zh-CN');
}

function reasoningStepEventRole(step: CaseAuditReasoningStep): AuditVisualRole {
  if (step.kind === 'victim_credit') {
    return 'victim';
  }
  if (step.kind === 'worst_case_offset' || step.kind === 'worst_case_clear') {
    return 'deduction';
  }
  return 'suspect';
}

function reasoningStepEventTitle(step: CaseAuditReasoningStep): string {
  if (step.kind === 'victim_credit') {
    return `${step.payerName || step.payerCard || '被害人'} -> ${step.payeeName || step.payeeCard || '中转账户'}`;
  }
  return `${step.payerName || step.payerCard || '中转账户'} -> ${step.payeeName || step.payeeCard || '收款人'}`;
}

function reasoningStepCalcRole(step: CaseAuditReasoningStep): AuditVisualRole {
  if (step.kind === 'worst_case_offset' || step.kind === 'worst_case_clear') {
    return 'deduction';
  }
  if (step.kind === 'suspect_recognition') {
    return 'recognition';
  }
  return 'pool';
}

function reasoningStepCalcTitle(step: CaseAuditReasoningStep): string {
  if (step.kind === 'victim_credit') {
    return '入账后资金池';
  }
  if (step.kind === 'worst_case_offset') {
    return '最坏结果扣减';
  }
  if (step.kind === 'worst_case_clear') {
    return '非嫌疑人转出清空';
  }
  if (step.kind === 'suspect_no_confirm') {
    return '本段暂无可认定金额';
  }
  return '最低金额认定';
}

function reasoningStepPrimaryAmount(step: CaseAuditReasoningStep, mode: 'event' | 'calc'): string {
  const amount = toMoneyNumber(step.amountNumber || step.amount);
  const poolAfter = toMoneyNumber(step.poolAfterNumber || step.poolAfter);
  const confirmAmount = toMoneyNumber(step.confirmAmountNumber || step.confirmAmount);
  if (mode === 'event') {
    return `${step.kind === 'victim_credit' ? '入账' : '出账'} ${moneyText(amount)}`;
  }
  if (step.kind === 'suspect_recognition') {
    return `最低可认定 ${moneyText(confirmAmount)}`;
  }
  if (step.kind === 'suspect_no_confirm') {
    return `本笔可认定 0.00`;
  }
  if (step.kind === 'worst_case_clear') {
    return `本段资金池清空`;
  }
  return `资金池 ${moneyText(poolAfter)}`;
}

function reasoningStepFormula(step: CaseAuditReasoningStep): string {
  const amount = toMoneyNumber(step.amountNumber || step.amount);
  const poolBefore = toMoneyNumber(step.poolBeforeNumber || step.poolBefore);
  const poolAfter = toMoneyNumber(step.poolAfterNumber || step.poolAfter);
  const balance = toMoneyNumber(step.payerTradeBalanceNumber || step.payerTradeBalance);
  const confirmAmount = toMoneyNumber(step.confirmAmountNumber || step.confirmAmount);
  if (step.kind === 'victim_credit') {
    return `${moneyText(poolBefore)} + ${moneyText(amount)} = ${moneyText(poolAfter)}`;
  }
  if (step.kind === 'source_carryover') {
    return `上一层认定带入 ${moneyText(amount)}`;
  }
  if (step.kind === 'worst_case_clear') {
    return `${moneyText(poolBefore)} - 转出 ${moneyText(amount)} <= 0`;
  }
  if (step.kind === 'worst_case_offset') {
    return `${moneyText(poolBefore)} - 转出 ${moneyText(amount)} = ${moneyText(poolAfter)}`;
  }
  if (step.kind === 'suspect_no_confirm') {
    const payerName = step.payerName || step.payerCard || '中转账号';
    return `${moneyText(poolBefore)} - ${payerName}转出后余额 ${moneyText(balance)} <= 0`;
  }
  const payerName = step.payerName || step.payerCard || '中转账号';
  return `${moneyText(poolBefore)} - ${payerName}转出后余额 ${moneyText(balance)} = ${moneyText(confirmAmount)}`;
}

function buildReasoningVisualGraph(result: CaseAuditResult, knownSuspectKeys: Set<string>): AuditVisualGraph | null {
  const reasoningSteps = result.reasoningSteps ?? [];
  const stepById = new Map(reasoningSteps.map((step) => [step.id, step]));
  const stepOrder = new Map(reasoningSteps.map((step, index) => [step.id, index]));
  const segments = result.suspectResults
    .map((item, index) => {
      const steps = (item.reasoningStepIds ?? [])
        .map((stepId) => stepById.get(stepId))
        .filter((step): step is CaseAuditReasoningStep => Boolean(step));
      return {
        id: `segment:${item.suspectCard || item.suspectName || index}`,
        suspectName: item.suspectName || '未知嫌疑人',
        suspectCard: item.suspectCard,
        confirmAmount: item.confirmAmount,
        outcomeLabel: `认定 ${item.suspectName || '未知嫌疑人'}`,
        steps,
      };
    })
    .filter((segment) => segment.steps.length > 0);

  if (segments.length === 0) {
    reasoningSteps
      .filter((step) => step.kind === 'suspect_recognition' && toMoneyNumber(step.confirmAmountNumber || step.confirmAmount) > 0)
      .forEach((step, index) => {
        const segmentStepIds = step.segmentStepIds ?? [step.id];
        const steps = segmentStepIds
          .map((stepId) => stepById.get(stepId))
          .filter((item): item is CaseAuditReasoningStep => Boolean(item));
        if (steps.length > 0) {
          segments.push({
            id: `segment:fallback:${step.id}:${index}`,
            suspectName: step.payeeName || '未知嫌疑人',
            suspectCard: step.payeeCard,
            confirmAmount: step.confirmAmount,
            outcomeLabel: `认定 ${step.payeeName || '未知嫌疑人'}`,
            steps,
          });
        }
      });
  }
  const existingSegmentStepKeys = new Set(
    segments.map((segment) => segment.steps.map((step) => step.id).join('|')),
  );
  reasoningSteps
    .filter((step) => step.kind === 'worst_case_clear')
    .forEach((step, index) => {
      const segmentStepIds = step.segmentStepIds ?? [step.id];
      const steps = segmentStepIds
        .map((stepId) => stepById.get(stepId))
        .filter((item): item is CaseAuditReasoningStep => Boolean(item));
      const key = steps.map((item) => item.id).join('|');
      if (steps.length > 0 && !existingSegmentStepKeys.has(key)) {
        existingSegmentStepKeys.add(key);
        segments.push({
          id: `segment:clear:${step.id}:${index}`,
          suspectName: step.payeeName || '扣减清空对象',
          suspectCard: step.payeeCard,
          confirmAmount: '0.00',
          outcomeLabel: `未认定 ${step.payeeName || step.payeeCard || '转出对象'}`,
          steps,
        });
      }
    });

  if (!segments.length) {
    return null;
  }

  const xStart = AUDIT_GRAPH_PADDING + AUDIT_NODE_WIDTH / 2;
  const victimX = xStart;
  const poolX = xStart + AUDIT_COLUMN_GAP;
  const outflowX = xStart + AUDIT_COLUMN_GAP * 2;
  const calcX = xStart + AUDIT_COLUMN_GAP * 3;
  const buildSegmentStages = (steps: CaseAuditReasoningStep[]) => {
    let pendingVictims: CaseAuditReasoningStep[] = [];
    const stages: Array<{
      id: string;
      victimSteps: CaseAuditReasoningStep[];
      outflowStep: CaseAuditReasoningStep;
      incomingTotal: number;
      poolBefore: number;
      poolAfter: number;
    }> = [];
    steps.forEach((step) => {
      if (step.kind === 'victim_credit' || step.kind === 'source_carryover') {
        pendingVictims.push(step);
        return;
      }
      const victimSteps = pendingVictims;
      stages.push({
        id: `stage:${step.id}`,
        victimSteps,
        outflowStep: step,
        incomingTotal: victimSteps.reduce(
          (sum, victimStep) => sum + toMoneyNumber(victimStep.amountNumber || victimStep.amount),
          0,
        ),
        poolBefore: toMoneyNumber(step.poolBeforeNumber || step.poolBefore),
        poolAfter: toMoneyNumber(step.poolAfterNumber || step.poolAfter),
      });
      pendingVictims = [];
    });
    return stages;
  };
  const groupLayouts = segments.map((segment) => {
    const victimSteps = segment.steps.filter((step) => step.kind === 'victim_credit' || step.kind === 'source_carryover');
    const outflowSteps = segment.steps.filter((step) => step.kind !== 'victim_credit' && step.kind !== 'source_carryover');
    const stages = buildSegmentStages(segment.steps);
    const accountCard = segment.steps.find((step) => step.accountCard)?.accountCard || 'unknown-account';
    const accountName = victimSteps.find((step) => step.payeeName)?.payeeName
      || outflowSteps.find((step) => step.payerName)?.payerName
      || segment.steps.find((step) => step.payeeCard === accountCard)?.payeeName
      || segment.steps.find((step) => step.payerCard === accountCard)?.payerName
      || '中转账号';
    const stageHeights = stages.map((stage) => Math.max(260, Math.max(stage.victimSteps.length, 1) * 172 + 88));
    return {
      id: segment.id,
      accountCard,
      accountName,
      suspectName: segment.suspectName,
      suspectCard: segment.suspectCard,
      confirmAmount: segment.confirmAmount,
      outcomeLabel: segment.outcomeLabel,
      steps: segment.steps,
      victimSteps,
      outflowSteps,
      stages,
      stageHeights,
      height: Math.max(420, stageHeights.reduce((sum, height) => sum + height, AUDIT_GRAPH_PADDING * 2)),
    };
  }).sort((left, right) => {
    const leftOrder = Math.min(...left.steps.map((step) => stepOrder.get(step.id) ?? Number.MAX_SAFE_INTEGER));
    const rightOrder = Math.min(...right.steps.map((step) => stepOrder.get(step.id) ?? Number.MAX_SAFE_INTEGER));
    return leftOrder - rightOrder;
  });
  const canvasHeight = Math.max(
    AUDIT_GRAPH_MIN_HEIGHT,
    groupLayouts.reduce((sum, group) => sum + group.height, AUDIT_GRAPH_PADDING),
  );
  const positionedNodes: AuditVisualGraph['nodes'] = [];
  const edges: AuditVisualGraph['edges'] = [];
  let groupTop = AUDIT_GRAPH_PADDING;

  groupLayouts.forEach((group, groupIndex) => {
    let stageTop = groupTop + AUDIT_GRAPH_PADDING;
    let previousCalcNodeId: string | null = null;
    let previousStage: (typeof group.stages)[number] | null = null;

    group.stages.forEach((stage, index) => {
      const step = stage.outflowStep;
      const stageHeight = group.stageHeights[index] ?? 300;
      const stageCenterY = stageTop + stageHeight / 2;
      const eventY = stageCenterY;
      const poolNodeId = `reason-pool:${group.id}:${group.accountCard}:${groupIndex}:${index}`;
      const eventNodeId = `reason-event:${step.id}`;
      const calcNodeId = `reason-calc:${step.id}`;
      const candidateName = normalizePartyText(step.payeeName);
      const candidateCard = normalizePartyText(step.payeeCard);
      const canPromoteSuspect = Boolean(candidateName || candidateCard)
        && step.kind !== 'victim_credit'
        && !isKnownSuspect(knownSuspectKeys, candidateCard, candidateName);
      const eventKind: AuditVisualEdgeKind = step.kind === 'worst_case_offset'
        ? 'pool-deduction'
        : step.kind === 'worst_case_clear'
          ? 'pool-deduction'
        : step.kind === 'suspect_recognition'
          ? 'suspect-outflow'
          : 'balance-deduction';
      const calcKind: AuditVisualEdgeKind = step.kind === 'suspect_recognition'
        ? 'recognition'
        : step.kind === 'worst_case_offset' || step.kind === 'worst_case_clear'
          ? 'pool-deduction'
          : 'balance-deduction';
      const sourceCarryoverStep = stage.victimSteps.find((item) => item.kind === 'source_carryover');
      const poolDetail = sourceCarryoverStep
        ? `上一层已认定金额带入本轮，作为继续追踪下级的待判断资金池`
        : stage.victimSteps.length > 0
          ? `${stage.victimSteps.length} 笔被害人被骗入账相加，形成待判断资金池`
          : `沿用上一段剩余待判断金额，继续作为资金池`;

      positionedNodes.push({
        id: poolNodeId,
        style: {
          x: poolX,
          y: stageCenterY,
        },
        data: {
          id: poolNodeId,
          label: group.accountName,
          card: group.accountCard,
          role: 'pool',
          totalIn: stage.poolBefore,
          totalOut: stage.poolAfter,
          tradeCount: stage.victimSteps.length,
          incomingCredit: stage.victimSteps.length > 0,
          outgoingDebit: true,
          suspectHit: step.kind === 'suspect_recognition',
          victimSource: false,
          subtitle: group.accountCard ? `中转账号 ${group.accountCard}` : '中转账号',
          primaryAmount: `被骗资金合计 ${moneyText(stage.poolBefore)}`,
          formula: sourceCarryoverStep
            ? `上一层认定带入 = ${moneyText(stage.poolBefore)}`
            : stage.victimSteps.length > 0
              ? `被骗资金相加 = ${moneyText(stage.poolBefore)}`
              : `剩余待判断金额 = ${moneyText(stage.poolBefore)}`,
          detail: poolDetail,
        },
      });

      if (previousCalcNodeId && previousStage) {
        edges.push({
          id: `reason-edge:${previousCalcNodeId}:${poolNodeId}`,
          source: previousCalcNodeId,
          target: poolNodeId,
          type: 'cubic-horizontal' as const,
          style: {
            sourcePort: 'out' as const,
            targetPort: 'in' as const,
          },
          data: {
            id: `reason-edge:${previousCalcNodeId}:${poolNodeId}`,
            source: previousCalcNodeId,
            target: poolNodeId,
            tradeId: step.tradeId,
            amount: moneyText(previousStage.poolAfter),
            amountNumber: previousStage.poolAfter,
            confirmAmount: '0.00',
            confirmAmountNumber: 0,
            kind: 'stage-carryover',
            label: `结转 ${moneyText(previousStage.poolAfter)}`,
            flowStatus: 'stage_carryover',
            flowStatusText: '上一段资金池余额结转到下一段',
            fileName: step.fileName,
          },
        });
      }

      const victimStartY = stageCenterY - ((stage.victimSteps.length - 1) * 172) / 2;
      stage.victimSteps.forEach((victimStep, victimIndex) => {
        const victimNodeId = `reason-event:${victimStep.id}`;
        const victimY = victimStartY + victimIndex * 172;
        positionedNodes.push({
          id: victimNodeId,
          style: {
            x: victimX,
            y: victimY,
          },
          data: {
            id: victimNodeId,
            label: victimStep.kind === 'source_carryover' ? '上一层认定金额' : reasoningStepEventTitle(victimStep),
            card: victimStep.payerCard || '',
            role: 'victim',
            totalIn: toMoneyNumber(victimStep.amountNumber || victimStep.amount),
            totalOut: 0,
            tradeCount: 1,
            incomingCredit: true,
            outgoingDebit: false,
            suspectHit: false,
            victimSource: true,
            subtitle: victimStep.kind === 'source_carryover' ? '上一层审计结果' : `流水 ${victimStep.serialNumber || victimStep.tradeId || victimIndex + 1}`,
            primaryAmount: victimStep.kind === 'source_carryover' ? `带入 ${moneyText(victimStep.amountNumber || victimStep.amount)}` : reasoningStepPrimaryAmount(victimStep, 'event'),
            formula: victimStep.tradeTime || '',
            detail: victimStep.kind === 'source_carryover'
              ? `上一层对${victimStep.payeeName || victimStep.payeeCard || group.accountCard}形成的认定金额，本轮继续追踪其下级转出`
              : `进入本段中转账号 ${victimStep.payeeName || victimStep.payeeCard || group.accountCard}`,
          },
        });
        edges.push({
          id: `reason-edge:${victimNodeId}:${poolNodeId}`,
          source: victimNodeId,
          target: poolNodeId,
          type: 'cubic-horizontal',
          style: {
            sourcePort: 'out',
            targetPort: 'in',
          },
          data: {
            id: `reason-edge:${victimNodeId}:${poolNodeId}`,
            source: victimNodeId,
            target: poolNodeId,
            tradeId: victimStep.tradeId,
            amount: victimStep.amount,
            amountNumber: toMoneyNumber(victimStep.amountNumber || victimStep.amount),
            confirmAmount: victimStep.confirmAmount,
            confirmAmountNumber: toMoneyNumber(victimStep.confirmAmountNumber || victimStep.confirmAmount),
            kind: victimStep.kind === 'source_carryover' ? 'stage-carryover' : 'victim-inflow',
            label: victimStep.kind === 'source_carryover' ? `带入 ${moneyText(victimStep.amountNumber || victimStep.amount)}` : `入账 ${moneyText(victimStep.amountNumber || victimStep.amount)}`,
            flowStatus: victimStep.kind,
            flowStatusText: victimStep.kind === 'source_carryover' ? '上一层认定金额带入本轮资金池' : `本段被害人入账，进入转出前资金池`,
            fileName: victimStep.fileName,
          },
        });
      });

      positionedNodes.push({
        id: eventNodeId,
        style: {
          x: outflowX,
          y: eventY,
        },
        data: {
          id: eventNodeId,
          label: reasoningStepEventTitle(step),
          card: step.payeeCard || step.accountCard,
          role: reasoningStepEventRole(step),
          totalIn: 0,
          totalOut: toMoneyNumber(step.amountNumber || step.amount),
          tradeCount: 1,
          incomingCredit: false,
          outgoingDebit: true,
          suspectHit: step.kind === 'suspect_recognition',
          victimSource: false,
          subtitle: `流水 ${step.serialNumber || step.tradeId || index + 1}`,
          primaryAmount: reasoningStepPrimaryAmount(step, 'event'),
          formula: step.tradeTime || '',
          detail: step.kind === 'worst_case_clear'
            ? `转给非嫌疑人，先扣减本段资金池`
            : `从本段中转账号 ${step.payerName || step.payerCard || group.accountCard} 转出`,
          candidateName,
          candidateCard,
          candidateSourceTradeId: step.tradeId,
          candidateSourceSerialNumber: step.serialNumber,
          candidateSourceAmount: step.amount,
          candidateReason: `${step.payerName || step.payerCard || '中转账号'}在第 ${index + 1} 段向${candidateName || candidateCard || '收款人'}转出 ${moneyText(step.amountNumber || step.amount)}`,
          canPromoteSuspect,
        },
      });
      positionedNodes.push({
        id: calcNodeId,
        style: {
          x: calcX,
          y: eventY,
        },
        data: {
          id: calcNodeId,
          label: reasoningStepCalcTitle(step),
          card: step.accountCard,
          role: reasoningStepCalcRole(step),
          totalIn: toMoneyNumber(step.poolAfterNumber || step.poolAfter),
          totalOut: toMoneyNumber(step.payerTradeBalanceNumber || step.payerTradeBalance),
          tradeCount: 1,
          incomingCredit: false,
          outgoingDebit: true,
          suspectHit: step.kind === 'suspect_recognition',
          victimSource: false,
          subtitle: step.kind === 'suspect_recognition' ? `${step.payeeName || '嫌疑人'}认定` : '本步计算',
          primaryAmount: reasoningStepPrimaryAmount(step, 'calc'),
          formula: reasoningStepFormula(step),
          detail: step.kind === 'suspect_recognition'
            ? `${step.payerName || step.payerCard || '中转账号'}向${step.payeeName || step.payeeCard || '嫌疑人'}转出 ${moneyText(step.amountNumber || step.amount)}；余额无法覆盖本段资金池，本段完成认定后封段，后续入账重新累计`
            : step.kind === 'suspect_no_confirm'
              ? toMoneyNumber(step.poolBeforeNumber || step.poolBefore) <= 0
                ? `本笔转出前，本段还没有累计被害人入账`
                : `转出后${step.payerName || step.payerCard || '中转账号'}账号余额仍覆盖本段被害人入账，本笔不认定`
              : step.kind === 'worst_case_clear'
                ? `转出金额大于本段资金池，按最坏结果扣完后本段归零`
                : `按最坏结果从资金池扣减，扣后资金池 ${moneyText(step.poolAfterNumber || step.poolAfter)}`,
        },
      });

      edges.push({
        id: `reason-edge:${poolNodeId}:${eventNodeId}`,
        source: poolNodeId,
        target: eventNodeId,
        type: 'cubic-horizontal' as const,
        style: {
          sourcePort: 'out' as const,
          targetPort: 'in' as const,
        },
        data: {
          id: `reason-edge:${poolNodeId}:${eventNodeId}`,
          source: poolNodeId,
          target: eventNodeId,
          tradeId: step.tradeId,
          amount: step.amount,
          amountNumber: toMoneyNumber(step.amountNumber || step.amount),
          confirmAmount: step.confirmAmount,
          confirmAmountNumber: toMoneyNumber(step.confirmAmountNumber || step.confirmAmount),
          kind: eventKind,
          label: `转出 ${moneyText(step.amountNumber || step.amount)}`,
          flowStatus: step.kind,
          flowStatusText: reasoningStepEventTitle(step),
          fileName: step.fileName,
        },
      });
      edges.push({
        id: `reason-edge:${eventNodeId}:${calcNodeId}`,
        source: eventNodeId,
        target: calcNodeId,
        type: 'cubic-horizontal' as const,
        style: {
          sourcePort: 'out' as const,
          targetPort: 'in' as const,
        },
        data: {
          id: `reason-edge:${eventNodeId}:${calcNodeId}`,
          source: eventNodeId,
          target: calcNodeId,
          tradeId: step.tradeId,
          amount: step.amount,
          amountNumber: toMoneyNumber(step.amountNumber || step.amount),
          confirmAmount: step.confirmAmount,
          confirmAmountNumber: toMoneyNumber(step.confirmAmountNumber || step.confirmAmount),
          kind: calcKind,
          label: step.kind === 'suspect_recognition'
            ? `认定 ${moneyText(step.confirmAmountNumber || step.confirmAmount)}`
            : step.kind === 'suspect_no_confirm'
              ? '暂不认定'
              : step.kind === 'worst_case_clear'
                ? '扣清本段'
                : step.kind === 'worst_case_offset'
                ? `扣减 ${moneyText(step.amountNumber || step.amount)}`
                : `累计 ${moneyText(step.amountNumber || step.amount)}`,
          flowStatus: step.kind,
          flowStatusText: reasoningStepCalcTitle(step),
          fileName: step.fileName,
        },
      });
      previousCalcNodeId = calcNodeId;
      previousStage = stage;
      stageTop += stageHeight;
    });

    groupTop += group.height;
  });

  return {
    nodes: positionedNodes,
    edges,
    counts: {
      victim: segments.reduce((count, segment) => count + segment.steps.filter((step) => step.kind === 'victim_credit' || step.kind === 'source_carryover').length, 0),
      transfer: segments.reduce(
        (count, segment) => count + segment.steps.filter((step) => step.kind === 'worst_case_offset' || step.kind === 'worst_case_clear' || step.kind === 'suspect_no_confirm').length,
        0,
      ),
      suspect: segments.reduce((count, segment) => count + segment.steps.filter((step) => step.kind === 'suspect_recognition').length, 0),
    },
  };
}

function buildAuditVisualGraph(result: CaseAuditResult | null, knownSuspectKeys: Set<string> = new Set()): AuditVisualGraph | null {
  if (!result) {
    return null;
  }

  const reasoningGraph = buildReasoningVisualGraph(result, knownSuspectKeys);
  if (reasoningGraph) {
    return reasoningGraph;
  }

  const nodeMap = new Map<string, AuditVisualNode>();
  const ensureNode = (party: ReturnType<typeof resolveTradeParty>): AuditVisualNode => {
    const existing = nodeMap.get(party.id);
    if (existing) {
      if (!existing.card && party.card) {
        existing.card = party.card;
      }
      if (existing.label === '未知主体' && party.label !== '未知主体') {
        existing.label = party.label;
      }
      return existing;
    }
    const created: AuditVisualNode = {
      id: party.id,
      label: party.label,
      card: party.card,
      role: 'transfer',
      totalIn: 0,
      totalOut: 0,
      tradeCount: 0,
      incomingCredit: false,
      outgoingDebit: false,
      suspectHit: false,
      victimSource: false,
    };
    nodeMap.set(party.id, created);
    return created;
  };

  const visualEdges: AuditVisualEdge[] = [];

  result.trades.forEach((trade, index) => {
    const payer = resolveTradeParty(trade, 'payer', index);
    const payee = resolveTradeParty(trade, 'payee', index);
    const payerNode = ensureNode(payer);
    const payeeNode = ensureNode(payee);
    const amount = toMoneyNumber(trade.tradeAmountNumber || trade.tradeAmount);
    const confirmAmount = toMoneyNumber(trade.confirmAmountNumber || trade.confirmAmount);
    const caseAmount = toMoneyNumber(trade.caseAmountNumber || trade.caseAmount);
    const direction = normalizePartyText(trade.jdFlag);
    const isCredit = direction === '贷';
    const isDebit = direction === '借';

    payerNode.totalOut += amount;
    payerNode.tradeCount += 1;
    payeeNode.totalIn += amount;
    payeeNode.tradeCount += 1;

    if (isCredit) {
      payerNode.victimSource = true;
      payeeNode.incomingCredit = true;
    }
    if (isDebit) {
      payerNode.outgoingDebit = true;
      if (confirmAmount > 0 || caseAmount > 0) {
        payeeNode.suspectHit = true;
      }
    }

    const kind: AuditVisualEdgeKind = isCredit
      ? trade.flowStatus === 'balance_excluded'
        ? 'balance-excluded-inflow'
        : 'victim-inflow'
      : isDebit
        ? 'suspect-outflow'
        : 'trade';
    visualEdges.push({
      id: `audit-edge:${trade.id || trade.tradeRowId || index}:${trade.relationId || 'main'}:${index}`,
      source: payer.id,
      target: payee.id,
      tradeId: trade.id || trade.tradeRowId,
      amount: trade.tradeAmount,
      amountNumber: amount,
      confirmAmount: trade.confirmAmount,
      confirmAmountNumber: confirmAmount,
      kind,
      label: buildAuditEdgeLabel(trade, amount, confirmAmount),
      flowStatus: trade.flowStatus || '',
      flowStatusText: auditFlowStatusText(trade),
      fileName: trade.fileName || trade.fileId,
    });
  });

  const visualNodes = Array.from(nodeMap.values()).map((node) => {
    if (node.suspectHit) {
      node.role = 'suspect';
    } else if (node.victimSource && !node.incomingCredit && !node.outgoingDebit) {
      node.role = 'victim';
    } else {
      node.role = 'transfer';
    }
    return node;
  });

  const columns: Record<AuditVisualRole, AuditVisualNode[]> = {
    victim: [],
    transfer: [],
    suspect: [],
  };
  visualNodes.forEach((node) => {
    columns[node.role].push(node);
  });
  columns.victim.sort(compareAuditNodes);
  columns.transfer.sort(compareAuditNodes);
  columns.suspect.sort(compareAuditNodes);

  const orderedColumns: AuditVisualRole[] = ['victim', 'transfer', 'suspect'];
  const maxRows = Math.max(1, ...orderedColumns.map((role) => columns[role].length));
  const canvasHeight = Math.max(AUDIT_GRAPH_MIN_HEIGHT, maxRows * AUDIT_ROW_GAP + AUDIT_GRAPH_PADDING * 2);
  const xStart = AUDIT_GRAPH_PADDING + AUDIT_NODE_WIDTH / 2;
  const positionedNodes = orderedColumns.flatMap((role, columnIndex) => {
    const items = columns[role];
    const startY = canvasHeight / 2 - ((items.length - 1) * AUDIT_ROW_GAP) / 2;
    return items.map((node, rowIndex) => ({
      id: node.id,
      style: {
        x: xStart + columnIndex * AUDIT_COLUMN_GAP,
        y: startY + rowIndex * AUDIT_ROW_GAP,
      },
      data: node,
    }));
  });

  return {
    nodes: positionedNodes,
    edges: visualEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'cubic-horizontal',
      style: {
        sourcePort: 'out',
        targetPort: 'in',
      },
      data: edge,
    })),
    counts: {
      victim: columns.victim.length,
      transfer: columns.transfer.length,
      suspect: columns.suspect.length,
    },
  };
}

function auditNodeCountText(node: AuditVisualNode): string {
  if (node.role === 'pool') {
    return `${node.tradeCount}笔入账`;
  }
  if (node.role === 'recognition') {
    return '认定结果';
  }
  return node.subtitle || `${node.tradeCount}笔流水`;
}

function renderAuditNodeShell(node: AuditVisualNode, body: string): string {
  return `
    <div class="case-audit-g6-node case-audit-g6-node--${node.role}${node.canPromoteSuspect ? ' case-audit-g6-node--candidate' : ''}">
      <div class="case-audit-g6-node-topline">
        <span class="case-audit-g6-node-role">${escapeHtml(roleLabel(node.role))}</span>
        <span class="case-audit-g6-node-count">${escapeHtml(auditNodeCountText(node))}</span>
      </div>
      ${body}
    </div>
  `;
}

function renderAuditNodeMarkup(node: AuditVisualNode): string {
  if (node.role === 'pool') {
    return renderAuditNodeShell(node, `
      <div class="case-audit-g6-node-title" title="${escapeHtml(node.label)}">${escapeHtml(node.label)}</div>
      <div class="case-audit-g6-node-card" title="${escapeHtml(node.card)}">${escapeHtml(node.subtitle || `中转账号 ${node.card || '未记录'}`)}</div>
      <div class="case-audit-g6-node-primary">${escapeHtml(node.primaryAmount || `被骗资金合计 ${moneyText(node.totalIn)}`)}</div>
      ${node.formula ? `<div class="case-audit-g6-node-formula" title="${escapeHtml(node.formula)}">${escapeHtml(node.formula)}</div>` : ''}
      ${node.detail ? `<div class="case-audit-g6-node-detail" title="${escapeHtml(node.detail)}">${escapeHtml(node.detail)}</div>` : ''}
    `);
  }

  if (node.role === 'victim') {
    return renderAuditNodeShell(node, `
      <div class="case-audit-g6-node-title" title="${escapeHtml(node.label)}">${escapeHtml(node.label)}</div>
      <div class="case-audit-g6-node-primary">${escapeHtml(node.primaryAmount || `入账 ${moneyText(node.totalIn)}`)}</div>
      ${node.formula ? `<div class="case-audit-g6-node-card" title="${escapeHtml(node.formula)}">${escapeHtml(node.formula)}</div>` : ''}
      ${node.detail ? `<div class="case-audit-g6-node-detail" title="${escapeHtml(node.detail)}">${escapeHtml(node.detail)}</div>` : ''}
    `);
  }

  if (node.role === 'suspect' || node.role === 'deduction') {
    return renderAuditNodeShell(node, `
      <div class="case-audit-g6-node-title" title="${escapeHtml(node.label)}">${escapeHtml(node.label)}</div>
      <div class="case-audit-g6-node-primary">${escapeHtml(node.primaryAmount || `出账 ${moneyText(node.totalOut)}`)}</div>
      ${node.formula ? `<div class="case-audit-g6-node-card" title="${escapeHtml(node.formula)}">${escapeHtml(node.formula)}</div>` : ''}
      ${node.detail ? `<div class="case-audit-g6-node-detail" title="${escapeHtml(node.detail)}">${escapeHtml(node.detail)}</div>` : ''}
    `);
  }

  if (node.role === 'recognition') {
    return renderAuditNodeShell(node, `
      <div class="case-audit-g6-node-title" title="${escapeHtml(node.label)}">${escapeHtml(node.label)}</div>
      <div class="case-audit-g6-node-card" title="${escapeHtml(node.subtitle || node.card)}">${escapeHtml(node.subtitle || node.card || '认定对象')}</div>
      <div class="case-audit-g6-node-primary">${escapeHtml(node.primaryAmount || `可认定 ${moneyText(node.totalIn)}`)}</div>
      ${node.formula ? `<div class="case-audit-g6-node-formula" title="${escapeHtml(node.formula)}">${escapeHtml(node.formula)}</div>` : ''}
      ${node.detail ? `<div class="case-audit-g6-node-detail" title="${escapeHtml(node.detail)}">${escapeHtml(node.detail)}</div>` : ''}
    `);
  }

  return renderAuditNodeShell(node, `
    <div class="case-audit-g6-node-title" title="${escapeHtml(node.label)}">${escapeHtml(node.label)}</div>
    <div class="case-audit-g6-node-card" title="${escapeHtml(node.card)}">${escapeHtml(node.subtitle || `账号 ${node.card || '未记录'}`)}</div>
    <div class="case-audit-g6-node-amounts">
      <span>入账 ${escapeHtml(moneyText(node.totalIn))}</span>
      <span>出账 ${escapeHtml(moneyText(node.totalOut))}</span>
    </div>
    ${node.detail ? `<div class="case-audit-g6-node-detail" title="${escapeHtml(node.detail)}">${escapeHtml(node.detail)}</div>` : ''}
  `);
}

function auditTooltipRows(node: AuditVisualNode): Array<[string, string]> {
  if (node.role === 'pool' && isReasoningCalcNode(node)) {
    return [
      ['节点含义', auditNodeMeaning(node)],
      ['计算步骤', node.subtitle || '本步计算'],
      ['处理结果', node.label],
      ['本步认定', node.primaryAmount || '本笔可认定 0.00'],
      ['计算式', node.formula || '未记录'],
      ['处理规则', node.detail || '余额仍可覆盖本段资金池，本笔暂不认定'],
    ];
  }

  if (node.role === 'pool') {
    return [
      ['节点含义', auditNodeMeaning(node)],
      ['中转账号', node.card || '未记录'],
      ['入账笔数', `${node.tradeCount} 笔`],
      ['资金池金额', node.primaryAmount || `被骗资金合计 ${moneyText(node.totalIn)}`],
      ['计算式', node.formula || `被骗资金相加 = ${moneyText(node.totalIn)}`],
      ['说明', node.detail || '被害人被骗入账相加，形成待判断资金池'],
    ];
  }

  if (node.role === 'victim') {
    return [
      ['节点含义', auditNodeMeaning(node)],
      ['流水', node.subtitle || '未记录'],
      ['被害人转入', node.label],
      ['入账金额', node.primaryAmount || moneyText(node.totalIn)],
      ['交易时间', nodeTradeTimeText(node)],
      ['进入账号', node.detail || '进入本段中转账号'],
    ];
  }

  if (node.role === 'suspect') {
    const rows: Array<[string, string]> = [
      ['节点含义', auditNodeMeaning(node)],
      ['流水', node.subtitle || '未记录'],
      ['转出关系', node.label],
      ['出账金额', node.primaryAmount || moneyText(node.totalOut)],
      ['交易时间', nodeTradeTimeText(node)],
      ['判断依据', node.detail || '结合转出后余额判断是否形成认定'],
    ];
    if (node.canPromoteSuspect) {
      rows.push(['可操作', '点击节点后，可将该收款人认定为嫌疑人并重新审计']);
    }
    return rows;
  }

  if (node.role === 'deduction') {
    if (isReasoningCalcNode(node)) {
      return [
        ['节点含义', auditNodeMeaning(node)],
        ['计算步骤', node.subtitle || '本步计算'],
        ['处理结果', node.label],
        ['扣减结果', node.primaryAmount || `资金池 ${moneyText(node.totalIn)}`],
        ['计算式', node.formula || '未记录'],
        ['处理规则', node.detail || '按最保守口径从待判断资金中扣减'],
      ];
    }
    return [
      ['节点含义', auditNodeMeaning(node)],
      ['流水', node.subtitle || '未记录'],
      ['转出关系', node.label],
      ['扣减金额', node.primaryAmount || moneyText(node.totalOut)],
      ['交易时间', nodeTradeTimeText(node)],
      ['处理规则', node.detail || '按最保守口径从待判断资金中扣减'],
    ];
  }

  if (node.role === 'recognition') {
    return [
      ['节点含义', auditNodeMeaning(node)],
      ['认定对象', node.subtitle || node.label],
      ['最低认定', node.primaryAmount || moneyText(node.totalIn)],
      ['计算式', node.formula || '未记录'],
      ['认定说明', node.detail || '形成最低可认定金额后，本段封段，后续入账重新累计'],
    ];
  }

  return [
    ['节点含义', auditNodeMeaning(node)],
    ['主体', node.label],
    ['账号', node.card || '未记录'],
    ['入账/出账', `入账 ${moneyText(node.totalIn)} / 出账 ${moneyText(node.totalOut)}`],
  ];
}

function renderAuditTooltipContent(node: AuditVisualNode | null | undefined): string {
  if (!node) {
    return '<div class="case-audit-g6-official-tooltip">暂无节点信息</div>';
  }
  const detailRows = auditTooltipRows(node);

  return `
    <div class="case-audit-g6-official-tooltip">
      <div class="case-audit-g6-official-tooltip-title">
        <strong>${escapeHtml(node.label)}</strong>
        <span>${escapeHtml(roleLabel(node.role))} / ${escapeHtml(auditNodeCountText(node))}</span>
      </div>
      ${detailRows.map(([label, value]) => `
        <div class="case-audit-g6-tooltip-row">
          <span>${escapeHtml(label)}</span>
          <b>${escapeHtml(value)}</b>
        </div>
      `).join('')}
    </div>
  `;
}

function CaseAuditFlowChart({
  result,
  knownSuspectKeys,
  onCandidateSelect,
}: {
  result: CaseAuditResult | null;
  knownSuspectKeys: Set<string>;
  onCandidateSelect: (candidate: CaseAuditCandidateSuspect) => void;
}) {
  const graphHostRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<G6Graph | null>(null);
  const renderCycleRef = useRef(0);
  const onCandidateSelectRef = useRef(onCandidateSelect);
  const [graphReadyNonce, setGraphReadyNonce] = useState(0);
  const visualGraph = useMemo(() => buildAuditVisualGraph(result, knownSuspectKeys), [knownSuspectKeys, result]);
  const hasGraphData = Boolean(visualGraph?.nodes.length);

  useEffect(() => {
    onCandidateSelectRef.current = onCandidateSelect;
  }, [onCandidateSelect]);

  useEffect(() => {
    if (!hasGraphData || !graphHostRef.current || graphRef.current) {
      return undefined;
    }

    let disposed = false;
    let createdGraph: G6Graph | null = null;
    let resizeObserver: ResizeObserver | null = null;

    void import('@antv/g6').then(({ Graph, NodeEvent }) => {
      const graphHost = graphHostRef.current;
      if (!graphHost || disposed) {
        return;
      }
      const width = graphHost.clientWidth || 960;
      const height = graphHost.clientHeight || 560;
      const graph = new Graph({
        container: graphHost,
        width,
        height,
        animation: false,
        padding: [24, 28, 24, 28],
        data: { nodes: [], edges: [] },
        node: {
          type: 'html',
          style: {
            size: [AUDIT_NODE_WIDTH, AUDIT_NODE_HEIGHT],
            dx: -AUDIT_NODE_WIDTH / 2,
            dy: -AUDIT_NODE_HEIGHT / 2,
            port: true,
            ports: AUDIT_NODE_PORTS,
            innerHTML: (datum: any) => renderAuditNodeMarkup(datum.data as AuditVisualNode),
          },
        },
        edge: {
          type: 'cubic-horizontal',
          style: {
            stroke: (datum: any) => {
              if (datum?.data?.kind === 'victim-inflow' || datum?.data?.kind === 'pool-increase') {
                return '#12806a';
              }
              if (datum?.data?.kind === 'balance-excluded-inflow') {
                return '#64748b';
              }
              if (datum?.data?.kind === 'stage-carryover') {
                return '#64748b';
              }
              if (datum?.data?.kind === 'pool-deduction' || datum?.data?.kind === 'balance-deduction') {
                return '#b45309';
              }
              if (datum?.data?.kind === 'recognition') {
                return '#2563eb';
              }
              return '#4f6fd8';
            },
            lineWidth: (datum: any) => {
              const amount = Number(datum?.data?.amountNumber ?? 0);
              if (!Number.isFinite(amount) || amount <= 0) {
                return 2.2;
              }
              return Math.max(2.2, Math.min(5.2, Math.log10(amount + 10) * 1.12));
            },
            lineDash: (datum: any) => (
              datum?.data?.kind === 'balance-excluded-inflow'
              || datum?.data?.kind === 'balance-deduction'
              || datum?.data?.kind === 'stage-carryover' ? [7, 7] : []
            ),
            opacity: (datum: any) => (
              datum?.data?.kind === 'balance-excluded-inflow' || datum?.data?.kind === 'stage-carryover' ? 0.58 : 0.9
            ),
            endArrow: true,
            endArrowType: 'vee',
            endArrowSize: 9,
            labelText: (datum: any) => String(datum?.data?.label ?? ''),
            labelPlacement: 'center',
            labelAutoRotate: false,
            labelFontSize: 12,
            labelFontWeight: 800,
            labelFill: (datum: any) => (
              datum?.data?.kind === 'balance-excluded-inflow' || datum?.data?.kind === 'stage-carryover' ? '#475569' : '#111827'
            ),
            labelBackground: true,
            labelBackgroundFill: (datum: any) => (
              datum?.data?.kind === 'balance-excluded-inflow' || datum?.data?.kind === 'stage-carryover' ? '#f8fafc' : '#ffffff'
            ),
            labelBackgroundOpacity: 0.96,
            labelBackgroundRadius: 4,
            labelBackgroundPadding: [2, 6, 2, 6],
          },
        },
        plugins: [
          {
            type: 'tooltip',
            key: 'case-audit-node-tooltip',
            enable: (event: any) => event?.targetType === 'node',
            getContent: (event: any, items: Array<{ data?: AuditVisualNode }>) => {
              const nodeId = event?.target?.id;
              const nodeDatum = nodeId ? graph.getNodeData(nodeId) : null;
              return renderAuditTooltipContent((nodeDatum?.data as AuditVisualNode | undefined) || items?.[0]?.data);
            },
          },
        ],
        behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
      });

      graphRef.current = graph;
      createdGraph = graph;
      graph.on(NodeEvent.CLICK, (event: any) => {
        const nodeId = event?.target?.id;
        if (!nodeId) {
          return;
        }
        const nodeDatum = graph.getNodeData(nodeId);
        const nodeData = nodeDatum?.data as AuditVisualNode | undefined;
        if (!nodeData?.canPromoteSuspect) {
          return;
        }
        onCandidateSelectRef.current({
          name: nodeData.candidateName || '',
          card: nodeData.candidateCard || '',
          sourceTradeId: nodeData.candidateSourceTradeId || '',
          sourceSerialNumber: nodeData.candidateSourceSerialNumber || '',
          sourceAmount: nodeData.candidateSourceAmount || '',
          reason: nodeData.candidateReason || `将 ${nodeData.candidateName || nodeData.candidateCard || '收款人'} 加入嫌疑人条件`,
        });
      });
      setGraphReadyNonce((value) => value + 1);

      resizeObserver = new ResizeObserver(() => {
        if (!graphHostRef.current || !graphRef.current) {
          return;
        }
        const nextWidth = graphHostRef.current.clientWidth || 960;
        const nextHeight = graphHostRef.current.clientHeight || 560;
        graphRef.current.resize(nextWidth, nextHeight);
        if (visualGraph?.nodes.length && visualGraph.nodes.length <= 16) {
          void graphRef.current.fitView({ when: 'always', direction: 'both' });
        }
      });
      resizeObserver.observe(graphHost);
    });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      createdGraph?.destroy();
      graphRef.current = null;
      renderCycleRef.current += 1;
    };
  }, [hasGraphData, visualGraph?.nodes.length]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !visualGraph || !hasGraphData) {
      return;
    }
    const currentRenderCycle = renderCycleRef.current + 1;
    renderCycleRef.current = currentRenderCycle;
    graph.setData({
      nodes: visualGraph.nodes,
      edges: visualGraph.edges,
    });
    void graph.render()
      .then(async () => {
        if (renderCycleRef.current !== currentRenderCycle || graphRef.current !== graph) {
          return;
        }
        if (visualGraph.nodes.length <= 16) {
          await graph.fitView({ when: 'always', direction: 'both' }, false);
        }
      })
      .catch(() => {
        if (renderCycleRef.current === currentRenderCycle) {
          renderCycleRef.current += 1;
        }
      });
  }, [graphReadyNonce, hasGraphData, visualGraph]);

  if (!result) {
    return (
      <div className="case-audit-empty-graph">
        <Scale size={24} />
        <span>执行审计后生成资金关系与金额认定推导图</span>
      </div>
    );
  }

  if (!visualGraph || visualGraph.nodes.length === 0) {
    return (
      <div className="case-audit-empty-graph">
        <AlertCircle size={24} />
        <span>当前条件未形成可认定金额，请检查被害人条件、嫌疑人条件和转出后余额字段。</span>
      </div>
    );
  }

  return (
    <div className="case-audit-g6-shell">
      <div ref={graphHostRef} className="case-audit-g6-canvas" role="img" aria-label="涉诈资金审计金额认定推导图" />
    </div>
  );
}

export function CaseAuditPage({ token, onBack, navigationSlot }: CaseAuditPageProps) {
  const casePickerRef = useRef<HTMLDivElement | null>(null);
  const [cases, setCases] = useState<CaseAuditCaseOption[]>([]);
  const [caseId, setCaseId] = useState('');
  const [casePickerOpen, setCasePickerOpen] = useState(false);
  const [casesLoading, setCasesLoading] = useState(true);
  const [overview, setOverview] = useState<CaseAuditOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [auditFiles, setAuditFiles] = useState<CaseAuditFile[]>([]);
  const [auditFilesLoading, setAuditFilesLoading] = useState(false);
  const [auditId, setAuditId] = useState('');
  const [auditName, setAuditName] = useState('涉诈资金审计');
  const [auditSaving, setAuditSaving] = useState(false);
  const [auditSaveMessage, setAuditSaveMessage] = useState('');
  const [victimCards, setVictimCards] = useState('');
  const [victimNames, setVictimNames] = useState('');
  const [suspectCards, setSuspectCards] = useState('');
  const [suspectNames, setSuspectNames] = useState('');
  const [sourceMode, setSourceMode] = useState<'' | 'recognized'>('');
  const [sourceAccountCards, setSourceAccountCards] = useState('');
  const [sourceAccountNames, setSourceAccountNames] = useState('');
  const [sourceAmount, setSourceAmount] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [sourceFromAuditId, setSourceFromAuditId] = useState('');
  const [sourceLayerIndex, setSourceLayerIndex] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [result, setResult] = useState<CaseAuditResult | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [auditPanelOpen, setAuditPanelOpen] = useState(false);
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [candidateSuspect, setCandidateSuspect] = useState<CaseAuditCandidateSuspect | null>(null);

  const applyAuditFile = useCallback((auditFile: CaseAuditFile | null) => {
    setCandidateSuspect(null);
    if (!auditFile) {
      setAuditId('');
      setAuditName('涉诈资金审计');
      setVictimCards('');
      setVictimNames('');
      setSuspectCards('');
      setSuspectNames('');
      setSourceMode('');
      setSourceAccountCards('');
      setSourceAccountNames('');
      setSourceAmount('');
      setSourceLabel('');
      setSourceFromAuditId('');
      setSourceLayerIndex('');
      setStartTime('');
      setEndTime('');
      setMinAmount('');
      setMaxAmount('');
      return;
    }
    setAuditId(auditFile.auditId);
    setAuditName(auditFile.auditName || '涉诈资金审计');
    setVictimCards(joinInput(auditFile.conditions?.victimCards));
    setVictimNames(joinInput(auditFile.conditions?.victimNames));
    setSuspectCards(joinInput(auditFile.conditions?.suspectCards));
    setSuspectNames(joinInput(auditFile.conditions?.suspectNames));
    setSourceMode(auditFile.conditions?.sourceMode === 'recognized' ? 'recognized' : '');
    setSourceAccountCards(joinInput(auditFile.conditions?.sourceAccountCards));
    setSourceAccountNames(joinInput(auditFile.conditions?.sourceAccountNames));
    setSourceAmount(auditFile.conditions?.sourceAmount || '');
    setSourceLabel(auditFile.conditions?.sourceLabel || '');
    setSourceFromAuditId(auditFile.conditions?.sourceFromAuditId || '');
    setSourceLayerIndex(auditFile.conditions?.sourceLayerIndex || '');
    setStartTime(toDateTimeInputValue(auditFile.filters?.startTime));
    setEndTime(toDateTimeInputValue(auditFile.filters?.endTime));
    setMinAmount(auditFile.filters?.minAmount || '');
    setMaxAmount(auditFile.filters?.maxAmount || '');
  }, []);

  const buildCurrentConditions = useCallback((): CaseAuditConditions => ({
    victimCards: splitInput(victimCards),
    victimNames: splitInput(victimNames),
    suspectCards: splitInput(suspectCards),
    suspectNames: splitInput(suspectNames),
    sourceMode,
    sourceAccountCards: splitInput(sourceAccountCards),
    sourceAccountNames: splitInput(sourceAccountNames),
    sourceAmount: sourceAmount.trim(),
    sourceLabel: sourceLabel.trim(),
    sourceFromAuditId: sourceFromAuditId.trim(),
    sourceLayerIndex: sourceLayerIndex.trim(),
  }), [sourceAccountCards, sourceAccountNames, sourceAmount, sourceFromAuditId, sourceLabel, sourceLayerIndex, sourceMode, suspectCards, suspectNames, victimCards, victimNames]);

  const buildCurrentFilters = useCallback((): CaseAuditFilters => ({
    startTime,
    endTime,
    minAmount: minAmount.trim(),
    maxAmount: maxAmount.trim(),
  }), [endTime, maxAmount, minAmount, startTime]);

  const updateAuditFileState = useCallback((updated: CaseAuditFile) => {
    setAuditFiles((items) => {
      const withoutUpdated = items.filter((item) => item.auditId !== updated.auditId);
      return [updated, ...withoutUpdated];
    });
    setAuditId(updated.auditId);
    setAuditName(updated.auditName || '涉诈资金审计');
  }, []);

  useEffect(() => {
    if (!casePickerOpen) {
      return undefined;
    }
    const closePicker = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && casePickerRef.current?.contains(target)) {
        return;
      }
      setCasePickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCasePickerOpen(false);
      }
    };
    document.addEventListener('pointerdown', closePicker);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closePicker);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [casePickerOpen]);

  useEffect(() => {
    let cancelled = false;
    setCasesLoading(true);
    loadCaseAuditCases(token)
      .then((items) => {
        if (cancelled) {
          return;
        }
        setCases(items);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '加载审计案件失败');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCasesLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!caseId) {
      setOverview(null);
      return;
    }
    let cancelled = false;
    setOverviewLoading(true);
    loadCaseAuditOverview(caseId, token)
      .then((nextOverview) => {
        if (!cancelled) {
          setOverview(nextOverview);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setOverview(null);
          setError(loadError instanceof Error ? loadError.message : '加载案件审计概览失败');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setOverviewLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, token]);

  useEffect(() => {
    if (!caseId) {
      setAuditFiles([]);
      applyAuditFile(null);
      return;
    }
    let cancelled = false;
    setAuditFilesLoading(true);
    setAuditSaveMessage('');
    loadCaseAuditFiles(caseId, token)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        const items = Array.isArray(payload.items) ? payload.items : [];
      setAuditFiles(items);
      const active = items.find((item) => item.auditId === payload.activeAuditId) ?? items[0] ?? null;
      applyAuditFile(active);
      setResult(null);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setAuditFiles([]);
          applyAuditFile(null);
          setError(loadError instanceof Error ? loadError.message : '加载审计档案失败');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuditFilesLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applyAuditFile, caseId, token]);

  const saveCurrentAudit = useCallback(async (options?: { quiet?: boolean }): Promise<CaseAuditFile | null> => {
    if (!caseId || !auditId) {
      return null;
    }
    setAuditSaving(true);
    if (!options?.quiet) {
      setAuditSaveMessage('');
    }
    try {
      const updated = await saveCaseAuditFile(
        auditId,
        {
          caseId,
          auditName,
          conditions: buildCurrentConditions(),
          filters: buildCurrentFilters(),
        },
        token,
      );
      updateAuditFileState(updated);
      if (!options?.quiet) {
        setAuditSaveMessage('已保存');
      }
      return updated;
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : '保存审计档案失败';
      setError(message);
      if (!options?.quiet) {
        setAuditSaveMessage('保存失败');
      }
      return null;
    } finally {
      setAuditSaving(false);
    }
  }, [auditId, auditName, buildCurrentConditions, buildCurrentFilters, caseId, token, updateAuditFileState]);

  const createAudit = useCallback(async () => {
    if (!caseId || auditFilesLoading) {
      return;
    }
    setAuditFilesLoading(true);
    setAuditSaveMessage('');
    setError('');
    try {
      const created = await createCaseAuditFile(
        {
          caseId,
          auditName: '涉诈资金审计',
          conditions: emptyAuditConditions(),
          filters: emptyAuditFilters(),
        },
        token,
      );
      setAuditFiles((items) => [created, ...items]);
      applyAuditFile(created);
      setResult(null);
      setAuditSaveMessage('已新建审计档案');
    } catch (createError) {
      setError(createError instanceof Error ? caseAuditErrorText(createError.message) : '创建审计档案失败');
    } finally {
      setAuditFilesLoading(false);
    }
  }, [applyAuditFile, auditFilesLoading, caseId, token]);

  const selectAudit = useCallback((nextAuditId: string) => {
    const nextAudit = auditFiles.find((item) => item.auditId === nextAuditId) ?? null;
    applyAuditFile(nextAudit);
    setAuditSaveMessage('');
    setResult(null);
  }, [applyAuditFile, auditFiles]);

  const submitAudit = useCallback(async () => {
    if (!caseId || running) {
      return;
    }
    const conditions = buildCurrentConditions();
    const hasRecognizedSource = conditions.sourceMode === 'recognized'
      && Boolean(conditions.sourceAmount)
      && ((conditions.sourceAccountCards?.length ?? 0) + (conditions.sourceAccountNames?.length ?? 0) > 0);
    if (!hasRecognizedSource && conditions.victimCards.length + conditions.victimNames.length === 0) {
      setResult(null);
      setError('请先填写被害人账号或姓名，涉诈资金审计需要以被害人入账作为追踪起点。');
      return;
    }
    const filters = buildCurrentFilters();
    const payload: CaseAuditRunPayload = {
      caseId,
      auditId: auditId || undefined,
      victimCards: conditions.victimCards,
      victimNames: conditions.victimNames,
      suspectCards: conditions.suspectCards,
      suspectNames: conditions.suspectNames,
      sourceMode: conditions.sourceMode,
      sourceAccountCards: conditions.sourceAccountCards,
      sourceAccountNames: conditions.sourceAccountNames,
      sourceAmount: conditions.sourceAmount,
      sourceLabel: conditions.sourceLabel,
      sourceFromAuditId: conditions.sourceFromAuditId,
      sourceLayerIndex: conditions.sourceLayerIndex,
      startTime: normalizeDateTime(filters.startTime),
      endTime: normalizeDateTime(filters.endTime),
      minAmount: filters.minAmount || undefined,
      maxAmount: filters.maxAmount || undefined,
    };
    setRunning(true);
    setError('');
    try {
      if (auditId) {
        const saved = await saveCurrentAudit({ quiet: true });
        if (!saved) {
          return;
        }
      }
      const nextResult = await runCaseAudit(payload, token);
      setResult(nextResult);
      setAuditSaveMessage('已保存本次审计结果');
      if (auditId) {
        loadCaseAuditFiles(caseId, token)
          .then((payloadAfterRun) => {
            setAuditFiles(payloadAfterRun.items);
          })
          .catch(() => undefined);
      }
    } catch (runError) {
      setResult(null);
      setError(runError instanceof Error ? caseAuditErrorText(runError.message) : '执行涉诈资金审计失败');
    } finally {
      setRunning(false);
    }
  }, [auditId, buildCurrentConditions, buildCurrentFilters, caseId, running, saveCurrentAudit, token]);

  const promoteCandidateSuspect = useCallback(async () => {
    if (!candidateSuspect || !caseId || running) {
      return;
    }
    const nextSuspectCards = appendUniqueInputValue(suspectCards, candidateSuspect.card);
    const nextSuspectNames = appendUniqueInputValue(suspectNames, candidateSuspect.name);
    const conditions: CaseAuditConditions = {
      ...buildCurrentConditions(),
      suspectCards: splitInput(nextSuspectCards),
      suspectNames: splitInput(nextSuspectNames),
    };
    const hasRecognizedSource = conditions.sourceMode === 'recognized'
      && Boolean(conditions.sourceAmount)
      && ((conditions.sourceAccountCards?.length ?? 0) + (conditions.sourceAccountNames?.length ?? 0) > 0);
    if (!hasRecognizedSource && conditions.victimCards.length + conditions.victimNames.length === 0) {
      setError('请先设置被害人，才能从资金链上认定嫌疑人并重新审计。');
      return;
    }
    const filters = buildCurrentFilters();
    const payload: CaseAuditRunPayload = {
      caseId,
      auditId: auditId || undefined,
      victimCards: conditions.victimCards,
      victimNames: conditions.victimNames,
      suspectCards: conditions.suspectCards,
      suspectNames: conditions.suspectNames,
      sourceMode: conditions.sourceMode,
      sourceAccountCards: conditions.sourceAccountCards,
      sourceAccountNames: conditions.sourceAccountNames,
      sourceAmount: conditions.sourceAmount,
      sourceLabel: conditions.sourceLabel,
      sourceFromAuditId: conditions.sourceFromAuditId,
      sourceLayerIndex: conditions.sourceLayerIndex,
      startTime: normalizeDateTime(filters.startTime),
      endTime: normalizeDateTime(filters.endTime),
      minAmount: filters.minAmount || undefined,
      maxAmount: filters.maxAmount || undefined,
    };

    setSuspectCards(nextSuspectCards);
    setSuspectNames(nextSuspectNames);
    setRunning(true);
    setError('');
    try {
      if (auditId) {
        const updated = await saveCaseAuditFile(
          auditId,
          {
            caseId,
            auditName,
            conditions,
            filters,
          },
          token,
        );
        updateAuditFileState(updated);
      }
      const nextResult = await runCaseAudit(payload, token);
      setResult(nextResult);
      setCandidateSuspect(null);
      setAuditSaveMessage(`已将 ${candidateSuspect.name || candidateSuspect.card || '收款人'} 认定为嫌疑人并重新审计`);
      if (auditId) {
        loadCaseAuditFiles(caseId, token)
          .then((payloadAfterRun) => {
            setAuditFiles(payloadAfterRun.items);
          })
          .catch(() => undefined);
      }
    } catch (promoteError) {
      setResult(null);
      setError(promoteError instanceof Error ? caseAuditErrorText(promoteError.message) : '认定嫌疑人并重新审计失败');
    } finally {
      setRunning(false);
    }
  }, [
    auditId,
    auditName,
    buildCurrentConditions,
    buildCurrentFilters,
    candidateSuspect,
    caseId,
    running,
    suspectCards,
    suspectNames,
    token,
    updateAuditFileState,
    victimCards,
    victimNames,
  ]);

  const continueAuditFromRecognizedSuspect = useCallback(async (item: CaseAuditSuspectResult) => {
    if (!caseId || running || auditFilesLoading) {
      return;
    }
    const suspectLabel = item.suspectName || item.suspectCard || '已认定对象';
    const nextLayer = String((Number(sourceLayerIndex) || 1) + 1);
    const filters = buildCurrentFilters();
    const conditions: CaseAuditConditions = {
      victimCards: [],
      victimNames: [],
      suspectCards: [],
      suspectNames: [],
      sourceMode: 'recognized',
      sourceAccountCards: item.suspectCard ? [item.suspectCard] : [],
      sourceAccountNames: item.suspectName ? [item.suspectName] : [],
      sourceAmount: moneyPayloadValue(item.confirmAmount),
      sourceLabel: `${suspectLabel} 上一层可认定 ${moneyText(item.confirmAmount)}`,
      sourceFromAuditId: auditId,
      sourceLayerIndex: nextLayer,
    };
    const payload: CaseAuditRunPayload = {
      caseId,
      victimCards: [],
      victimNames: [],
      suspectCards: [],
      suspectNames: [],
      sourceMode: 'recognized',
      sourceAccountCards: conditions.sourceAccountCards,
      sourceAccountNames: conditions.sourceAccountNames,
      sourceAmount: conditions.sourceAmount,
      sourceLabel: conditions.sourceLabel,
      sourceFromAuditId: conditions.sourceFromAuditId,
      sourceLayerIndex: conditions.sourceLayerIndex,
      startTime: normalizeDateTime(filters.startTime),
      endTime: normalizeDateTime(filters.endTime),
      minAmount: filters.minAmount || undefined,
      maxAmount: filters.maxAmount || undefined,
    };

    setRunning(true);
    setError('');
    setAuditSaveMessage('');
    try {
      const existingLayerAudit = findMatchingLayerAudit(auditFiles, conditions);
      const activeAudit = existingLayerAudit
        ? await saveCaseAuditFile(
          existingLayerAudit.auditId,
          {
            caseId,
            auditName: existingLayerAudit.auditName || `第 ${nextLayer} 层：${suspectLabel} 下级资金追踪`,
            conditions,
            filters,
          },
          token,
        )
        : await createCaseAuditFile(
          {
            caseId,
            auditName: `第 ${nextLayer} 层：${suspectLabel} 下级资金追踪`,
            conditions,
            filters,
          },
          token,
        );
      const nextResult = await runCaseAudit({ ...payload, auditId: activeAudit.auditId }, token);
      setAuditFiles((items) => [activeAudit, ...items.filter((existing) => existing.auditId !== activeAudit.auditId)]);
      applyAuditFile(activeAudit);
      setResult(nextResult);
      setCandidateSuspect(null);
      setAuditSaveMessage(
        existingLayerAudit
          ? `已切换到第 ${nextLayer} 层审计：继续追踪 ${suspectLabel} 的下级资金`
          : `已创建第 ${nextLayer} 层审计：继续追踪 ${suspectLabel} 的下级资金`,
      );
      loadCaseAuditFiles(caseId, token)
        .then((payloadAfterRun) => {
          setAuditFiles(payloadAfterRun.items);
        })
        .catch(() => undefined);
    } catch (continueError) {
      setError(continueError instanceof Error ? caseAuditErrorText(continueError.message) : '创建下级资金追踪审计失败');
    } finally {
      setRunning(false);
    }
  }, [
    applyAuditFile,
    auditFiles,
    auditFilesLoading,
    auditId,
    buildCurrentFilters,
    caseId,
    running,
    sourceLayerIndex,
    token,
  ]);

  const summary = result?.summary;
  const evidenceStepByTradeId = useMemo(() => buildReasoningStepByTradeId(result), [result]);
  const evidenceTrades = useMemo(
    () => [...(result?.trades ?? [])].sort(auditTradeTimelineSort),
    [result],
  );
  const evidenceStepCount = result?.reasoningSteps.length ?? 0;
  const selectedCase = cases.find((item) => item.id === caseId) ?? null;
  const selectedCaseLabel = selectedCase?.caseName || selectedCase?.caseCode || selectedCase?.id || '请选择案件';
  const evidenceIncludedCount = useMemo(
    () => evidenceTrades.filter((trade) => evidenceStepByTradeId.has(trade.id) || Boolean(trade.flowStatus)).length,
    [evidenceStepByTradeId, evidenceTrades],
  );
  const evidenceKeptOnlyCount = Math.max(0, evidenceTrades.length - evidenceIncludedCount);
  const exportEvidenceCsv = useCallback(() => {
    if (!result || evidenceTrades.length === 0) {
      return;
    }
    const headers = [
      '证据编号',
      '原流水序号',
      '来源文件',
      '交易时间',
      '方向',
      '付款方',
      '付款账号',
      '收款方',
      '收款账号',
      '交易金额',
      '转出后余额',
      '审计处理',
      '资金池变化',
      '算法角色',
      '认定金额',
      '规则说明',
      '备注',
    ];
    const rows = evidenceTrades.map((trade, index) => {
      const step = evidenceStepByTradeId.get(trade.id);
      return [
        evidenceNumber(index),
        trade.serialNumber || String(index + 1),
        trade.fileName || trade.fileId || '',
        trade.tradeTime || '',
        trade.jdFlag || '',
        trade.payerAccountName || '',
        trade.payerTradeCard || '',
        trade.payeeAccountName || '',
        trade.payeeTradeCard || '',
        moneyText(trade.tradeAmount),
        moneyText(trade.payerTradeBalance),
        auditEvidenceProcessText(trade, step),
        step ? `${moneyText(step.poolBefore)} -> ${moneyText(step.poolAfter)}；${auditEvidenceFormula(trade, step)}` : auditEvidenceFormula(trade, step),
        auditEvidenceRoleText(trade, step),
        moneyText(step?.confirmAmountNumber ?? trade.confirmAmountNumber),
        auditFlowStatusText(trade),
        auditEvidenceRemark(trade, step),
      ];
    });
    const content = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
    const safeCaseLabel = selectedCaseLabel.replace(/[\\/:*?"<>|\\s]+/g, '-').replace(/^-+|-+$/g, '') || '涉诈资金审计';
    downloadTextFile(`${safeCaseLabel}-证据交易明细.csv`, `\ufeff${content}`);
  }, [evidenceStepByTradeId, evidenceTrades, result, selectedCaseLabel]);
  const victimConditionCount = splitInput(victimCards).length + splitInput(victimNames).length;
  const suspectConditionCount = splitInput(suspectCards).length + splitInput(suspectNames).length;
  const unrecognizedSuspectStatuses = useMemo(
    () => buildConfiguredSuspectStatuses(result, splitInput(suspectCards), splitInput(suspectNames)),
    [result, suspectCards, suspectNames],
  );
  const knownSuspectKeys = useMemo(
    () => buildSuspectKeySet(splitInput(suspectCards), splitInput(suspectNames)),
    [suspectCards, suspectNames],
  );
  const auditFileOptions = useMemo(
    () => auditFiles.map((item) => ({
      value: item.auditId,
      label: item.auditName || '涉诈资金审计',
      description: auditFileOptionDescription(item),
    })),
    [auditFiles],
  );

  return (
    <main className="case-audit-page">
      <header className="case-audit-topbar">
        <div className="case-audit-topbar-title">
          {navigationSlot ?? (
            <button className="case-audit-back-button" type="button" onClick={onBack}>
              <ArrowLeft size={16} />
              <span>返回上图</span>
            </button>
          )}
        </div>

        <div className="case-audit-case-strip">
          <div className="case-audit-field case-audit-field--case" ref={casePickerRef}>
            <button
              className={`case-audit-case-picker${casePickerOpen ? ' is-open' : ''}`}
              type="button"
              disabled={casesLoading || cases.length === 0}
              aria-haspopup="listbox"
              aria-expanded={casePickerOpen}
              onClick={() => setCasePickerOpen((open) => !open)}
            >
              <strong>{casesLoading ? '读取案件中' : selectedCaseLabel}</strong>
              <ChevronDown size={18} />
            </button>
            {casePickerOpen ? (
              <div className="case-audit-case-menu" role="listbox" aria-label="案件">
                {cases.map((item) => {
                  const label = item.caseName || item.caseCode || item.id;
                  const selected = item.id === caseId;
                  return (
                    <button
                      key={item.id}
                      className={`case-audit-case-option${selected ? ' is-selected' : ''}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        setCaseId(item.id);
                        setCasePickerOpen(false);
                      }}
                    >
                      <span>{label}</span>
                      {selected ? <Check size={15} /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div className="case-audit-case-meta" aria-label="案件流水概览">
            {overviewLoading ? (
              <span className="case-audit-case-meta-loading">读取案件流水中</span>
            ) : overview ? (
              <>
                <span>
                  <b>{overview.tradeCount}</b>
                  <small>笔流水</small>
                </span>
                <span>
                  <b>{overview.sourceFileCount}</b>
                  <small>个来源文件</small>
                </span>
                <span title="缺少转出后余额的流水笔数。嫌疑人出账时，原版算法需要用转出后余额计算最低可认定金额；0 表示本案流水的余额字段完整。">
                  <b>{overview.balanceMissingCount}</b>
                  <small>笔缺少余额</small>
                </span>
              </>
            ) : (
              <span className="case-audit-case-meta-loading">暂无案件流水概览</span>
            )}
          </div>
        </div>

        <div className="case-audit-topbar-actions">
          <button className="case-audit-topbar-button" type="button" onClick={() => setAuditPanelOpen(true)}>
            <FileText size={15} />
            <span>审计设定</span>
          </button>
          <button className="case-audit-topbar-button" type="button" onClick={() => setEvidenceModalOpen(true)}>
            <TableProperties size={15} />
            <span>证据明细</span>
          </button>
          <button className="case-graph-primary-button" type="button" onClick={submitAudit} disabled={!caseId || running || auditFilesLoading}>
            <Play size={15} />
            <span>{running ? '审计中' : '执行审计'}</span>
          </button>
        </div>
      </header>

      {error ? (
        <div className="case-audit-error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="case-audit-workspace">
        <Modal
          open={auditPanelOpen}
          title="审计设定"
          description="管理审计档案、身份条件和交易范围"
          onClose={() => setAuditPanelOpen(false)}
          size="lg"
          className="case-audit-settings-modal"
          bodyClassName="case-audit-settings-body"
          footer={(
            <>
              <span className="case-audit-settings-footer-status">
                {auditSaveMessage || (auditId ? '身份设定会保存到当前审计档案' : '请选择或新建审计档案')}
              </span>
              <CaseAuditSecondaryButton onClick={createAudit} disabled={!caseId || auditFilesLoading}>
                <Plus size={14} />
                <span>新建档案</span>
              </CaseAuditSecondaryButton>
              <CaseAuditSecondaryButton onClick={() => setAuditPanelOpen(false)}>
                取消
              </CaseAuditSecondaryButton>
              <button className="case-graph-primary-button" type="button" onClick={() => void saveCurrentAudit()} disabled={!auditId || auditSaving}>
                <Save size={14} />
                <span>{auditSaving ? '保存中' : '保存设定'}</span>
              </button>
            </>
          )}
        >
          <section className="case-audit-sidebar-group case-audit-file-editor">
            <div className="case-audit-section-title">
              <FileText size={16} />
              <span>审计档案</span>
            </div>
            <label className="case-audit-field">
              <span>当前档案</span>
              <Select
                value={auditId}
                options={auditFileOptions}
                disabled={auditFilesLoading || auditFileOptions.length === 0}
                placeholder={auditFilesLoading ? '读取审计档案中' : '暂无审计档案'}
                ariaLabel="当前档案"
                onChange={selectAudit}
              />
            </label>
            <label className="case-audit-field">
              <span>档案名称</span>
              <input value={auditName} onChange={(event) => setAuditName(event.target.value)} placeholder="填写本次审计名称" />
            </label>
          </section>

          <section className="case-audit-sidebar-group case-audit-identity-editor">
            <div className="case-audit-sidebar-label case-audit-sidebar-label-row">
              <span>身份设定</span>
              <span>{victimConditionCount > 0 ? `被害人 ${victimConditionCount}` : '被害人未填'} / {suspectConditionCount > 0 ? `嫌疑人 ${suspectConditionCount}` : '嫌疑人发现模式'}</span>
            </div>
            {sourceMode === 'recognized' ? (
              <div className="case-audit-source-banner">
                <Route size={16} />
                <div>
                  <strong>本轮从上一层认定金额继续追踪</strong>
                  <span>{sourceLabel || `${sourceAccountNames || sourceAccountCards || '已认定对象'} 可认定 ${moneyText(sourceAmount)}`}</span>
                </div>
              </div>
            ) : null}
            <div className="case-audit-condition-grid">
              <label className="case-audit-field">
                <span>被害人账号</span>
                <textarea value={victimCards} onChange={(event) => setVictimCards(event.target.value)} placeholder="一行一个被害人账号，账号或姓名必填其一" />
              </label>
              <label className="case-audit-field">
                <span>被害人姓名</span>
                <textarea value={victimNames} onChange={(event) => setVictimNames(event.target.value)} placeholder="一行一个被害人姓名，账号或姓名必填其一" />
              </label>
              <label className="case-audit-field">
                <span>嫌疑人账号</span>
                <textarea value={suspectCards} onChange={(event) => setSuspectCards(event.target.value)} placeholder="一行一个嫌疑人账号，可留空由系统发现" />
              </label>
              <label className="case-audit-field">
                <span>嫌疑人姓名</span>
                <textarea value={suspectNames} onChange={(event) => setSuspectNames(event.target.value)} placeholder="一行一个嫌疑人姓名，可留空" />
              </label>
            </div>
          </section>

          <section className="case-audit-sidebar-group case-audit-range-editor">
            <div className="case-audit-section-title">
              <Calculator size={16} />
              <span>交易范围</span>
            </div>
            <label className="case-audit-field">
              <span>开始时间</span>
              <input type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
            </label>
            <label className="case-audit-field">
              <span>结束时间</span>
              <input type="datetime-local" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
            </label>
            <label className="case-audit-field">
              <span>最小金额</span>
              <input type="number" inputMode="decimal" value={minAmount} onChange={(event) => setMinAmount(event.target.value)} />
            </label>
            <label className="case-audit-field">
              <span>最大金额</span>
              <input type="number" inputMode="decimal" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} />
            </label>
          </section>

          <div className="case-audit-rule-note">
            <strong>金额认定逻辑</strong>
            <span>被害人信息是审计起点；系统按交易时间累计被害人入账。遇到嫌疑人并形成金额认定后，本段封段，后续资金重新累计，避免同一笔涉诈资金重复认定。</span>
          </div>
        </Modal>

        <section className="case-audit-canvas-column">
          <section className="case-audit-card case-audit-graph-card">
            <div className="case-audit-card-header">
            <div>
              <h2>资金关系与认定推导图</h2>
              <span>按交易时间分段展示每次出账前的资金池、扣减和最低金额认定</span>
            </div>
              <Network size={18} />
            </div>
            <CaseAuditFlowChart
              result={result}
              knownSuspectKeys={knownSuspectKeys}
              onCandidateSelect={setCandidateSuspect}
            />
          </section>

          <Modal
            open={Boolean(candidateSuspect)}
            title="认定候选嫌疑人"
            description="确认后会写入当前审计档案，并按原审计算法重新计算金额。"
            onClose={() => setCandidateSuspect(null)}
            size="sm"
            className="case-audit-candidate-modal"
            footer={(
              <>
                <CaseAuditSecondaryButton onClick={() => setCandidateSuspect(null)} disabled={running}>
                  取消
                </CaseAuditSecondaryButton>
                <button className="case-graph-primary-button" type="button" onClick={promoteCandidateSuspect} disabled={running || !candidateSuspect}>
                  <Play size={14} />
                  <span>{running ? '重新审计中' : '认定并重新审计'}</span>
                </button>
              </>
            )}
          >
            {candidateSuspect ? (
              <div className="case-audit-candidate-modal-body">
                <div className="case-audit-candidate-subject">
                  <strong>{candidateSuspect.name || candidateSuspect.card || '收款人'}</strong>
                  <span>{candidateSuspect.card || '未记录账号'}</span>
                </div>
                <dl className="case-audit-candidate-details">
                  <div>
                    <dt>来源流水</dt>
                    <dd>{candidateSuspect.sourceSerialNumber || candidateSuspect.sourceTradeId || '未记录'}</dd>
                  </div>
                  <div>
                    <dt>转账金额</dt>
                    <dd>{candidateSuspect.sourceAmount ? moneyText(candidateSuspect.sourceAmount) : '未记录'}</dd>
                  </div>
                  <div>
                    <dt>认定依据</dt>
                    <dd>{candidateSuspect.reason}</dd>
                  </div>
                </dl>
              </div>
            ) : null}
          </Modal>

          <Modal
            open={evidenceModalOpen}
            title="证据交易明细"
            description={result ? `${evidenceTrades.length} 笔审计范围流水，按交易时间顺序展示认定规则` : '执行审计后展示完整流水底稿'}
            onClose={() => setEvidenceModalOpen(false)}
            size="xl"
            className="case-audit-evidence-card case-audit-evidence-modal"
            headerActions={(
              <CaseAuditSecondaryButton onClick={exportEvidenceCsv} disabled={!result || evidenceTrades.length === 0}>
                <Download size={14} />
                <span>导出证据 CSV</span>
              </CaseAuditSecondaryButton>
            )}
          >
            <div className="case-audit-evidence-summary">
              <span>
                <strong>{summary ? summary.tradeCount : 0}</strong>
                全量流水底稿
              </span>
              <span>
                <strong>{evidenceIncludedCount}</strong>
                进入认定链
              </span>
              <span>
                <strong>{evidenceKeptOnlyCount}</strong>
                保留底稿
              </span>
              <span>
                <strong>{summary ? moneyText(summary.confirmAmount) : '0.00'}</strong>
                最低可认定
              </span>
            </div>
            <div className="case-audit-evidence-guide">
              <span><i className="case-audit-evidence-mark case-audit-evidence-mark--included" />进入认定链：被害资金进入、非嫌疑人扣减或嫌疑人出账，参与本次金额推导。</span>
              <span><i className="case-audit-evidence-mark case-audit-evidence-mark--kept" />保留底稿：属于本案流水时间线，但未命中本次被害人/嫌疑人条件，不参与本次认定。</span>
              <span>推导步骤 {evidenceStepCount} 步，表格按原始交易时间顺序展示。</span>
            </div>
            <div className="case-audit-table-wrap">
              <table className="case-audit-table case-audit-trade-table case-audit-evidence-table">
                <thead>
                  <tr>
                    <th>证据编号</th>
                    <th>序号</th>
                    <th>来源</th>
                    <th>时间</th>
                    <th>方向</th>
                    <th>付款方</th>
                    <th>收款方</th>
                    <th>交易金额</th>
                    <th>转出后余额</th>
                    <th>审计处理</th>
                    <th>资金池变化</th>
                    <th>算法角色</th>
                    <th>认定金额</th>
                    <th>规则说明</th>
                  </tr>
                </thead>
                <tbody>
                  {evidenceTrades.length ? (
                    evidenceTrades.map((trade, index) => {
                      const step = evidenceStepByTradeId.get(trade.id);
                      return (
                        <tr key={`${trade.id}-${trade.relationId || index}`} className={auditEvidenceRowClass(trade, step)}>
                          <td>
                            <span className="case-audit-evidence-index case-audit-evidence-index--primary">{evidenceNumber(index)}</span>
                          </td>
                          <td>
                            <span className="case-audit-evidence-index">{trade.serialNumber || index + 1}</span>
                          </td>
                          <td>
                            <div className="case-audit-evidence-source">
                              <strong>{trade.fileName || trade.fileId || '-'}</strong>
                              <span>{trade.id || trade.tradeRowId || '-'}</span>
                            </div>
                          </td>
                          <td>{trade.tradeTime || '-'}</td>
                          <td>
                            <span className={`case-audit-direction-pill case-audit-direction-pill--${normalizePartyText(trade.jdFlag) === '贷' ? 'credit' : 'debit'}`}>
                              {trade.jdFlag || '-'}
                            </span>
                          </td>
                          <td>
                            <div className="case-audit-evidence-party">
                              <strong>{trade.payerAccountName || trade.payerTradeCard || '-'}</strong>
                              <span>{trade.payerTradeCard || '-'}</span>
                            </div>
                          </td>
                          <td>
                            <div className="case-audit-evidence-party">
                              <strong>{trade.payeeAccountName || trade.payeeTradeCard || '-'}</strong>
                              <span>{trade.payeeTradeCard || '-'}</span>
                            </div>
                          </td>
                          <td className="case-audit-evidence-money">{moneyText(trade.tradeAmount)}</td>
                          <td className="case-audit-evidence-money">{moneyText(trade.payerTradeBalance)}</td>
                          <td>
                            <span className={`case-audit-process-pill ${step || trade.flowStatus ? 'is-included' : 'is-ignored'}`}>
                              {auditEvidenceProcessText(trade, step)}
                            </span>
                          </td>
                          <td>
                            <div className="case-audit-evidence-formula">
                              <strong>{step ? `${moneyText(step.poolBefore)} -> ${moneyText(step.poolAfter)}` : '-'}</strong>
                              <span>{auditEvidenceFormula(trade, step)}</span>
                            </div>
                          </td>
                          <td>
                            <span className={`case-audit-flow-status case-audit-flow-status--${step?.kind || trade.flowStatus || 'none'}`}>
                              {auditEvidenceRoleText(trade, step)}
                            </span>
                          </td>
                          <td className="case-audit-evidence-money case-audit-evidence-money--confirm">
                            {moneyText(step?.confirmAmountNumber ?? trade.confirmAmountNumber)}
                          </td>
                          <td>
                            <div className="case-audit-evidence-rule">
                              <strong>{auditFlowStatusText(trade)}</strong>
                              <span>{auditEvidenceRemark(trade, step)}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={14}>暂无审计流水</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Modal>
        </section>

        <aside className="case-audit-inspector">
          <section className="case-audit-card case-audit-kpi-panel">
            <div className="case-audit-summary-grid">
              <div className="case-audit-kpi" title="最终按最低口径认定给嫌疑人的金额。计算时会扣除嫌疑人转出后的账户余额，避免把仍可由余额覆盖的部分也算进去。">
                <span>最低可认定</span>
                <strong>{summary ? moneyText(summary.confirmAmount) : '0.00'}</strong>
              </div>
              <div className="case-audit-kpi" title="命中嫌疑人时，嫌疑人收到或转出的相关金额合计。它是涉案资金规模，不等于最终最低认定金额。">
                <span>嫌疑人转出</span>
                <strong>{summary ? moneyText(summary.caseAmount) : '0.00'}</strong>
              </div>
              <div className="case-audit-kpi" title="进入本轮审计资金池的被害资金合计，包括被害人被骗入账，或上一层已认定金额继续向下追踪时带入的金额。">
                <span>被害资金进入</span>
                <strong>{summary ? moneyText(summary.fraudAmount) : '0.00'}</strong>
              </div>
              <div className="case-audit-kpi" title="参与形成金额认定的嫌疑人出账流水笔数，不是本案全部流水笔数。">
                <span>认定出账笔数</span>
                <strong>{summary ? summary.recognizedTradeCount : 0}</strong>
              </div>
            </div>
          </section>
          <section className="case-audit-card case-audit-suspect-card">
            <div className="case-audit-card-header">
              <div>
                <h2>嫌疑人金额认定</h2>
                <span>{result ? `${result.suspectResults.length} 名已认定 / ${unrecognizedSuspectStatuses.length} 名未认定` : '执行审计后展示'}</span>
              </div>
              <Scale size={18} />
            </div>
            <div className="case-audit-suspect-list">
              {result?.suspectResults.length ? (
                result.suspectResults.map((item) => (
                  <article key={`${item.suspectName}-${item.suspectCard}`} className="case-audit-suspect-item">
                    <div className="case-audit-suspect-title">
                      <strong>{item.suspectName || '未知嫌疑人'}</strong>
                      <span>{item.suspectCard || '未记录账号'}</span>
                    </div>
                    <div className="case-audit-suspect-metrics">
                      <span>可认定 <b>{moneyText(item.confirmAmount)}</b></span>
                      <span>涉案 <b>{moneyText(item.caseAmount)}</b></span>
                      <span>关联入账 <b>{moneyText(item.fraudAmount)}</b></span>
                    </div>
                    <div className="case-audit-suspect-trades">出账交易：{item.tradeIds.join('、') || '-'}</div>
                    <button
                      className="case-audit-suspect-chain-button"
                      type="button"
                      onClick={() => void continueAuditFromRecognizedSuspect(item)}
                      disabled={running || item.confirmAmountNumber <= 0}
                    >
                      <Route size={13} />
                      <span>追踪下级资金</span>
                    </button>
                  </article>
                ))
              ) : (
                <div className="case-audit-empty-list">暂无可认定结果</div>
              )}
              {unrecognizedSuspectStatuses.length ? (
                <div className="case-audit-suspect-status-group">
                  <div className="case-audit-suspect-status-heading">已设为嫌疑人，本轮未形成金额认定</div>
                  {unrecognizedSuspectStatuses.map((item) => (
                    <article key={item.key} className="case-audit-suspect-item case-audit-suspect-item--muted">
                      <div className="case-audit-suspect-title">
                        <strong>{item.name || item.card || '未记录对象'}</strong>
                        <span>{item.card || '未记录账号'}</span>
                      </div>
                      <div className="case-audit-suspect-trades">命中交易：{item.tradeLabel}</div>
                      <div className="case-audit-suspect-reason">{item.reason}</div>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          {result?.quality.warnings.length ? (
            <section className="case-audit-card case-audit-warning-panel">
              <div className="case-audit-card-header">
                <div>
                  <h2>审计提示</h2>
                  <span>{result.quality.warnings.length} 条</span>
                </div>
                <AlertCircle size={18} />
              </div>
              <div className="case-audit-warning-list">
                {result.quality.warnings.map((warning) => (
                  <div key={warning} className="case-audit-warning">
                    <AlertCircle size={15} />
                    <span>{warning}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
