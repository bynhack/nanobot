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
import type { CaseGraphTargetDetailItem, CaseGraphTargetDetailResult } from './types';

export interface EdgeDetailPartyContext {
  payerName?: string;
  payeeName?: string;
}

interface EdgeDetailDrawerProps {
  detail: CaseGraphTargetDetailResult | null;
  loading: boolean;
  open: boolean;
  selectedTradeIds: string[];
  excludedTradeIds?: string[];
  applying: boolean;
  onToggleTrade: (tradeId: string) => void;
  onToggleTrades: (tradeIds: string[], selected: boolean) => void;
  onApplyExclude: () => void;
  onExcludeTrades?: (tradeIds: string[]) => void;
  onRestoreExcludedTrades?: (tradeIds: string[]) => void;
  onClose: () => void;
  partyContext?: EdgeDetailPartyContext | null;
}

type EdgeDetailSortKey = 'payer' | 'payee' | 'amount' | 'time';

export function EdgeDetailDrawer({
  detail,
  loading,
  open,
  selectedTradeIds,
  excludedTradeIds = [],
  applying,
  onToggleTrade,
  onToggleTrades,
  onApplyExclude,
  onExcludeTrades,
  onRestoreExcludedTrades,
  onClose,
  partyContext,
}: EdgeDetailDrawerProps) {
  const [keyword, setKeyword] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [sortState, setSortState] = useState<SortState<EdgeDetailSortKey> | null>(null);

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

  const filteredDetail = useMemo(
    () => filterEdgeDetailItems(detail ?? [], { keyword, minAmount, maxAmount, startTime, endTime }),
    [detail, endTime, keyword, maxAmount, minAmount, startTime],
  );
  const sortedDetail = useMemo(
    () => sortItemsByState(filteredDetail, sortState, edgeDetailSortAccessors),
    [filteredDetail, sortState],
  );
  const selectedSet = useMemo(() => new Set(selectedTradeIds), [selectedTradeIds]);
  const excludedSet = useMemo(
    () => new Set(excludedTradeIds.map((tradeId) => tradeId.trim()).filter(Boolean)),
    [excludedTradeIds],
  );
  const allTradeIds = useMemo(
    () => uniqueTradeIds((detail ?? []).map(resolveEdgeDetailTradeKey)),
    [detail],
  );
  const filteredTradeIds = useMemo(
    () => uniqueTradeIds(filteredDetail.map(resolveEdgeDetailTradeKey)),
    [filteredDetail],
  );
  const activeTradeIds = useMemo(
    () => allTradeIds.filter((tradeId) => !excludedSet.has(tradeId)),
    [allTradeIds, excludedSet],
  );
  const activeFilteredTradeIds = useMemo(
    () => filteredTradeIds.filter((tradeId) => !excludedSet.has(tradeId)),
    [excludedSet, filteredTradeIds],
  );
  const excludedInDetailCount = allTradeIds.filter((tradeId) => excludedSet.has(tradeId)).length;
  const selectedInDetailCount = activeTradeIds.filter((tradeId) => selectedSet.has(tradeId)).length;
  const selectedFilteredCount = activeFilteredTradeIds.filter((tradeId) => selectedSet.has(tradeId)).length;
  const allFilteredSelected = activeFilteredTradeIds.length > 0 && selectedFilteredCount === activeFilteredTradeIds.length;
  const someFilteredSelected = selectedFilteredCount > 0 && selectedFilteredCount < activeFilteredTradeIds.length;

  if (!open) {
    return null;
  }

  const summary = buildSummary(detail, partyContext);

  return (
    <div className="case-graph-modal-mask case-graph-modal-mask--detail" role="presentation" onClick={onClose}>
      <section
        className="case-graph-edge-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label="交易线详情"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="case-graph-edge-detail-header">
          <h2>交易线详情</h2>
          <button type="button" className="case-graph-edge-detail-close" onClick={onClose} aria-label="关闭交易线详情">
            <X size={20} />
          </button>
        </div>

        {loading ? <div className="case-graph-empty">正在加载线详情...</div> : null}

        {!loading && summary ? (
          <div className="case-graph-edge-detail-body">
            <section className="case-graph-edge-detail-section">
              <h3>交易汇总</h3>
              <dl className="case-graph-edge-summary-grid">
                <div>
                  <dt>付款方</dt>
                  <dd>{summary.payer.name}</dd>
                </div>
                <div>
                  <dt>收款方</dt>
                  <dd>{summary.payee.name}</dd>
                </div>
                <div>
                  <dt>交易次数</dt>
                  <dd>{summary.tradeCount} 次</dd>
                </div>
                <div>
                  <dt>交易金额</dt>
                  <dd>{formatSummaryAmount(summary.tradeAmount)} 元</dd>
                </div>
                <div>
                  <dt>最早交易</dt>
                  <dd>{summary.earliestTradeTime || '-'}</dd>
                </div>
                <div>
                  <dt>最晚交易</dt>
                  <dd>{summary.latestTradeTime || '-'}</dd>
                </div>
              </dl>
            </section>

            <section className="case-graph-edge-detail-section case-graph-edge-detail-section--table">
              <h3>交易明细</h3>
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
                <span>当前结果 {filteredTradeIds.length} 笔，已勾选排除 {selectedFilteredCount} 笔，已排除 {excludedInDetailCount} 笔</span>
                <button
                  type="button"
                  disabled={!activeFilteredTradeIds.length || allFilteredSelected}
                  onClick={() => onToggleTrades(activeFilteredTradeIds, true)}
                >
                  全选当前结果
                </button>
                <button
                  type="button"
                  disabled={!selectedFilteredCount}
                  onClick={() => onToggleTrades(activeFilteredTradeIds, false)}
                >
                  清空当前结果
                </button>
              </div>

              <div className="case-graph-edge-table-wrap">
                {filteredDetail.length ? (
                  <table className="case-graph-edge-table case-graph-edge-table--selectable">
                    <thead>
                      <tr>
                        <th>
                          <SelectionCheckbox
                            ariaLabel="全选当前结果交易流水"
                            checked={allFilteredSelected}
                            disabled={!activeFilteredTradeIds.length}
                            indeterminate={someFilteredSelected}
                            onChange={(checked) => onToggleTrades(activeFilteredTradeIds, checked)}
                          />
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
                        <th>状态</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedDetail.map((item, index) => {
                        const tradeId = resolveEdgeDetailTradeKey(item);
                        const excluded = Boolean(tradeId && excludedSet.has(tradeId));
                        const checked = selectedSet.has(tradeId);
                        return (
                          <tr key={`${tradeId || 'edge'}-${index}`} className={`${checked ? 'is-selected' : ''} ${excluded ? 'is-excluded' : ''}`.trim()}>
                            <td>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!tradeId || excluded}
                                onChange={() => tradeId && onToggleTrade(tradeId)}
                                aria-label="排除交易流水"
                              />
                            </td>
                            <td>{renderPartyCell(resolveEdgeDetailParty(item, 'payer', partyContext))}</td>
                            <td>{renderPartyCell(resolveEdgeDetailParty(item, 'payee', partyContext))}</td>
                            <td>{formatRowAmount(item.tradeAmount)}</td>
                            <td>{item.tradeTime || '-'}</td>
                            <td>
                              {excluded ? (
                                <span className="case-graph-edge-row-status is-excluded">已排除</span>
                              ) : (
                                <span className="case-graph-edge-row-status">保留中</span>
                              )}
                            </td>
                            <td>
                              {excluded && tradeId ? (
                                <button
                                  type="button"
                                  className="case-graph-secondary-button case-graph-edge-row-action"
                                  disabled={applying}
                                  onClick={() => onRestoreExcludedTrades?.([tradeId])}
                                >
                                  恢复
                                </button>
                              ) : tradeId ? (
                                <button
                                  type="button"
                                  className="case-graph-secondary-button case-graph-edge-row-action case-graph-edge-row-action--danger"
                                  disabled={applying}
                                  onClick={() => onExcludeTrades?.([tradeId])}
                                >
                                  排除
                                </button>
                              ) : (
                                <span className="case-graph-edge-row-muted">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="case-graph-empty">
                    <FileSearch size={18} />
                    <span>当前筛选条件下没有交易明细。</span>
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : null}

        {!loading && !detail?.length ? (
          <div className="case-graph-empty">
            <FileSearch size={18} />
            <span>这条交易线暂时没有可展示的明细。</span>
          </div>
        ) : null}

        {!loading && detail?.length ? (
          <footer className="case-graph-detail-analysis-footer">
            <span>本线已勾选排除 {selectedInDetailCount} / {activeTradeIds.length} 笔交易，已排除 {excludedInDetailCount} 笔</span>
            <button type="button" className="case-graph-secondary-button" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="case-graph-primary-button"
              disabled={applying || !selectedInDetailCount}
              onClick={onApplyExclude}
            >
              <Check size={14} />
              <span>{applying ? '应用中' : '应用到图'}</span>
            </button>
          </footer>
        ) : null}
      </section>
    </div>
  );
}

const edgeDetailSortAccessors: SortAccessors<CaseGraphTargetDetailItem, EdgeDetailSortKey> = {
  payer: (item) => [item.payerAccountName, item.payerTradeCard],
  payee: (item) => [item.payeeAccountName, item.payeeTradeCard],
  amount: (item) => Number(item.tradeAmount || 0),
  time: (item) => item.tradeTime,
};

export function resolveEdgeDetailTradeKey(item: CaseGraphTargetDetailItem): string {
  return String(item.tradeId ?? item.serialNumber ?? '').trim();
}

export function filterEdgeDetailItemsForGraphEdge(
  detail: CaseGraphTargetDetailResult,
  edgeTradeIds: string[] | undefined,
  excludedTradeIds: string[],
): CaseGraphTargetDetailResult {
  const currentEdgeTradeIds = new Set((edgeTradeIds ?? []).map((value) => String(value || '').trim()).filter(Boolean));
  const excludedSet = new Set(excludedTradeIds.map((value) => String(value || '').trim()).filter(Boolean));

  return detail.filter((item) => {
    const tradeId = resolveEdgeDetailTradeKey(item);
    if (currentEdgeTradeIds.size > 0) {
      return Boolean(tradeId && (currentEdgeTradeIds.has(tradeId) || excludedSet.has(tradeId)));
    }
    return true;
  });
}

export function filterEdgeDetailItems(
  items: CaseGraphTargetDetailResult,
  filters: { keyword: string; minAmount: string; maxAmount: string; startTime: string; endTime: string },
): CaseGraphTargetDetailResult {
  const keyword = filters.keyword.trim().toLowerCase();
  const minAmount = parseOptionalNumber(filters.minAmount);
  const maxAmount = parseOptionalNumber(filters.maxAmount);

  return items.filter((item) => {
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
    ].some((value) => String(value ?? '').toLowerCase().includes(keyword));
  });
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

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface ResolvedEdgeParty {
  name: string;
  account: string;
}

function renderPartyCell(party: { name: string; account: string }) {
  const title = party.account && party.account !== party.name ? `${party.name} ${party.account}` : party.name;
  return (
    <span className="case-graph-edge-party-cell" title={title}>
      <span className="case-graph-edge-party-name">{party.name}</span>
      {party.account && party.account !== party.name ? (
        <span className="case-graph-edge-party-raw">{party.account}</span>
      ) : null}
    </span>
  );
}

export function buildEdgeDetailSummaryForTest(
  detail: CaseGraphTargetDetailResult | null,
  partyContext?: EdgeDetailPartyContext | null,
) {
  return buildSummary(detail, partyContext);
}

function buildSummary(detail: CaseGraphTargetDetailResult | null, partyContext?: EdgeDetailPartyContext | null) {
  const items = detail ?? [];
  if (!items.length) {
    return null;
  }

  let tradeAmount = 0;
  let earliestTradeTime: string | null = null;
  let latestTradeTime: string | null = null;

  for (const item of items) {
    tradeAmount += Number(item.tradeAmount || 0);
    if (item.tradeTime) {
      if (!earliestTradeTime || item.tradeTime < earliestTradeTime) {
        earliestTradeTime = item.tradeTime;
      }
      if (!latestTradeTime || item.tradeTime > latestTradeTime) {
        latestTradeTime = item.tradeTime;
      }
    }
  }

  return {
    payer: resolveSummaryParty(items, 'payer', partyContext),
    payee: resolveSummaryParty(items, 'payee', partyContext),
    tradeCount: items.length,
    tradeAmount,
    earliestTradeTime,
    latestTradeTime,
  };
}

export function resolveEdgeDetailParty(
  item: CaseGraphTargetDetailItem,
  side: 'payer' | 'payee',
  partyContext?: EdgeDetailPartyContext | null,
): ResolvedEdgeParty {
  if (side === 'payer') {
    const fallbackName = item.payerAccountName || item.payerTradeCard || '-';
    const account = item.payerTradeCard || '';
    return {
      name: normalizePartyName(partyContext?.payerName) || fallbackName,
      account,
    };
  }
  const fallbackName = item.payeeAccountName || item.payeeTradeCard || '-';
  const account = item.payeeTradeCard || '';
  return {
    name: normalizePartyName(partyContext?.payeeName) || fallbackName,
    account,
  };
}

function resolveSummaryParty(
  items: CaseGraphTargetDetailResult,
  side: 'payer' | 'payee',
  partyContext?: EdgeDetailPartyContext | null,
): ResolvedEdgeParty {
  const first = items[0];
  const firstParty = resolveEdgeDetailParty(first, side, partyContext);
  return {
    name: firstParty.name,
    account: summarizeAccounts(items.map((item) => resolveEdgeDetailParty(item, side, partyContext).account)),
  };
}

function summarizeAccounts(accounts: string[]): string {
  const uniqueAccounts = Array.from(new Set(accounts.map((item) => item.trim()).filter(Boolean)));
  if (uniqueAccounts.length <= 1) {
    return uniqueAccounts[0] || '';
  }
  return uniqueAccounts.join('、');
}

function normalizePartyName(value: string | undefined): string {
  return String(value || '').trim();
}

function formatSummaryAmount(value: number): string {
  return Number(value || 0).toFixed(2);
}

function formatRowAmount(value: number): string {
  const amount = Number(value || 0);
  if (Number.isInteger(amount)) {
    return String(amount);
  }
  return amount.toFixed(2);
}
