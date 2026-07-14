import { ArrowRight, GitCompareArrows, Info, Network, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Graph as G6Graph } from '@antv/g6';

import { Modal } from '../components/ui/modal';
import { Select } from '../components/ui/select';
import { formatCompactAmount } from './graph-analysis';
import { buildFundFlowView, type FundFlowEdge, type FundFlowView } from './fund-flow-analysis';
import type { CaseGraphData, CaseGraphTradeFact } from './types';

interface FundFlowModalProps {
  open: boolean;
  graphData: CaseGraphData | null;
  onClose: () => void;
}

const AMOUNT_PRESETS = [
  { value: '0', label: '不限净额' },
  { value: '10000', label: '1 万元' },
  { value: '50000', label: '5 万元' },
  { value: '100000', label: '10 万元' },
  { value: '500000', label: '50 万元' },
  { value: 'custom', label: '自定义' },
];

const STRENGTH_PRESETS = [
  { value: '0', label: '不限强度' },
  { value: '10', label: '10%' },
  { value: '20', label: '20%' },
  { value: '30', label: '30%' },
  { value: '50', label: '50%' },
  { value: 'custom', label: '自定义' },
];

const DEFAULT_AMOUNT = '10000';
const DEFAULT_STRENGTH = '20';
const FUND_FLOW_IN_PORT = 'fund-flow-in';
const FUND_FLOW_OUT_PORT = 'fund-flow-out';
const FUND_FLOW_PORTS = [
  { key: FUND_FLOW_IN_PORT, placement: 'left', r: 0, fill: 'transparent', stroke: 'transparent' },
  { key: FUND_FLOW_OUT_PORT, placement: 'right', r: 0, fill: 'transparent', stroke: 'transparent' },
];

export function FundFlowModal({ open, graphData, onClose }: FundFlowModalProps) {
  const [minNetAmount, setMinNetAmount] = useState(DEFAULT_AMOUNT);
  const [minDirectionStrength, setMinDirectionStrength] = useState(DEFAULT_STRENGTH);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const amountPreset = resolvePresetValue(minNetAmount, AMOUNT_PRESETS);
  const strengthPreset = resolvePresetValue(minDirectionStrength, STRENGTH_PRESETS);
  const view = useMemo(() => buildFundFlowView(graphData, {
    minNetAmount: parseNonNegativeNumber(minNetAmount),
    minDirectionStrength: Math.min(100, parseNonNegativeNumber(minDirectionStrength)) / 100,
  }), [graphData, minDirectionStrength, minNetAmount]);
  const selectedEdge = view.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const clearEdgeCount = view.edges.filter((edge) => edge.direction === 'clear').length;

  useEffect(() => {
    if (!open) return;
    if (selectedEdgeId && view.edges.some((edge) => edge.id === selectedEdgeId)) return;
    setSelectedEdgeId(view.edges[0]?.id ?? null);
  }, [open, selectedEdgeId, view.edges]);

  if (!open) return null;

  const resetThresholds = () => {
    setMinNetAmount(DEFAULT_AMOUNT);
    setMinDirectionStrength(DEFAULT_STRENGTH);
  };

  return (
    <Modal
      open
      size="full"
      title={(
        <span className="case-graph-fund-flow-title">
          <Network size={18} />
          <span>资金流向</span>
        </span>
      )}
      description="基于当前有效图谱中的未排除流水，按账户双向往来计算净资金方向。"
      onClose={onClose}
      className="case-graph-fund-flow-modal"
      bodyClassName="case-graph-fund-flow-modal-body"
    >
      <div className="case-graph-fund-flow-layout">
        <section className="case-graph-fund-flow-workspace">
          <div className="case-graph-fund-flow-controls" aria-label="资金流向判定阈值">
            <div className="case-graph-fund-flow-control-copy">
              <strong>方向判定阈值</strong>
              <span>阈值只决定箭头是否明确，不会隐藏双向往来关系。</span>
            </div>
            <label className="case-graph-fund-flow-field">
              <span>最小净额</span>
              <Select
                value={amountPreset}
                options={AMOUNT_PRESETS}
                ariaLabel="选择最小净额预设"
                onChange={(value) => {
                  if (value !== 'custom') setMinNetAmount(value);
                }}
              />
            </label>
            <label className="case-graph-fund-flow-field case-graph-fund-flow-field--input">
              <span>填写金额（元）</span>
              <input
                type="number"
                min="0"
                step="1000"
                value={minNetAmount}
                onChange={(event) => setMinNetAmount(event.target.value)}
              />
            </label>
            <label className="case-graph-fund-flow-field">
              <span>最小方向强度</span>
              <Select
                value={strengthPreset}
                options={STRENGTH_PRESETS}
                ariaLabel="选择方向强度预设"
                onChange={(value) => {
                  if (value !== 'custom') setMinDirectionStrength(value);
                }}
              />
            </label>
            <label className="case-graph-fund-flow-field case-graph-fund-flow-field--input">
              <span>填写强度（%）</span>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={minDirectionStrength}
                onChange={(event) => setMinDirectionStrength(event.target.value)}
              />
            </label>
            <button className="case-graph-fund-flow-reset" type="button" onClick={resetThresholds} title="恢复推荐阈值">
              <RotateCcw size={14} />
              <span>恢复推荐值</span>
            </button>
          </div>

          <div className="case-graph-fund-flow-summary">
            <span><strong>{view.nodes.length}</strong> 个主体</span>
            <span><strong>{view.edges.length}</strong> 组双向关系</span>
            <span><strong>{clearEdgeCount}</strong> 条明确方向</span>
            <span><strong>{view.referencedTradeCount}</strong> 笔有效流水</span>
            <span className="case-graph-fund-flow-formula"><Info size={13} />方向强度 = 净额 ÷ 双向总额</span>
          </div>

          <div className="case-graph-fund-flow-canvas-shell">
            {view.edges.length ? (
              <FundFlowGraph view={view} selectedEdgeId={selectedEdgeId} onSelectEdge={setSelectedEdgeId} />
            ) : (
              <div className="case-graph-fund-flow-empty">
                <Network size={26} />
                <strong>当前有效图谱暂无可计算的资金往来</strong>
                <span>请确认图上关系已关联流水事实，且相关主体和流水未被取消或排除。</span>
              </div>
            )}
          </div>
        </section>

        <FundFlowDetail edge={selectedEdge} view={view} />
      </div>
    </Modal>
  );
}

function FundFlowGraph({
  view,
  selectedEdgeId,
  onSelectEdge,
}: {
  view: FundFlowView;
  selectedEdgeId: string | null;
  onSelectEdge: (edgeId: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<G6Graph | null>(null);
  const viewRef = useRef(view);
  const onSelectEdgeRef = useRef(onSelectEdge);
  const [ready, setReady] = useState(false);

  const focusSelectedRelation = async (animation: boolean | { duration: number } = false) => {
    const graph = graphRef.current;
    const edge = viewRef.current.edges.find((item) => item.id === selectedEdgeId);
    if (!graph || !edge) return;
    await graph.focusElement(edge.source, animation);
    if (graph.getZoom() !== 0.72) {
      await graph.zoomTo(0.72, animation, graph.getCanvasCenter());
    }
  };

  useEffect(() => {
    viewRef.current = view;
    onSelectEdgeRef.current = onSelectEdge;
  }, [onSelectEdge, view]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || graphRef.current) return;
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    let createdGraph: G6Graph | null = null;

    void import('@antv/g6').then(({ EdgeEvent, Graph }) => {
      if (disposed || !hostRef.current) return;
      const currentHost = hostRef.current;
      const graph = new Graph({
        container: currentHost,
        width: currentHost.clientWidth || 900,
        height: currentHost.clientHeight || 560,
        zoomRange: [0.14, 2],
        padding: 44,
        data: toG6Data(viewRef.current),
        layout: {
          type: 'antv-dagre',
          rankdir: 'LR',
          align: 'UL',
          nodeSize: [204, 92],
          nodesep: 38,
          ranksep: 154,
          controlPoints: true,
        },
        node: {
          type: 'html',
          style: {
            size: [204, 92],
            dx: -102,
            dy: -46,
            opacity: 1,
            port: true,
            ports: FUND_FLOW_PORTS,
            innerHTML: (datum: any) => renderFundFlowNodeMarkup(datum.data),
          },
          state: {
            related: { opacity: 1, zIndex: 3 },
            muted: { opacity: 0.48 },
          },
        },
        edge: {
          type: 'cubic-horizontal',
          style: {
            stroke: (datum: any) => datum.data.direction === 'clear' ? '#2563eb' : '#d97706',
            lineWidth: (datum: any) => resolveFundFlowLineWidth(datum.data),
            lineDash: (datum: any) => datum.data.direction === 'clear' ? [] : [9, 7],
            opacity: 1,
            endArrow: (datum: any) => datum.data.direction === 'clear',
            endArrowSize: 12,
            endArrowFill: '#2563eb',
            endArrowStroke: '#ffffff',
            endArrowLineWidth: 1.4,
            sourcePort: FUND_FLOW_OUT_PORT,
            targetPort: FUND_FLOW_IN_PORT,
            cursor: 'pointer',
            labelText: (datum: any) => renderEdgeLabel(datum.data),
            labelFill: (datum: any) => datum.data.direction === 'clear' ? '#1e40af' : '#92400e',
            labelFontWeight: 700,
            labelFontSize: 12,
            labelBackground: true,
            labelBackgroundFill: (datum: any) => datum.data.direction === 'clear' ? '#eff6ff' : '#fffbeb',
            labelBackgroundStroke: (datum: any) => datum.data.direction === 'clear' ? '#bfdbfe' : '#fde68a',
            labelBackgroundLineWidth: 1,
            labelBackgroundRadius: 7,
            labelPadding: [4, 8],
          },
          state: {
            selected: {
              stroke: '#1d4ed8',
              lineWidth: 4.4,
              opacity: 1,
              halo: true,
              haloStroke: '#93c5fd',
              haloLineWidth: 8,
              haloOpacity: 0.34,
              zIndex: 5,
            },
            muted: { opacity: 0.3 },
          },
        },
        behaviors: ['drag-canvas', 'zoom-canvas'],
      });
      graph.on(EdgeEvent.CLICK, (event: any) => {
        const edgeId = String(event?.target?.id || event?.target?.get?.('id') || '').trim();
        if (edgeId) onSelectEdgeRef.current(edgeId);
      });
      createdGraph = graph;
      graphRef.current = graph;
      resizeObserver = new ResizeObserver(() => {
        const target = hostRef.current;
        if (!target || !graphRef.current) return;
        graphRef.current.setSize(target.clientWidth || 900, target.clientHeight || 560);
      });
      resizeObserver.observe(currentHost);
      void graph.render().then(() => {
        if (!disposed) setReady(true);
      });
    });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      createdGraph?.destroy();
      graphRef.current = null;
    };
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.setData(toG6Data(view));
    void graph.render().then(() => graph.fitView({ when: 'always', direction: 'both' }));
  }, [view]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !ready) return;
    const edgeIds = view.edges.map((edge) => edge.id);
    const selectedEdge = view.edges.find((edge) => edge.id === selectedEdgeId);
    const relatedNodeIds = new Set(selectedEdge ? [selectedEdge.source, selectedEdge.target] : []);
    const nodeIds = view.nodes.map((node) => node.id);
    void Promise.all([
      ...edgeIds.map((edgeId) => graph.setElementState(edgeId, edgeId === selectedEdgeId ? 'selected' : selectedEdgeId ? 'muted' : [])),
      ...nodeIds.map((nodeId) => graph.setElementState(nodeId, relatedNodeIds.has(nodeId) ? 'related' : selectedEdgeId ? 'muted' : [])),
    ]).then(() => focusSelectedRelation({ duration: 320 }));
  }, [ready, selectedEdgeId, view.edges, view.nodes]);

  return (
    <div className="case-graph-fund-flow-canvas-wrap">
      {!ready ? <div className="case-graph-fund-flow-loading">正在生成资金流向图…</div> : null}
      <div className="case-graph-fund-flow-canvas" ref={hostRef} aria-label="资金流向图" />
      <div className="case-graph-fund-flow-view-actions">
        <button type="button" disabled={!selectedEdgeId} onClick={() => void focusSelectedRelation({ duration: 280 })}>聚焦当前关系</button>
        <button type="button" onClick={() => void graphRef.current?.fitView({ when: 'always', direction: 'both' }, { duration: 280 })}>查看全图</button>
      </div>
      <div className="case-graph-fund-flow-legend">
        <span><i className="is-clear" />明确净流向</span>
        <span><i className="is-neutral" />双向往来</span>
        <span>滚轮缩放 · 拖动画布 · 点击关系查看流水</span>
      </div>
    </div>
  );
}

function FundFlowDetail({ edge, view }: { edge: FundFlowEdge | null; view: FundFlowView }) {
  const nodeById = useMemo(() => new Map(view.nodes.map((node) => [node.id, node])), [view.nodes]);
  if (!edge) {
    return (
      <aside className="case-graph-fund-flow-detail is-empty">
        <GitCompareArrows size={24} />
        <strong>选择一条资金关系</strong>
        <span>点击图中的关系线，可核对双方汇总金额、方向强度和对应原始流水。</span>
      </aside>
    );
  }

  const source = nodeById.get(edge.source);
  const target = nodeById.get(edge.target);
  return (
    <aside className="case-graph-fund-flow-detail">
      <div className="case-graph-fund-flow-detail-head">
        <span className={edge.direction === 'clear' ? 'is-clear' : 'is-neutral'}>
          {edge.direction === 'clear' ? '明确净流向' : '双向往来'}
        </span>
        <strong>{source?.label || edge.source} <ArrowRight size={14} /> {target?.label || edge.target}</strong>
        <small>方向强度 {(edge.directionStrength * 100).toFixed(1)}%</small>
      </div>
      <div className="case-graph-fund-flow-detail-metrics">
        <div>
          <span>{source?.label || '转出方'} → {target?.label || '转入方'}</span>
          <strong>{formatCompactAmount(edge.sourceToTargetAmount)} 元</strong>
          <small>{edge.sourceToTargetCount} 笔</small>
        </div>
        <div>
          <span>{target?.label || '转入方'} → {source?.label || '转出方'}</span>
          <strong>{formatCompactAmount(edge.targetToSourceAmount)} 元</strong>
          <small>{edge.targetToSourceCount} 笔</small>
        </div>
        <div className="is-net">
          <span>净流向金额</span>
          <strong>{formatCompactAmount(edge.netAmount)} 元</strong>
          <small>双向总额 {formatCompactAmount(edge.grossAmount)} 元</small>
        </div>
      </div>
      <div className="case-graph-fund-flow-trades-head">
        <strong>对应原始流水</strong>
        <span>{edge.tradeFacts.length} 笔</span>
      </div>
      <div className="case-graph-fund-flow-trades">
        <table>
          <thead><tr><th>时间</th><th>付款方</th><th>收款方</th><th>金额</th></tr></thead>
          <tbody>
            {edge.tradeFacts.map((fact, index) => (
              <tr key={fact.tradeId || `${fact.serialNumber || 'trade'}-${index}`}>
                <td>{formatTradeTime(fact.tradeTime)}</td>
                <td>{renderTradeParty(fact, 'payer')}</td>
                <td>{renderTradeParty(fact, 'payee')}</td>
                <td>{formatCompactAmount(Number(fact.tradeAmount || 0))} 元</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </aside>
  );
}

function toG6Data(view: FundFlowView) {
  return {
    nodes: view.nodes.map((node) => ({ id: node.id, data: node })),
    edges: view.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, data: edge })),
  };
}

function renderFundFlowNodeMarkup(node: FundFlowView['nodes'][number]): string {
  const flowClass = node.netAmount > 0 ? 'is-net-in' : node.netAmount < 0 ? 'is-net-out' : 'is-balanced';
  const netLabel = node.netAmount >= 0 ? '净流入' : '净流出';
  return `
    <article class="case-graph-fund-flow-node ${flowClass}">
      <header>
        <strong title="${escapeHtml(node.label)}">${escapeHtml(node.label)}</strong>
        <span>${netLabel} ${formatCompactAmount(Math.abs(node.netAmount))}</span>
      </header>
      <p title="${escapeHtml(node.identifier || '未记录账号')}">${escapeHtml(node.identifier || '未记录账号')}</p>
      <footer>
        <span>流入 <b>${formatCompactAmount(node.totalIn)}</b></span>
        <i></i>
        <span>流出 <b>${formatCompactAmount(node.totalOut)}</b></span>
      </footer>
    </article>
  `;
}

function renderEdgeLabel(edge: FundFlowEdge): string {
  return edge.direction === 'clear'
    ? `净流向 ${formatCompactAmount(edge.netAmount)}`
    : `双向往来 ${formatCompactAmount(edge.grossAmount)}`;
}

function resolveFundFlowLineWidth(edge: FundFlowEdge): number {
  const amount = edge.direction === 'clear' ? edge.netAmount : edge.grossAmount;
  const amountWeight = Math.max(0, Math.min(2.2, Math.log10(Math.max(1, amount)) - 3));
  return (edge.direction === 'clear' ? 3 : 2.4) + amountWeight;
}

function renderTradeParty(fact: CaseGraphTradeFact, side: 'payer' | 'payee'): string {
  const name = side === 'payer' ? fact.payerAccountName : fact.payeeAccountName;
  const card = side === 'payer' ? fact.payerTradeCard : fact.payeeTradeCard;
  return String(name || card || '-');
}

function formatTradeTime(value: string | null | undefined): string {
  const text = String(value || '').trim();
  return text ? text.replace('T', ' ').slice(0, 16) : '-';
}

function resolvePresetValue(value: string, options: Array<{ value: string }>): string {
  return options.some((option) => option.value !== 'custom' && option.value === value) ? value : 'custom';
}

function parseNonNegativeNumber(value: string): number {
  const parsed = Number(String(value || '').replace(/[,，\s]/g, ''));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
