import { describe, expect, it } from 'vitest';

import {
  evidenceLevelForOperation,
  operationEvidenceOptions,
  validateOperationEvidence,
} from './operation-evidence';

describe('case graph operation evidence', () => {
  it('classifies graph-changing operations without trusting callers', () => {
    expect(evidenceLevelForOperation('exclude_nodes')).toBe('required');
    expect(evidenceLevelForOperation('restore_nodes')).toBe('optional');
    expect(evidenceLevelForOperation('group_collapse')).toBe('automatic');
    expect(evidenceLevelForOperation('filter')).toBe('automatic');
  });

  it('provides investigation-oriented reasons for exclusions', () => {
    expect(operationEvidenceOptions('exclude_nodes').map((option) => option.label)).toContain('核实与本案无关');
    expect(operationEvidenceOptions('exclude_trades').map((option) => option.label)).toContain('核实为正常经营往来');
  });

  it('requires a reason for required operations and a note for other', () => {
    expect(validateOperationEvidence('exclude_nodes', { level: 'required' })).toBe('请选择操作依据');
    expect(validateOperationEvidence('exclude_nodes', {
      level: 'required',
      reasonCode: 'other',
      reasonLabel: '其他',
    })).toBe('请补充具体依据');
  });

  it('allows optional evidence to remain empty', () => {
    expect(validateOperationEvidence('restore_nodes', { level: 'optional' })).toBeNull();
  });
});
