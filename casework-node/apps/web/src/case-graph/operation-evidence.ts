import type { CaseGraphOperationEvidence, CaseGraphOperationEvidenceLevel } from './types';

export type CaseGraphEvidenceOperation =
  | 'exclude_nodes'
  | 'exclude_trades'
  | 'create_manual_subject'
  | 'add_manual_trade'
  | 'add_reality_relation'
  | 'complete_relation'
  | 'restore_nodes'
  | 'restore_trades'
  | 'candidate_subject_changes'
  | 'group_change'
  | 'group_collapse'
  | 'group_expand'
  | 'drill_with_changed_settings'
  | 'initial_query'
  | 'drill'
  | 'filter'
  | 'layout';

export type OperationEvidenceOption = { code: string; label: string };

const REQUIRED_OPERATIONS = new Set<CaseGraphEvidenceOperation>([
  'exclude_nodes',
  'exclude_trades',
  'create_manual_subject',
  'add_manual_trade',
  'add_reality_relation',
  'complete_relation',
]);

const OPTIONAL_OPERATIONS = new Set<CaseGraphEvidenceOperation>([
  'restore_nodes',
  'restore_trades',
  'candidate_subject_changes',
  'group_change',
  'drill_with_changed_settings',
]);

const OPTIONS: Partial<Record<CaseGraphEvidenceOperation, OperationEvidenceOption[]>> = {
  exclude_nodes: tuples([
    ['unrelated_to_case', '核实与本案无关'],
    ['duplicate_subject', '重复主体或重复账号'],
    ['incorrect_identity', '主体身份归属错误'],
    ['no_investigation_value', '交易关系不具备研判价值'],
    ['data_quality_issue', '数据质量异常'],
    ['mistaken_operation', '误操作'],
    ['other', '其他'],
  ]),
  exclude_trades: tuples([
    ['normal_business', '核实为正常经营往来'],
    ['normal_personal', '核实为亲友正常往来'],
    ['own_account_transfer', '核实为本人账户间调拨'],
    ['duplicate_or_reversal', '重复或冲正流水'],
    ['invalid_transaction', '测试、小额验证或无效交易'],
    ['outside_investigation', '与当前研判方向无关'],
    ['data_quality_issue', '数据异常'],
    ['other', '其他'],
  ]),
  create_manual_subject: sourceOptions(),
  add_manual_trade: tuples([
    ['interview_record', '询问或讯问笔录'],
    ['cash_record', '现金收付记录'],
    ['ledger_or_receipt', '账本或收据'],
    ['chat_record', '聊天记录'],
    ['electronic_evidence', '电子数据取证'],
    ['field_verification', '现场核查'],
    ['documentary_evidence', '其他书证材料'],
    ['other', '其他'],
  ]),
  add_reality_relation: tuples([
    ['household_information', '户籍或亲属关系信息'],
    ['interview_record', '询问或讯问笔录'],
    ['business_registration', '企业工商信息'],
    ['communication_record', '通讯录或通联信息'],
    ['chat_record', '聊天记录'],
    ['field_verification', '现场核查'],
    ['documentary_evidence', '书证材料'],
    ['electronic_evidence', '电子数据取证'],
    ['other', '其他'],
  ]),
  complete_relation: sourceOptions(),
};

const OPTIONAL_OPTIONS: OperationEvidenceOption[] = tuples([
  ['additional_verification', '补充核查需要'],
  ['adjust_direction', '调整研判方向'],
  ['restore_mistake', '恢复误取消内容'],
  ['new_evidence', '新证据或新线索出现'],
  ['group_analysis', '便于团伙关系分析'],
  ['fund_path_analysis', '便于资金路径分析'],
  ['other', '其他'],
]);

function tuples(items: Array<[string, string]>): OperationEvidenceOption[] {
  return items.map(([code, label]) => ({ code, label }));
}

function sourceOptions(): OperationEvidenceOption[] {
  return tuples([
    ['interview_record', '询问或讯问笔录'],
    ['household_information', '户籍或人员信息'],
    ['account_information', '银行账户资料'],
    ['electronic_evidence', '电子数据取证'],
    ['field_verification', '现场核查'],
    ['documentary_evidence', '书证材料'],
    ['other_case_clue', '其他案件线索'],
    ['other', '其他'],
  ]);
}

export function evidenceLevelForOperation(operation: CaseGraphEvidenceOperation): CaseGraphOperationEvidenceLevel {
  if (REQUIRED_OPERATIONS.has(operation)) return 'required';
  if (OPTIONAL_OPERATIONS.has(operation)) return 'optional';
  return 'automatic';
}

export function operationEvidenceOptions(operation: CaseGraphEvidenceOperation): OperationEvidenceOption[] {
  return OPTIONS[operation] ?? OPTIONAL_OPTIONS;
}

export function emptyOperationEvidence(operation: CaseGraphEvidenceOperation): CaseGraphOperationEvidence {
  return { level: evidenceLevelForOperation(operation) };
}

export function validateOperationEvidence(
  operation: CaseGraphEvidenceOperation,
  evidence: CaseGraphOperationEvidence,
): string | null {
  const level = evidenceLevelForOperation(operation);
  if (level === 'required' && !evidence.reasonCode?.trim()) return '请选择操作依据';
  if (evidence.reasonCode === 'other' && !evidence.note?.trim()) return '请补充具体依据';
  return null;
}
