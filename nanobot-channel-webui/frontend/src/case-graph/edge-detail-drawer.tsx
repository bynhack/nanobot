import { FileSearch, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { CaseGraphTargetDetailItem, CaseGraphTargetDetailResult } from './types';

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50];

export interface EdgeDetailPartyContext {
  payerName?: string;
  payeeName?: string;
}

interface EdgeDetailDrawerProps {
  detail: CaseGraphTargetDetailResult | null;
  loading: boolean;
  open: boolean;
  onClose: () => void;
  partyContext?: EdgeDetailPartyContext | null;
}

export function EdgeDetailDrawer({ detail, loading, open, onClose, partyContext }: EdgeDetailDrawerProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    if (open) {
      setPage(1);
    }
  }, [detail, open]);

  const paginatedDetail = useMemo(
    () => getPaginatedEdgeDetail(detail ?? [], page, pageSize),
    [detail, page, pageSize],
  );

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

            <section className="case-graph-edge-detail-section">
              <h3>交易明细</h3>
              <div className="case-graph-edge-table-wrap">
                <table className="case-graph-edge-table">
                  <thead>
                    <tr>
                      <th>付款方</th>
                      <th>收款方</th>
                      <th>交易金额</th>
                      <th>交易时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedDetail.items.map((item, index) => (
                      <tr key={`${item.tradeId || item.serialNumber || 'edge'}-${index}`}>
                        <td>{renderPartyCell(resolveEdgeDetailParty(item, 'payer', partyContext))}</td>
                        <td>{renderPartyCell(resolveEdgeDetailParty(item, 'payee', partyContext))}</td>
                        <td>{formatRowAmount(item.tradeAmount)}</td>
                        <td>{item.tradeTime || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="case-graph-edge-pagination">
                <span>
                  共 {paginatedDetail.total} 条，第 {paginatedDetail.page} / {paginatedDetail.pageCount} 页
                </span>
                <label>
                  <span>每页</span>
                  <select
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value));
                      setPage(1);
                    }}
                  >
                    {PAGE_SIZE_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option} 条</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="case-graph-edge-page-button"
                  disabled={paginatedDetail.page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  上一页
                </button>
                <button
                  type="button"
                  className="case-graph-edge-page-button"
                  disabled={paginatedDetail.page >= paginatedDetail.pageCount}
                  onClick={() => setPage((current) => Math.min(paginatedDetail.pageCount, current + 1))}
                >
                  下一页
                </button>
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
      </section>
    </div>
  );
}

export function getPaginatedEdgeDetail(
  detail: CaseGraphTargetDetailResult,
  page: number,
  pageSize: number,
): {
  items: CaseGraphTargetDetailResult;
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
} {
  const total = detail.length;
  const normalizedPageSize = PAGE_SIZE_OPTIONS.includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / normalizedPageSize));
  const normalizedPage = Math.min(Math.max(1, page), pageCount);
  const start = (normalizedPage - 1) * normalizedPageSize;
  return {
    items: detail.slice(start, start + normalizedPageSize),
    page: normalizedPage,
    pageCount,
    pageSize: normalizedPageSize,
    total,
  };
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
