import { Check, FileSearch, FileText } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Modal } from '../components/ui/modal';
import { Select } from '../components/ui/select';
import {
  SortableColumnHeader,
  sortItemsByState,
  sortableHeaderAria,
  type SortAccessors,
  type SortState,
} from './sortable-table';
import { CaseGraphDateInput } from './date-input';
import { OperationEvidenceFields } from './operation-evidence-fields';
import type { CaseGraphData, CaseGraphNode, CaseGraphOperationEvidence, CaseGraphTradeFact } from './types';

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

export type SummaryAnalysisItemAction = 'add' | 'exclude' | 'restore';

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
  onApplyItemAction: (nodeId: string, action: SummaryAnalysisItemAction) => void;
  evidence: CaseGraphOperationEvidence;
  onEvidenceChange: (evidence: CaseGraphOperationEvidence) => void;
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
type SummaryStatusFilter = 'all' | 'candidate' | 'on_graph' | 'excluded';

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
  onApplyItemAction,
  evidence,
  onEvidenceChange,
  onClose,
}: SummaryAnalysisDrawerProps) {
  const [filters, setFilters] = useState<SummaryAnalysisFilters>(emptySummaryFilters);
  const [sortState, setSortState] = useState<SortState<SummarySortKey> | null>(null);
  const [statusFilter, setStatusFilter] = useState<SummaryStatusFilter>('all');
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const evidencePopoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      setFilters(emptySummaryFilters());
      setSortState(null);
      setStatusFilter('all');
      setEvidenceOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!evidenceOpen) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (evidencePopoverRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('.app-select-menu')) return;
      setEvidenceOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEvidenceOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [evidenceOpen]);

  const statusCounts = useMemo(() => countSummaryStatuses(items), [items]);
  const selectedSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const filteredItems = useMemo(() => {
    const byFormFilters = filterSummaryAnalysisItems(items, filters);
    if (statusFilter === 'all') return byFormFilters;
    return byFormFilters.filter((item) => summaryItemStatus(item) === statusFilter);
  }, [filters, items, statusFilter]);
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
  const selectedActionCounts = useMemo(() => countSummaryStatuses(items.filter((item) => selectedSet.has(item.nodeId))), [items, selectedSet]);

  if (!open) {
    return null;
  }

  const isGlobalScope = scope === 'global';
  const title = node?.label || node?.accountName || node?.name || node?.tradeCard || node?.id || '全图';

  return (
    <Modal
      open={open}
      title="综合筛选"
      description={isGlobalScope ? `全图综合查询 · 主体 ${items.length} 个` : `${title} · 可加入或排除的主体 ${items.length} 个`}
      onClose={onClose}
      size="full"
      className="case-graph-summary-analysis-modal"
      bodyClassName="case-graph-detail-modal-body"
      footerClassName="case-graph-summary-analysis-footer"
      footer={(
        <>
          <span>{buildSummaryFooterText(selectedTotalCount, selectedActionCounts)}</span>
          <div className="case-graph-summary-analysis-footer-actions">
            <div className="case-graph-summary-evidence-anchor" ref={evidencePopoverRef}>
              <button
                type="button"
                className={`case-graph-summary-evidence-trigger${evidence.reasonLabel ? ' is-complete' : ''}`}
                aria-expanded={evidenceOpen}
                onClick={() => setEvidenceOpen((current) => !current)}
              >
                <FileText size={14} />
                <span>{evidence.reasonLabel ? `依据：${evidence.reasonLabel}` : '操作依据（选填）'}</span>
              </button>
              {evidenceOpen ? (
                <div className="case-graph-summary-evidence-popover">
                  <OperationEvidenceFields
                    operation="candidate_subject_changes"
                    value={evidence}
                    onChange={onEvidenceChange}
                    alwaysExpanded
                  />
                  <div className="case-graph-summary-evidence-popover-actions">
                    {evidence.reasonCode || evidence.note ? (
                      <button type="button" onClick={() => onEvidenceChange({ level: 'optional' })}>清空</button>
                    ) : <span />}
                    <button type="button" className="is-primary" onClick={() => setEvidenceOpen(false)}>完成</button>
                  </div>
                </div>
              ) : null}
            </div>
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
              <span>{applying ? '处理中' : '应用到图'}</span>
            </button>
          </div>
        </>
      )}
    >

        <div className="case-graph-summary-analysis-body">
          <div className="case-graph-summary-status-tabs" aria-label="按上图状态筛选主体">
            {SUMMARY_STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={statusFilter === filter.value ? 'is-active' : ''}
                onClick={() => setStatusFilter(filter.value)}
              >
                <span>{filter.label}</span>
                <strong>{statusCountForFilter(statusCounts, filter.value)}</strong>
              </button>
            ))}
          </div>

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
            <Select
              value={filters.direction}
              ariaLabel="资金方向"
              options={[
                { value: 'all', label: '全部方向' },
                { value: 'in', label: '只看来款' },
                { value: 'out', label: '只看去向' },
              ]}
              onChange={(value) => setFilters((current) => ({ ...current, direction: value as SummaryAnalysisFilters['direction'] }))}
            />
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
                <span>{isGlobalScope ? '正在从案件交易流水中筛选主体。' : '正在从案件交易流水中筛选关联主体。'}</span>
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
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((item) => {
                    const checked = selectedSet.has(item.nodeId);
                    const status = summaryItemStatus(item);
                    const action = summaryActionForStatus(status);
                    return (
                      <tr key={item.nodeId} className={`${checked ? 'is-selected' : ''} is-${status}`}>
                        <td>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onToggleNode(item.nodeId)}
                            aria-label="选择主体"
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
                        <td><span className={`case-graph-summary-status is-${status}`}>{formatSummaryStatus(item)}</span></td>
                        <td>
                          <button
                            type="button"
                            className={`case-graph-secondary-button case-graph-summary-row-action${action === 'exclude' ? ' case-graph-summary-row-action--danger' : ''}`}
                            disabled={applying}
                            onClick={() => onApplyItemAction(item.nodeId, action)}
                          >
                            {summaryActionLabel(action)}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="case-graph-empty">
                <FileSearch size={18} />
                <span>{isGlobalScope ? '当前筛选条件下没有可处理的主体。' : '当前筛选条件下没有关联主体。'}</span>
              </div>
            )}
          </div>
        </div>

    </Modal>
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

const SUMMARY_STATUS_FILTERS: Array<{ value: SummaryStatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'on_graph', label: '已上图' },
  { value: 'candidate', label: '未上图' },
  { value: 'excluded', label: '已取消' },
];

function summaryItemStatus(item: SummaryAnalysisItem): Exclude<SummaryStatusFilter, 'all'> {
  if (item.status === 'excluded' || item.isExcluded) return 'excluded';
  if (item.status === 'on_graph' || item.isOnGraph) return 'on_graph';
  return 'candidate';
}

function formatSummaryStatus(item: SummaryAnalysisItem): string {
  const status = summaryItemStatus(item);
  if (status === 'excluded') return '已取消上图';
  if (status === 'on_graph') return '已上图';
  return '未上图';
}

function summaryStatusRank(item: SummaryAnalysisItem): number {
  const status = summaryItemStatus(item);
  if (status === 'on_graph') return 0;
  if (status === 'candidate') return 1;
  return 2;
}

function countSummaryStatuses(items: SummaryAnalysisItem[]): Record<Exclude<SummaryStatusFilter, 'all'>, number> {
  return items.reduce<Record<Exclude<SummaryStatusFilter, 'all'>, number>>((counts, item) => {
    counts[summaryItemStatus(item)] += 1;
    return counts;
  }, { candidate: 0, on_graph: 0, excluded: 0 });
}

function statusCountForFilter(counts: Record<Exclude<SummaryStatusFilter, 'all'>, number>, filter: SummaryStatusFilter): number {
  if (filter === 'all') return counts.candidate + counts.on_graph + counts.excluded;
  return counts[filter];
}

function summaryActionForStatus(status: Exclude<SummaryStatusFilter, 'all'>): SummaryAnalysisItemAction {
  if (status === 'on_graph') return 'exclude';
  if (status === 'excluded') return 'restore';
  return 'add';
}

function summaryActionLabel(action: SummaryAnalysisItemAction): string {
  if (action === 'exclude') return '取消上图';
  if (action === 'restore') return '恢复上图';
  return '加入图';
}

function buildSummaryFooterText(total: number, counts: Record<Exclude<SummaryStatusFilter, 'all'>, number>): string {
  if (!total) return '请选择需要处理的主体';
  const parts: string[] = [];
  if (counts.candidate) parts.push(`加入 ${counts.candidate} 个未上图主体`);
  if (counts.on_graph) parts.push(`取消 ${counts.on_graph} 个已上图主体`);
  if (counts.excluded) parts.push(`恢复 ${counts.excluded} 个已取消主体`);
  return parts.join('，');
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
