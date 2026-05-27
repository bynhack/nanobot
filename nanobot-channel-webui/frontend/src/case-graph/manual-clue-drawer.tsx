import { X } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';

import { CaseGraphDateInput } from './date-input';
import type {
  CaseGraphManualPartyPayload,
  CaseGraphNode,
} from './types';

type ManualClueMode = 'node' | 'trade' | 'relation';

interface ManualClueDrawerProps {
  open: boolean;
  mode: ManualClueMode;
  nodes: CaseGraphNode[];
  focusNode: CaseGraphNode | null;
  targetPosition: { x: number; y: number } | null;
  applying: boolean;
  onApplyNode: (payload: {
    label: string;
    tradeCard: string;
    discoveryReason: string;
    sourceNote: string;
    note: string;
    position?: { x: number; y: number };
  }) => void;
  onApplyTrade: (payload: {
    payer: CaseGraphManualPartyPayload;
    payee: CaseGraphManualPartyPayload;
    amount: string;
    tradeTime: string;
    method: string;
    summary: string;
    sourceNote: string;
  }) => void;
  onApplyRelation: (payload: {
    sourceNodeId: string;
    targetNodeId: string;
    relationType: string;
    note: string;
  }) => void;
  onClose: () => void;
}

const TRADE_METHODS = ['现金', '线下转交', '第三方代付', '抵扣结算', '其他'];
const RELATION_TYPES = ['母女', '父子', '母子', '父女', '夫妻', '亲属', '朋友', '同事', '同伙', '上下级', '其他'];

export function ManualClueDrawer({
  open,
  mode,
  nodes,
  focusNode,
  targetPosition,
  applying,
  onApplyNode,
  onApplyTrade,
  onApplyRelation,
  onClose,
}: ManualClueDrawerProps) {
  const [activeMode, setActiveMode] = useState<ManualClueMode>(mode);
  const [nodeLabel, setNodeLabel] = useState('');
  const [nodeTradeCard, setNodeTradeCard] = useState('');
  const [nodeDiscoveryReason, setNodeDiscoveryReason] = useState('');
  const [nodeSourceNote, setNodeSourceNote] = useState('');
  const [nodeNote, setNodeNote] = useState('');
  const [payerNodeId, setPayerNodeId] = useState('');
  const [payeeNodeId, setPayeeNodeId] = useState('');
  const [amount, setAmount] = useState('');
  const [tradeTime, setTradeTime] = useState('');
  const [method, setMethod] = useState(TRADE_METHODS[0]);
  const [summary, setSummary] = useState('');
  const [sourceNote, setSourceNote] = useState('');
  const [sourceNodeId, setSourceNodeId] = useState('');
  const [targetNodeId, setTargetNodeId] = useState('');
  const [relationType, setRelationType] = useState(RELATION_TYPES[0]);
  const [relationNote, setRelationNote] = useState('');

  useEffect(() => {
    if (!open) return;
    const focusId = focusNode?.id ?? '';
    setActiveMode(mode);
    setNodeLabel('');
    setNodeTradeCard('');
    setNodeDiscoveryReason('');
    setNodeSourceNote('');
    setNodeNote('');
    setPayerNodeId(focusId);
    setPayeeNodeId('');
    setAmount('');
    setTradeTime('');
    setMethod(TRADE_METHODS[0]);
    setSummary('');
    setSourceNote('');
    setSourceNodeId(focusId);
    setTargetNodeId('');
    setRelationType(RELATION_TYPES[0]);
    setRelationNote('');
  }, [focusNode?.id, mode, open]);

  const nodeOptions = useMemo(
    () => nodes
      .filter((node) => !node.isExcluded)
      .map((node) => ({
        id: node.id,
        label: node.accountName || node.label || node.name || node.tradeCard || node.id,
        tradeCard: node.tradeCard || '',
        accountId: node.accountId ? String(node.accountId) : '',
      })),
    [nodes],
  );

  if (!open) return null;

  const payer = buildPartyPayload(payerNodeId, nodeOptions);
  const payee = buildPartyPayload(payeeNodeId, nodeOptions);
  const canApplyNode = Boolean(nodeLabel.trim());
  const canApplyTrade = Boolean(payer && payee && payer.nodeId !== payee.nodeId && Number(amount) > 0 && amount.trim());
  const canApplyRelation = Boolean(sourceNodeId && targetNodeId && sourceNodeId !== targetNodeId && relationType.trim());
  const canApply = activeMode === 'node' ? canApplyNode : activeMode === 'trade' ? canApplyTrade : canApplyRelation;

  return (
    <div className="case-graph-modal-mask case-graph-modal-mask--detail" role="presentation" onClick={onClose}>
      <section
        className="case-graph-manual-clue"
        role="dialog"
        aria-modal="true"
        aria-labelledby="case-graph-manual-clue-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="case-graph-edge-detail-header">
          <div className="case-graph-detail-analysis-title">
            <h2 id="case-graph-manual-clue-title">人工补充线索</h2>
            <span>补充图上没有进入数据库的办案事实</span>
          </div>
          <button
            type="button"
            className="case-graph-edge-detail-close"
            aria-label="关闭人工补充线索"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>

        <div className="case-graph-manual-clue-tabs" role="tablist" aria-label="补充类型">
          <button
            type="button"
            className={activeMode === 'node' ? 'is-active' : ''}
            onClick={() => setActiveMode('node')}
          >
            创建交易主体
          </button>
          <button
            type="button"
            className={activeMode === 'trade' ? 'is-active' : ''}
            onClick={() => setActiveMode('trade')}
          >
            补充资金往来
          </button>
          <button
            type="button"
            className={activeMode === 'relation' ? 'is-active' : ''}
            onClick={() => setActiveMode('relation')}
          >
            标注现实关系
          </button>
        </div>

        {activeMode === 'node' ? (
          <div className="case-graph-manual-clue-body">
            <div className="case-graph-manual-clue-grid">
              <label>
                <span>主体名称</span>
                <input value={nodeLabel} placeholder="请输入交易主体名称" onChange={(event) => setNodeLabel(event.target.value)} />
              </label>
              <label>
                <span>银行卡号或账号</span>
                <input value={nodeTradeCard} placeholder="可填写银行卡号、支付账号或其他账号" onChange={(event) => setNodeTradeCard(event.target.value)} />
              </label>
              <label>
                <span>发现原因</span>
                <input value={nodeDiscoveryReason} placeholder="例如：现金交付人、聊天记录出现的收款卡" onChange={(event) => setNodeDiscoveryReason(event.target.value)} />
              </label>
              <label>
                <span>来源材料</span>
                <input value={nodeSourceNote} placeholder="例如：询问笔录、聊天截图、扣押清单" onChange={(event) => setNodeSourceNote(event.target.value)} />
              </label>
            </div>
            <label className="case-graph-manual-clue-full">
              <span>情况说明</span>
              <textarea value={nodeNote} placeholder="说明这个交易主体为什么需要补充到当前图谱" onChange={(event) => setNodeNote(event.target.value)} />
            </label>
          </div>
        ) : activeMode === 'trade' ? (
          <div className="case-graph-manual-clue-body">
            <div className="case-graph-manual-clue-grid">
              <SearchableNodeField
                label="付款方"
                value={payerNodeId}
                nodes={nodeOptions}
                onChange={setPayerNodeId}
              />
              <SearchableNodeField
                label="收款方"
                value={payeeNodeId}
                nodes={nodeOptions}
                onChange={setPayeeNodeId}
              />
              <label>
                <span>交易金额</span>
                <input value={amount} type="number" min="0" placeholder="请输入金额" onChange={(event) => setAmount(event.target.value)} />
              </label>
              <label>
                <span>交易时间</span>
                <CaseGraphDateInput
                  value={tradeTime}
                  onChange={setTradeTime}
                  ariaLabel="交易时间"
                  placeholder="选择交易时间"
                  includeTime
                />
              </label>
              <label>
                <span>往来方式</span>
                <select value={method} onChange={(event) => setMethod(event.target.value)}>
                  {TRADE_METHODS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label>
                <span>线索来源</span>
                <input value={sourceNote} placeholder="例如：询问笔录、现场扣押、聊天记录" onChange={(event) => setSourceNote(event.target.value)} />
              </label>
            </div>
            <label className="case-graph-manual-clue-full">
              <span>情况说明</span>
              <textarea value={summary} placeholder="说明这笔补充资金往来的依据和办案判断" onChange={(event) => setSummary(event.target.value)} />
            </label>
            <p className="case-graph-manual-clue-hint">如果交易对手不在图上，请先在画布空白处创建交易主体，再建立资金往来。</p>
          </div>
        ) : (
          <div className="case-graph-manual-clue-body">
            <div className="case-graph-manual-clue-grid">
              <SearchableNodeField label="主体" value={sourceNodeId} nodes={nodeOptions} onChange={setSourceNodeId} />
              <SearchableNodeField label="关联主体" value={targetNodeId} nodes={nodeOptions} onChange={setTargetNodeId} />
              <label>
                <span>现实关系</span>
                <select value={relationType} onChange={(event) => setRelationType(event.target.value)}>
                  {RELATION_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            </div>
            <label className="case-graph-manual-clue-full">
              <span>关系说明</span>
              <textarea value={relationNote} placeholder="说明关系来源，例如户籍信息、询问笔录、聊天记录等" onChange={(event) => setRelationNote(event.target.value)} />
            </label>
          </div>
        )}

        <footer className="case-graph-manual-clue-footer">
          <button type="button" className="case-graph-secondary-button" onClick={onClose}>取消</button>
          <button
            type="button"
            className="case-graph-primary-button"
            disabled={applying || !canApply}
            onClick={() => {
              if (activeMode === 'node') {
                onApplyNode({
                  label: nodeLabel,
                  tradeCard: nodeTradeCard,
                  discoveryReason: nodeDiscoveryReason,
                  sourceNote: nodeSourceNote,
                  note: nodeNote,
                  ...(targetPosition ? { position: targetPosition } : {}),
                });
                return;
              }
              if (activeMode === 'trade') {
                if (!payer || !payee) return;
                onApplyTrade({ payer, payee, amount, tradeTime, method, summary, sourceNote });
                return;
              }
              onApplyRelation({ sourceNodeId, targetNodeId, relationType, note: relationNote });
            }}
          >
            {applying ? '保存中...' : '保存到图'}
          </button>
        </footer>
      </section>
    </div>
  );
}

function SearchableNodeField({
  label,
  value,
  nodes,
  onChange,
}: {
  label: string;
  value: string;
  nodes: Array<{ id: string; label: string; tradeCard: string; accountId: string }>;
  onChange: (value: string) => void;
}) {
  const listboxId = useId();
  const selectedNode = nodes.find((node) => node.id === value) ?? null;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredNodes = useMemo(() => {
    if (!normalizedQuery) return nodes.slice(0, 30);
    return nodes
      .filter((node) => formatNodeOption(node).toLowerCase().includes(normalizedQuery))
      .slice(0, 30);
  }, [nodes, normalizedQuery]);

  useEffect(() => {
    setQuery(selectedNode ? formatNodeOption(selectedNode) : '');
  }, [selectedNode?.id]);

  const selectNode = (node: { id: string; label: string; tradeCard: string; accountId: string }) => {
    setQuery(formatNodeOption(node));
    onChange(node.id);
    setOpen(false);
  };

  return (
    <div
      className="case-graph-manual-clue-field case-graph-node-combobox"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <span>{label}</span>
      <div className="case-graph-node-combobox-control">
        <input
          value={query}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          placeholder={`搜索并选择${label}`}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            const nextQuery = event.target.value;
            setQuery(nextQuery);
            setOpen(true);
            const nextNode = nodes.find((node) => formatNodeOption(node) === nextQuery);
            onChange(nextNode?.id ?? '');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false);
              return;
            }
            if (event.key === 'Enter' && open && filteredNodes[0]) {
              event.preventDefault();
              selectNode(filteredNodes[0]);
            }
          }}
        />
        {open ? (
          <div id={listboxId} className="case-graph-node-combobox-list" role="listbox">
            {filteredNodes.length ? filteredNodes.map((node) => (
              <button
                key={node.id}
                type="button"
                role="option"
                aria-selected={node.id === value}
                className={node.id === value ? 'is-selected' : ''}
                title={formatNodeOption(node)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectNode(node)}
              >
                <strong>{node.label}</strong>
                <span>{formatNodeMeta(node)}</span>
              </button>
            )) : (
              <div className="case-graph-node-combobox-empty">没有匹配的图上主体</div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatNodeOption(node: { id: string; label: string; tradeCard: string; accountId: string }): string {
  const parts = [node.label, node.tradeCard, node.accountId ? `账号 ${node.accountId}` : ''].filter(Boolean);
  return parts.join(' · ');
}

function formatNodeMeta(node: { tradeCard: string; accountId: string }): string {
  const parts = [node.tradeCard, node.accountId ? `账号 ${node.accountId}` : ''].filter(Boolean);
  return parts.join(' · ') || '图上主体';
}

function buildPartyPayload(
  value: string,
  nodes: Array<{ id: string; label: string }>,
): CaseGraphManualPartyPayload | null {
  const node = nodes.find((item) => item.id === value);
  if (!node) return null;
  return { nodeId: node.id, label: node.label };
}
