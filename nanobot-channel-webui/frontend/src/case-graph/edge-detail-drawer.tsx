import { FileSearch, X } from 'lucide-react';

import type { CaseGraphTargetDetailItem, CaseGraphTargetDetailResult } from './types';

interface EdgeDetailDrawerProps {
  detail: CaseGraphTargetDetailResult | null;
  loading: boolean;
  open: boolean;
  onClose: () => void;
}

export function EdgeDetailDrawer({ detail, loading, open, onClose }: EdgeDetailDrawerProps) {
  if (!open) {
    return null;
  }

  const summary = buildSummary(detail);

  return (
    <div className="case-graph-modal-mask case-graph-modal-mask--detail" role="presentation" onClick={onClose}>
      <aside className="case-graph-edge-detail-modal" aria-label="交易线详情" onClick={(event) => event.stopPropagation()}>
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
                  <dd>{summary.payer}</dd>
                </div>
                <div>
                  <dt>收款方</dt>
                  <dd>{summary.payee}</dd>
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
                    {detail!.map((item, index) => (
                      <tr key={`${item.tradeId || item.serialNumber || 'edge'}-${index}`}>
                        <td>{resolvePartyName(item, 'payer')}</td>
                        <td>{resolvePartyName(item, 'payee')}</td>
                        <td>{formatRowAmount(item.tradeAmount)}</td>
                        <td>{item.tradeTime || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
      </aside>
    </div>
  );
}

function buildSummary(detail: CaseGraphTargetDetailResult | null) {
  const items = detail ?? [];
  if (!items.length) {
    return null;
  }

  const first = items[0];
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
    payer: resolvePartyName(first, 'payer'),
    payee: resolvePartyName(first, 'payee'),
    tradeCount: items.length,
    tradeAmount,
    earliestTradeTime,
    latestTradeTime,
  };
}

function resolvePartyName(item: CaseGraphTargetDetailItem, side: 'payer' | 'payee'): string {
  if (side === 'payer') {
    return item.payerAccountName || item.payerTradeCard || '-';
  }
  return item.payeeAccountName || item.payeeTradeCard || '-';
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
