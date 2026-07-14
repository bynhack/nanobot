import { useEffect, useState } from 'react';

import { Select } from '../components/ui/select';
import {
  evidenceLevelForOperation,
  operationEvidenceOptions,
  type CaseGraphEvidenceOperation,
} from './operation-evidence';
import type { CaseGraphOperationEvidence } from './types';

export function OperationEvidenceFields({
  operation,
  value,
  onChange,
  alwaysExpanded = false,
}: {
  operation: CaseGraphEvidenceOperation;
  value: CaseGraphOperationEvidence;
  onChange: (value: CaseGraphOperationEvidence) => void;
  alwaysExpanded?: boolean;
}) {
  const level = evidenceLevelForOperation(operation);
  const [expanded, setExpanded] = useState(alwaysExpanded || level === 'required');

  useEffect(() => {
    setExpanded(alwaysExpanded || level === 'required' || Boolean(value.reasonCode || value.note));
  }, [alwaysExpanded, level, operation, value.note, value.reasonCode]);

  if (level === 'automatic') return null;
  if (!expanded) {
    return (
      <button type="button" className="case-graph-evidence-expand" onClick={() => setExpanded(true)}>
        补充操作依据（选填）
      </button>
    );
  }

  const options = operationEvidenceOptions(operation);
  const showNote = value.reasonCode === 'other' || Boolean(value.note);
  return (
    <div className="case-graph-operation-evidence">
      <div className="case-graph-operation-evidence-heading">
        <strong>操作依据{level === 'required' ? ' *' : ''}</strong>
        <span>{level === 'required' ? '请选择作出本次操作的现实依据' : '可选填，便于后续复核研判过程'}</span>
      </div>
      <Select
        value={value.reasonCode ?? ''}
        ariaLabel="操作依据"
        placeholder="请选择操作依据"
        options={options.map((option) => ({ value: option.code, label: option.label }))}
        onChange={(reasonCode) => {
          const selected = options.find((option) => option.code === reasonCode);
          onChange({
            ...value,
            level,
            reasonCode: selected?.code,
            reasonLabel: selected?.label,
            ...(reasonCode !== 'other' ? { note: value.note } : {}),
          });
        }}
      />
      {showNote ? (
        <label>
          <span>{value.reasonCode === 'other' ? '具体依据 *' : '补充说明'}</span>
          <textarea
            value={value.note ?? ''}
            maxLength={1000}
            placeholder="补充记录材料来源、核查情况或作出判断的原因"
            onChange={(event) => onChange({ ...value, level, note: event.target.value })}
          />
        </label>
      ) : (
        <button
          type="button"
          className="case-graph-evidence-note-toggle"
          onClick={() => onChange({ ...value, level, note: ' ' })}
        >
          + 补充说明
        </button>
      )}
    </div>
  );
}
