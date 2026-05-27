import { Check, FileSearch, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  SortableColumnHeader,
  sortItemsByState,
  sortableHeaderAria,
  type SortAccessors,
  type SortState,
} from './sortable-table';
import { CaseGraphDateInput } from './date-input';
import type { CaseGraphData, CaseGraphNode, CaseGraphTradeFact } from './types';

export interface SummaryAnalysisItem {
  nodeId: string;
  label: string;
  accountText: string;
  accounts?: Array<{ accountId?: string | null; tradeCard?: string; accountName?: string }>;
  receivedAmount: number;
  receivedCount: number;
  paidAmount: number;
  paidCount: number;
  totalAmount: number;
  netAmount: number;
  minAmount: number | null;
  maxAmount: number | null;
  startTime: string;
  endTime: string;
  tradeIds: string[];
  isOnGraph?: boolean;
  isExcluded: boolean;
  status?: 'candidate' | 'on_graph' | 'excluded';
}

interface SummaryAnalysisDrawerProps {
  open: boolean;
  scope?: 'node' | 'global';
  node: CaseGraphNode | null;
  items: SummaryAnalysisItem[];
  selectedNodeIds: string[];
  loading?: boolean;
  applying: boolean;
  onToggleNode: (nodeId: string) => void;
  onToggleNodes: (nodeIds: string[], selected: boolean) => void;
  onApply: () => void;
  onClose: () => void;
}

interface SummaryAnalysisFilters {
  keyword: string;
  minAmount: string;
  maxAmount: string;
  startTime: string;
  endTime: string;
  direction: 'all' | 'in' | 'out';
  minInCount: string;
  minOutCount: string;
}

type SummarySortKey = 'counterparty' | 'received' | 'paid' | 'net' | 'range' | 'time' | 'trades' | 'status';

export function SummaryAnalysisDrawer({
  open,
  scope = 'node',
  node,
  items,
  selectedNodeIds,
  loading = false,
  applying,
  onToggleNode,
  onToggleNodes,
  onApply,
  onClose,
}: SummaryAnalysisDrawerProps) {
  const [filters, setFilters] = useState<SummaryAnalysisFilters>(emptySummaryFilters);
  const [sortState, setSortState] = useState<SortState<SummarySortKey> | null>(null);

  useEffect(() => {
    if (!open) {
      setFilters(emptySummaryFilters());
      setSortState(null);
    }
  }, [open]);

  const selectedSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const filteredItems = useMemo(
    () => filterSummaryAnalysisItems(items, filters),
    [filters, items],
  );
  const sortedItems = useMemo(
    () => sortItemsByState(filteredItems, sortState, summarySortAccessors),
    [filteredItems, sortState],
  );
  const filteredNodeIds = useMemo(
    () => filteredItems.map((item) => item.nodeId).filter(Boolean),
    [filteredItems],
  );
  const selectedFilteredCount = filteredNodeIds.filter((nodeId) => selectedSet.has(nodeId)).length;
  const allFilteredSelected = filteredNodeIds.length > 0 && selectedFilteredCount === filteredNodeIds.length;
  const someFilteredSelected = selectedFilteredCount > 0 && selectedFilteredCount < filteredNodeIds.length;
  const selectedTotalCount = items.filter((item) => selectedSet.has(item.nodeId)).length;

  if (!open) {
    return null;
  }

  const isGlobalScope = scope === 'global';
  const title = node?.label || node?.accountName || node?.name || node?.tradeCard || node?.id || '全图';

  return (
    <div className="case-graph-modal-mask case-graph-modal-mask--detail" role="presentation" onClick={onClose}>
      <section
        className="case-graph-summary-analysis-modal"
        role="dialog"
        aria-modal="true"
        aria-label="线索扩展"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="case-graph-edge-detail-header">
          <div className="case-graph-detail-analysis-title">
            <h2>线索扩展</h2>
            <span>{isGlobalScope ? `全局综合查询 · 数据库候选 ${items.length} 个` : `${title} · 数据库候选 ${items.length} 个`}</span>
          </div>
          <button type="button" className="case-graph-edge-detail-close" onClick={onClose} aria-label="关闭线索扩展">
            <X size={20} />
          </button>
        </div>

        <div className="case-graph-summary-analysis-body">
          <div className="case-graph-summary-analysis-toolbar">
            <input
              type="search"
              value={filters.keyword}
              onChange={(event) => setFilters((current) => ({ ...current, keyword: event.target.value }))}
              placeholder="主体、账号"
            />
            <input
              type="number"
              min="0"
              value={filters.minAmount}
              onChange={(event) => setFilters((current) => ({ ...current, minAmount: event.target.value }))}
              placeholder="最小往来金额"
            />
            <input
              type="number"
              min="0"
              value={filters.maxAmount}
              onChange={(event) => setFilters((current) => ({ ...current, maxAmount: event.target.value }))}
              placeholder="最大往来金额"
            />
            <CaseGraphDateInput
              value={filters.startTime}
              onChange={(value) => setFilters((current) => ({ ...current, startTime: value }))}
              ariaLabel="开始日期"
              placeholder="开始日期"
            />
            <CaseGraphDateInput
              value={filters.endTime}
              onChange={(value) => setFilters((current) => ({ ...current, endTime: value }))}
              ariaLabel="结束日期"
              placeholder="结束日期"
            />
            <select
              value={filters.direction}
              onChange={(event) => setFilters((current) => ({ ...current, direction: event.target.value as SummaryAnalysisFilters['direction'] }))}
              aria-label="资金方向"
            >
              <option value="all">全部方向</option>
              <option value="in">只看来款</option>
              <option value="out">只看去向</option>
            </select>
            <input
              type="number"
              min="0"
              value={filters.minInCount}
              onChange={(event) => setFilters((current) => ({ ...current, minInCount: event.target.value }))}
              placeholder="最小来款笔数"
            />
            <input
              type="number"
              min="0"
              value={filters.minOutCount}
              onChange={(event) => setFilters((current) => ({ ...current, minOutCount: event.target.value }))}
              placeholder="最小去向笔数"
            />
          </div>

          <div className="case-graph-detail-analysis-selection-tools">
            <span>当前结果 {filteredItems.length} 个主体，已选择 {selectedFilteredCount} 个</span>
            <button
              type="button"
              disabled={!filteredNodeIds.length || allFilteredSelected}
              onClick={() => onToggleNodes(filteredNodeIds, true)}
            >
              全部选择
            </button>
            <button
              type="button"
              disabled={!selectedFilteredCount}
              onClick={() => onToggleNodes(filteredNodeIds, false)}
            >
              清空选择
            </button>
          </div>

          <div className="case-graph-summary-analysis-table-wrap">
            {loading ? (
              <div className="case-graph-empty">
                <FileSearch size={18} />
                <span>{isGlobalScope ? '正在从案件交易流水中查找可补充上图的主体。' : '正在从案件交易流水中查找可扩展线索。'}</span>
              </div>
            ) : filteredItems.length ? (
              <table className="case-graph-edge-table case-graph-summary-analysis-table">
                <thead>
                  <tr>
                    <th>
                      <SelectionCheckbox
                        ariaLabel="选择当前结果主体"
                        checked={allFilteredSelected}
                        disabled={!filteredNodeIds.length}
                        indeterminate={someFilteredSelected}
                        onChange={(checked) => onToggleNodes(filteredNodeIds, checked)}
                      />
                    </th>
                    <th aria-sort={sortableHeaderAria(sortState, 'counterparty')}>
                      <SortableColumnHeader label="对手主体" sortKey="counterparty" sortState={sortState} onSortChange={setSortState} />
                    </th>
                    <th aria-sort={sortableHeaderAria(sortState, 'received')}>
                      <SortableColumnHeader label="来款" sortKey="received" sortState={sortState} defaultDirection="desc" onSortChange={setSortState} />
                    </th>
                    <th aria-sort={sortableHeaderAria(sortState, 'paid')}>
                      <SortableColumnHeader label="去向" sortKey="paid" sortState={sortState} defaultDirection="desc" onSortChange={setSortState} />
                    </th>
                    <th aria-sort={sortableHeaderAria(sortState, 'net')}>
                      <SortableColumnHeader label="净流入" sortKey="net" sortState={sortState} defaultDirection="desc" onSortChange={setSortState} />
                    </th>
                    <th aria-sort={sortableHeaderAria(sortState, 'range')}>
                      <SortableColumnHeader label="单笔范围" sortKey="range" sortState={sortState} defaultDirection="desc" onSortChange={setSortState} />
                    </th>
                    <th aria-sort={sortableHeaderAria(sortState, 'time')}>
                      <SortableColumnHeader label="时间范围" sortKey="time" sortState={sortState} defaultDirection="desc" onSortChange={setSortState} />
                    </th>
                    <th aria-sort={sortableHeaderAria(sortState, 'trades')}>
                      <SortableColumnHeader label="流水" sortKey="trades" sortState={sortState} defaultDirection="desc" onSortChange={setSortState} />
                    </th>
                    <th aria-sort={sortableHeaderAria(sortState, 'status')}>
                      <SortableColumnHeader label="状态" sortKey="status" sortState={sortState} onSortChange={setSortState} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((item) => {
                    const checked = selectedSet.has(item.nodeId);
                    return (
                      <tr key={item.nodeId} className={checked ? 'is-selected' : ''}>
                        <td>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onToggleNode(item.nodeId)}
                            aria-label="选择主体加入图谱"
                          />
                        </td>
                        <td>
                          <div className="case-graph-edge-party-cell">
                            <span className="case-graph-edge-party-name">{item.label}</span>
                            <span className="case-graph-edge-party-raw">{item.accountText || '-'}</span>
                          </div>
                        </td>
                        <td>{formatAmount(item.receivedAmount)} 元 / {item.receivedCount} 笔</td>
                        <td>{formatAmount(item.paidAmount)} 元 / {item.paidCount} 笔</td>
                        <td>{formatSignedAmount(item.netAmount)} 元</td>
                        <td>{formatAmountRange(item.minAmount, item.maxAmount)}</td>
                        <td>{formatTimeRange(item.startTime, item.endTime)}</td>
                        <td>{item.tradeIds.length} 笔</td>
                        <td><span className="case-graph-summary-status">{formatSummaryStatus(item)}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="case-graph-empty">
                <FileSearch size={18} />
                <span>{isGlobalScope ? '当前筛选条件下没有可补充上图的主体。' : '当前筛选条件下没有可补充上图的关联主体。'}</span>
              </div>
            )}
          </div>
        </div>

        <footer className="case-graph-detail-analysis-footer">
          <span>{isGlobalScope ? `将把 ${selectedTotalCount} / ${items.length} 个候选主体加入当前图谱` : `将把 ${selectedTotalCount} / ${items.length} 个候选主体及相关资金线补充到当前图谱`}</span>
          <button type="button" className="case-graph-secondary-button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="case-graph-primary-button"
            disabled={loading || applying || !items.length || !selectedTotalCount}
            onClick={onApply}
          >
            <Check size={14} />
            <span>{applying ? '加入中' : '加入图谱'}</span>
          </button>
        </footer>
      </section>
    </div>
  );
}

const summarySortAccessors: SortAccessors<SummaryAnalysisItem, SummarySortKey> = {
  counterparty: (item) => [item.label, item.accountText],
  received: (item) => [item.receivedAmount, item.receivedCount],
  paid: (item) => [item.paidAmount, item.paidCount],
  net: (item) => item.netAmount,
  range: (item) => [item.maxAmount, item.minAmount],
  time: (item) => [item.endTime, item.startTime],
  trades: (item) => item.tradeIds.length,
  status: (item) => summaryStatusRank(item),
};

function formatSummaryStatus(item: SummaryAnalysisItem): string {
  if (item.status === 'excluded' || item.isExcluded) return '已取消上图';
  if (item.status === 'on_graph' || item.isOnGraph) return '已上图';
  return '可补充';
}

function summaryStatusRank(item: SummaryAnalysisItem): number {
  if (item.status === 'excluded' || item.isExcluded) return 2;
  if (item.status === 'on_graph' || item.isOnGraph) return 1;
  return 0;
}

export function buildSummaryAnalysisItems(
  focusNode: CaseGraphNode | null,
  graphData: CaseGraphData | null,
  excludedTradeIds: string[] = [],
): SummaryAnalysisItem[] {
  const focusNodeId = String(focusNode?.id || '').trim();
  if (!focusNodeId || !graphData) {
    return [];
  }
  const nodesById = new Map(graphData.nodes.map((node) => [String(node.id || '').trim(), node]));
  const excludedTradeSet = new Set(excludedTradeIds.map((tradeId) => tradeId.trim()).filter(Boolean));
  const itemsByNodeId = new Map<string, SummaryAnalysisItem>();

  for (const edge of graphData.edges) {
    const source = String(edge.source || edge.from || '').trim();
    const target = String(edge.target || edge.to || '').trim();
    if (!source || !target || (source !== focusNodeId && target !== focusNodeId)) {
      continue;
    }
    const direction: 'in' | 'out' = target === focusNodeId ? 'in' : 'out';
    const counterpartyId = direction === 'in' ? source : target;
    const counterparty = nodesById.get(counterpartyId);
    if (!counterparty) {
      continue;
    }
    const item = getOrCreateSummaryItem(itemsByNodeId, counterpartyId, counterparty);
    const tradeIds = (edge.tradeIds ?? []).map((tradeId) => String(tradeId || '').trim()).filter((tradeId) => tradeId && !excludedTradeSet.has(tradeId));
    const facts = tradeIds
      .map((tradeId) => graphData.tradeFacts?.[tradeId])
      .filter((fact): fact is CaseGraphTradeFact => Boolean(fact));
    if (tradeIds.length && facts.length === tradeIds.length) {
      for (const fact of facts) {
        applySummaryFact(item, fact, direction);
      }
      item.tradeIds = uniqueTextList([...item.tradeIds, ...tradeIds]);
    } else {
      applySummaryFallbackEdge(item, edge, direction);
      item.tradeIds = uniqueTextList([...item.tradeIds, ...tradeIds]);
    }
  }

  return [...itemsByNodeId.values()].sort((left, right) => {
    if (left.isExcluded !== right.isExcluded) {
      return left.isExcluded ? 1 : -1;
    }
    return right.totalAmount - left.totalAmount || right.tradeIds.length - left.tradeIds.length || left.label.localeCompare(right.label, 'zh-Hans-CN');
  });
}

export function filterSummaryAnalysisItems(
  items: SummaryAnalysisItem[],
  filters: SummaryAnalysisFilters,
): SummaryAnalysisItem[] {
  const keyword = filters.keyword.trim().toLowerCase();
  const minAmount = finiteNumber(filters.minAmount);
  const maxAmount = finiteNumber(filters.maxAmount);
  const minInCount = finiteNumber(filters.minInCount);
  const minOutCount = finiteNumber(filters.minOutCount);
  return items.filter((item) => {
    if (keyword) {
      const text = `${item.label} ${item.accountText}`.toLowerCase();
      if (!text.includes(keyword)) return false;
    }
    if (minAmount != null && item.totalAmount < minAmount) return false;
    if (maxAmount != null && item.totalAmount > maxAmount) return false;
    if (filters.direction === 'in' && item.receivedCount <= 0) return false;
    if (filters.direction === 'out' && item.paidCount <= 0) return false;
    if (minInCount != null && item.receivedCount < minInCount) return false;
    if (minOutCount != null && item.paidCount < minOutCount) return false;
    if (filters.startTime && (!item.endTime || item.endTime < filters.startTime)) return false;
    if (filters.endTime && (!item.startTime || item.startTime > endOfDay(filters.endTime))) return false;
    return true;
  });
}

export function buildSummaryAnalysisItemsForTest(
  focusNode: CaseGraphNode | null,
  graphData: CaseGraphData | null,
  excludedTradeIds: string[] = [],
): SummaryAnalysisItem[] {
  return buildSummaryAnalysisItems(focusNode, graphData, excludedTradeIds);
}

export function filterSummaryAnalysisItemsForTest(
  items: SummaryAnalysisItem[],
  filters: Partial<SummaryAnalysisFilters>,
): SummaryAnalysisItem[] {
  return filterSummaryAnalysisItems(items, { ...emptySummaryFilters(), ...filters });
}

function emptySummaryFilters(): SummaryAnalysisFilters {
  return {
    keyword: '',
    minAmount: '',
    maxAmount: '',
    startTime: '',
    endTime: '',
    direction: 'all',
    minInCount: '',
    minOutCount: '',
  };
}

function getOrCreateSummaryItem(
  itemsByNodeId: Map<string, SummaryAnalysisItem>,
  nodeId: string,
  node: CaseGraphNode,
): SummaryAnalysisItem {
  const existing = itemsByNodeId.get(nodeId);
  if (existing) {
    return existing;
  }
  const item: SummaryAnalysisItem = {
    nodeId,
    label: node.label || node.accountName || node.name || node.tradeCard || node.id,
    accountText: resolveNodeAccountText(node),
    receivedAmount: 0,
    receivedCount: 0,
    paidAmount: 0,
    paidCount: 0,
    totalAmount: 0,
    netAmount: 0,
    minAmount: null,
    maxAmount: null,
    startTime: '',
    endTime: '',
    tradeIds: [],
    isExcluded: Boolean(node.isExcluded),
  };
  itemsByNodeId.set(nodeId, item);
  return item;
}

function applySummaryFact(item: SummaryAnalysisItem, fact: CaseGraphTradeFact, direction: 'in' | 'out'): void {
  const amount = Number(fact.tradeAmount || 0);
  if (direction === 'in') {
    item.receivedAmount += amount;
    item.receivedCount += 1;
  } else {
    item.paidAmount += amount;
    item.paidCount += 1;
  }
  item.totalAmount += amount;
  item.netAmount = item.receivedAmount - item.paidAmount;
  item.minAmount = item.minAmount == null ? amount : Math.min(item.minAmount, amount);
  item.maxAmount = item.maxAmount == null ? amount : Math.max(item.maxAmount, amount);
  updateTimeRange(item, fact.tradeTime || '');
}

function applySummaryFallbackEdge(
  item: SummaryAnalysisItem,
  edge: CaseGraphData['edges'][number],
  direction: 'in' | 'out',
): void {
  const amount = Number(edge.tradeAmount ?? edge.amount ?? 0);
  const count = Number(edge.tradeCount ?? edge.count ?? 0);
  if (direction === 'in') {
    item.receivedAmount += amount;
    item.receivedCount += count;
  } else {
    item.paidAmount += amount;
    item.paidCount += count;
  }
  item.totalAmount += amount;
  item.netAmount = item.receivedAmount - item.paidAmount;
  item.minAmount = item.minAmount == null ? amount : Math.min(item.minAmount, amount);
  item.maxAmount = item.maxAmount == null ? amount : Math.max(item.maxAmount, amount);
  updateTimeRange(item, edge.startTime || edge.startDate || '');
  updateTimeRange(item, edge.endTime || edge.endDate || '');
}

function updateTimeRange(item: SummaryAnalysisItem, rawTime: string): void {
  const time = rawTime.trim();
  if (!time) return;
  item.startTime = item.startTime ? minText(item.startTime, time) : time;
  item.endTime = item.endTime ? maxText(item.endTime, time) : time;
}

function resolveNodeAccountText(node: CaseGraphNode): string {
  const values = [
    node.accountId,
    node.tradeCard,
    ...(node.accounts ?? []).flatMap((account) => [account.accountId, account.tradeCard]),
  ].map((value) => String(value || '').trim()).filter(Boolean);
  return uniqueTextList(values).join('、');
}

function uniqueTextList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function finiteNumber(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function endOfDay(value: string): string {
  return value.length === 10 ? `${value} 23:59:59` : value;
}

function minText(left: string, right: string): string {
  return left <= right ? left : right;
}

function maxText(left: string, right: string): string {
  return left >= right ? left : right;
}

function formatAmount(value: number): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function formatSignedAmount(value: number): string {
  const abs = formatAmount(Math.abs(value));
  return value > 0 ? `+${abs}` : value < 0 ? `-${abs}` : '0';
}

function formatAmountRange(minAmount: number | null, maxAmount: number | null): string {
  if (minAmount == null && maxAmount == null) return '-';
  if (minAmount === maxAmount) return `${formatAmount(minAmount ?? 0)} 元`;
  return `${formatAmount(minAmount ?? 0)} - ${formatAmount(maxAmount ?? 0)} 元`;
}

function formatTimeRange(startTime: string, endTime: string): string {
  if (!startTime && !endTime) return '-';
  if (startTime === endTime) return compactTime(startTime);
  return `${compactTime(startTime)} 至 ${compactTime(endTime)}`;
}

function compactTime(value: string): string {
  return value ? value.slice(0, 16) : '-';
}

function SelectionCheckbox({
  ariaLabel,
  checked,
  disabled,
  indeterminate,
  onChange,
}: {
  ariaLabel: string;
  checked: boolean;
  disabled?: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = Boolean(indeterminate);
    }
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}
