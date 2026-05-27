import { Check, FileSearch, Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  SortableColumnHeader,
  sortItemsByState,
  sortableHeaderAria,
  type SortAccessors,
  type SortState,
} from './sortable-table';
import { CaseGraphDateInput } from './date-input';
import type { CaseGraphMoneyEdge, CaseGraphNode, CaseGraphTargetDetailItem, CaseGraphTargetDetailResult } from './types';

export interface NodeDetailAnalysisRelation {
  edge: CaseGraphMoneyEdge;
  edgeId: string;
  counterpartyName: string;
  direction: 'in' | 'out';
}

interface NodeDetailAnalysisDrawerProps {
  open: boolean;
  node: CaseGraphNode | null;
  relationships: NodeDetailAnalysisRelation[];
  detailByEdgeId: Record<string, CaseGraphTargetDetailResult>;
  loadingEdgeIds: Record<string, boolean>;
  selectedTradeIds: string[];
  applying: boolean;
  onLoadRelation: (relation: NodeDetailAnalysisRelation) => void;
  onToggleTrade: (tradeId: string) => void;
  onToggleTrades: (tradeIds: string[], selected: boolean) => void;
  onApply: () => void;
  onClose: () => void;
}

type DetailSortKey = 'direction' | 'counterparty' | 'payer' | 'payee' | 'amount' | 'time' | 'abstract';

interface NodeDetailAnalysisRow {
  relation: NodeDetailAnalysisRelation;
  item: CaseGraphTargetDetailItem;
  tradeId: string;
}

export function NodeDetailAnalysisDrawer({
  open,
  node,
  relationships,
  detailByEdgeId,
  loadingEdgeIds,
  selectedTradeIds,
  applying,
  onLoadRelation,
  onToggleTrade,
  onToggleTrades,
  onApply,
  onClose,
}: NodeDetailAnalysisDrawerProps) {
  const [keyword, setKeyword] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [sortState, setSortState] = useState<SortState<DetailSortKey> | null>(null);

  useEffect(() => {
    if (!open) {
      setKeyword('');
      setMinAmount('');
      setMaxAmount('');
      setStartTime('');
      setEndTime('');
      setSortState(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    for (const relation of relationships) {
      if (!detailByEdgeId[relation.edgeId] && !loadingEdgeIds[relation.edgeId]) {
        onLoadRelation(relation);
      }
    }
  }, [detailByEdgeId, loadingEdgeIds, onLoadRelation, open, relationships]);

  const selectedSet = useMemo(() => new Set(selectedTradeIds), [selectedTradeIds]);
  const detailRows = useMemo(
    () => relationships.flatMap((relation) => (detailByEdgeId[relation.edgeId] ?? []).map((item) => ({
      relation,
      item,
      tradeId: resolveTradeFactKey(item),
    }))),
    [detailByEdgeId, relationships],
  );
  const filteredRows = useMemo(
    () => filterDetailRows(detailRows, { keyword, minAmount, maxAmount, startTime, endTime }),
    [detailRows, endTime, keyword, maxAmount, minAmount, startTime],
  );
  const sortedRows = useMemo(
    () => sortItemsByState(filteredRows, sortState, detailSortAccessors),
    [filteredRows, sortState],
  );
  const filteredTradeIds = useMemo(
    () => uniqueTradeIds(filteredRows.map((row) => row.tradeId)),
    [filteredRows],
  );
  const selectedFilteredCount = filteredTradeIds.filter((tradeId) => selectedSet.has(tradeId)).length;
  const allFilteredSelected = filteredTradeIds.length > 0 && selectedFilteredCount === filteredTradeIds.length;
  const someFilteredSelected = selectedFilteredCount > 0 && selectedFilteredCount < filteredTradeIds.length;
  const loadingAny = relationships.some((relation) => loadingEdgeIds[relation.edgeId]);

  if (!open) {
    return null;
  }

  const title = node?.label || node?.accountName || node?.name || node?.tradeCard || node?.id || '节点';
  const subtitle = `${title} · ${relationships.length} 条关联线${detailRows.length ? ` · 已载入 ${detailRows.length} 笔交易` : ''}`;

  return (
    <div className="case-graph-modal-mask case-graph-modal-mask--detail" role="presentation" onClick={onClose}>
      <section
        className="case-graph-detail-analysis-modal"
        role="dialog"
        aria-modal="true"
        aria-label="交易核查"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="case-graph-edge-detail-header">
          <div className="case-graph-detail-analysis-title">
            <h2>交易核查</h2>
            <span>{subtitle}</span>
          </div>
          <button type="button" className="case-graph-edge-detail-close" onClick={onClose} aria-label="关闭交易核查">
            <X size={20} />
          </button>
        </div>

        <div className="case-graph-detail-analysis-body">
          <main className="case-graph-detail-analysis-main">
            <div className="case-graph-detail-analysis-toolbar">
              <input
                type="search"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="姓名、卡号、流水号、摘要"
              />
              <input
                type="number"
                min="0"
                value={minAmount}
                onChange={(event) => setMinAmount(event.target.value)}
                placeholder="最小金额"
              />
              <input
                type="number"
                min="0"
                value={maxAmount}
                onChange={(event) => setMaxAmount(event.target.value)}
                placeholder="最大金额"
              />
              <CaseGraphDateInput
                value={startTime}
                onChange={setStartTime}
                ariaLabel="开始日期"
                placeholder="开始日期"
              />
              <CaseGraphDateInput
                value={endTime}
                onChange={setEndTime}
                ariaLabel="结束日期"
                placeholder="结束日期"
              />
            </div>

            <div className="case-graph-detail-analysis-selection-tools">
              <span>
                当前结果 {filteredTradeIds.length} 笔，已勾选 {selectedFilteredCount} 笔
                {loadingAny ? '，正在加载关联交易' : ''}
              </span>
              <button
                type="button"
                disabled={!filteredTradeIds.length || allFilteredSelected}
                onClick={() => onToggleTrades(filteredTradeIds, true)}
              >
                全选当前结果
              </button>
              <button
                type="button"
                disabled={!selectedFilteredCount}
                onClick={() => onToggleTrades(filteredTradeIds, false)}
              >
                清空当前结果
              </button>
            </div>

            <div className="case-graph-detail-analysis-table-wrap">
              {loadingAny && !detailRows.length ? (
                <div className="case-graph-empty">
                  <Loader2 className="case-graph-spin" size={18} />
                  <span>正在加载交易明细...</span>
                </div>
              ) : null}

              {!loadingAny && !detailRows.length ? (
                <div className="case-graph-empty">
                  <FileSearch size={18} />
                  <span>当前关联线没有可筛选的交易明细。</span>
                </div>
              ) : null}

              {filteredRows.length ? (
                <table className="case-graph-edge-table case-graph-detail-analysis-table">
                  <thead>
                    <tr>
                      <th>
                        <SelectionCheckbox
                          ariaLabel="全选当前结果交易流水"
                          checked={allFilteredSelected}
                          disabled={!filteredTradeIds.length}
                          indeterminate={someFilteredSelected}
                          onChange={(checked) => onToggleTrades(filteredTradeIds, checked)}
                        />
                      </th>
                      <th aria-sort={sortableHeaderAria(sortState, 'direction')}>
                        <SortableColumnHeader label="方向" sortKey="direction" sortState={sortState} onSortChange={setSortState} />
                      </th>
                      <th aria-sort={sortableHeaderAria(sortState, 'counterparty')}>
                        <SortableColumnHeader label="关联主体" sortKey="counterparty" sortState={sortState} onSortChange={setSortState} />
                      </th>
                      <th aria-sort={sortableHeaderAria(sortState, 'payer')}>
                        <SortableColumnHeader label="付款方" sortKey="payer" sortState={sortState} onSortChange={setSortState} />
                      </th>
                      <th aria-sort={sortableHeaderAria(sortState, 'payee')}>
                        <SortableColumnHeader label="收款方" sortKey="payee" sortState={sortState} onSortChange={setSortState} />
                      </th>
                      <th aria-sort={sortableHeaderAria(sortState, 'amount')}>
                        <SortableColumnHeader label="交易金额" sortKey="amount" sortState={sortState} defaultDirection="desc" onSortChange={setSortState} />
                      </th>
                      <th aria-sort={sortableHeaderAria(sortState, 'time')}>
                        <SortableColumnHeader label="交易时间" sortKey="time" sortState={sortState} defaultDirection="desc" onSortChange={setSortState} />
                      </th>
                      <th aria-sort={sortableHeaderAria(sortState, 'abstract')}>
                        <SortableColumnHeader label="摘要" sortKey="abstract" sortState={sortState} onSortChange={setSortState} />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row, index) => {
                      const { item, relation, tradeId } = row;
                      const checked = selectedSet.has(tradeId);
                      return (
                        <tr key={`${tradeId || 'trade'}-${index}`} className={checked ? 'is-selected' : ''}>
                          <td>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!tradeId}
                              onChange={() => tradeId && onToggleTrade(tradeId)}
                              aria-label="排除交易流水"
                            />
                          </td>
                          <td>
                            <span className={`case-graph-detail-analysis-direction is-${relation.direction}`}>
                              {relation.direction === 'in' ? '来款' : '去向'}
                            </span>
                          </td>
                          <td>{relation.counterpartyName}</td>
                          <td>{renderParty(item.payerAccountName, item.payerTradeCard)}</td>
                          <td>{renderParty(item.payeeAccountName, item.payeeTradeCard)}</td>
                          <td>{formatAmount(item.tradeAmount)}</td>
                          <td>{item.tradeTime || '-'}</td>
                          <td>{item.tradeAbstract || '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : null}

              {detailRows.length && !filteredRows.length ? (
                <div className="case-graph-empty">
                  <FileSearch size={18} />
                  <span>当前筛选条件下没有交易明细。</span>
                </div>
              ) : null}
            </div>
          </main>
        </div>

        <footer className="case-graph-detail-analysis-footer">
          <span>本次核查已勾选排除 {selectedTradeIds.length} 笔交易</span>
          <button type="button" className="case-graph-secondary-button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="case-graph-primary-button"
            disabled={applying || !selectedTradeIds.length}
            onClick={onApply}
          >
            <Check size={14} />
            <span>{applying ? '应用中' : '应用到图'}</span>
          </button>
        </footer>
      </section>
    </div>
  );
}

const detailSortAccessors: SortAccessors<NodeDetailAnalysisRow, DetailSortKey> = {
  direction: (row) => (row.relation.direction === 'in' ? '来款' : '去向'),
  counterparty: (row) => row.relation.counterpartyName,
  payer: (row) => [row.item.payerAccountName, row.item.payerTradeCard],
  payee: (row) => [row.item.payeeAccountName, row.item.payeeTradeCard],
  amount: (row) => Number(row.item.tradeAmount || 0),
  time: (row) => row.item.tradeTime,
  abstract: (row) => row.item.tradeAbstract,
};

export function resolveTradeFactKey(item: CaseGraphTargetDetailItem): string {
  return String(item.tradeId ?? item.serialNumber ?? '').trim();
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
  const ref = useRef<HTMLInputElement>(null);
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
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
  );
}

function uniqueTradeIds(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function filterDetailRows(
  rows: NodeDetailAnalysisRow[],
  filters: { keyword: string; minAmount: string; maxAmount: string; startTime: string; endTime: string },
): NodeDetailAnalysisRow[] {
  const keyword = filters.keyword.trim().toLowerCase();
  const minAmount = parseOptionalNumber(filters.minAmount);
  const maxAmount = parseOptionalNumber(filters.maxAmount);
  return rows.filter((row) => {
    const { item, relation } = row;
    const amount = Number(item.tradeAmount || 0);
    if (minAmount !== null && amount < minAmount) return false;
    if (maxAmount !== null && amount > maxAmount) return false;
    const tradeTime = String(item.tradeTime || '');
    if (filters.startTime && tradeTime.slice(0, 10) < filters.startTime) return false;
    if (filters.endTime && tradeTime.slice(0, 10) > filters.endTime) return false;
    if (!keyword) return true;
    return [
      item.tradeId,
      item.serialNumber,
      item.tradeAbstract,
      item.payerAccountName,
      item.payerTradeCard,
      item.payeeAccountName,
      item.payeeTradeCard,
      relation.counterpartyName,
      relation.direction === 'in' ? '来款' : '去向',
    ].some((value) => String(value ?? '').toLowerCase().includes(keyword));
  });
}

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatAmount(value: unknown): string {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return '0';
  return amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function renderParty(name: string, card: string) {
  return (
    <span className="case-graph-edge-party-cell">
      <span className="case-graph-edge-party-name">{name || card || '-'}</span>
      {card && card !== name ? <span className="case-graph-edge-party-raw">{card}</span> : null}
    </span>
  );
}
