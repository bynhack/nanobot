import { record, text, type JsonRecord } from './state.js';

export type EvidenceLevel = 'required' | 'optional' | 'automatic';
const REQUIRED = new Set(['manual_exclude_node', 'detail_trade_filter', 'manual_node_add', 'manual_trade_add', 'reality_relation_add', 'complete_current_graph']);
const OPTIONAL = new Set(['manual_restore_node', 'summary_analysis']);

export function evidenceLevel(operationType: string, groupOperation = ''): EvidenceLevel {
  if (operationType.startsWith('investigation_group_')) {
    return groupOperation === 'collapse' || groupOperation === 'expand' || ['investigation_group_collapse', 'investigation_group_expand'].includes(operationType) ? 'automatic' : 'optional';
  }
  if (REQUIRED.has(operationType)) return 'required';
  if (OPTIONAL.has(operationType)) return 'optional';
  return 'automatic';
}

export function normalizeEvidence(operationType: string, value: unknown, groupOperation = '', override?: EvidenceLevel): JsonRecord {
  const level = override ?? evidenceLevel(operationType, groupOperation);
  const raw = record(value);
  const reasonCode = text(raw.reasonCode);
  const reasonLabel = text(raw.reasonLabel);
  const note = text(raw.note);
  if (level === 'required' && !reasonCode) throw new Error('请选择操作依据');
  if (reasonCode && !reasonLabel) throw new Error('操作依据标签不能为空');
  if (reasonCode === 'other' && !note) throw new Error('选择其他依据时，请补充具体说明');
  return { level, ...(reasonCode ? { reasonCode: reasonCode.slice(0, 80), reasonLabel: reasonLabel.slice(0, 120) } : {}), ...(note ? { note: note.slice(0, 1000) } : {}) };
}

export function evidenceFromBusinessFields(reasonLabel: string, fields: Array<[string, unknown]>): JsonRecord | null {
  const notes = fields.filter(([, value]) => text(value)).map(([label, value]) => `${label}：${text(value)}`);
  return notes.length ? { reasonCode: 'business_context_fields', reasonLabel, note: notes.join('；') } : null;
}
