import { describe, expect, it } from 'vitest';

import { sortableTableForTest, type SortAccessors } from './sortable-table';

interface Row {
  id: string;
  amount?: number | null;
  label: string;
  time?: string;
}

const accessors: SortAccessors<Row, 'amount' | 'label' | 'time'> = {
  amount: (row) => row.amount,
  label: (row) => row.label,
  time: (row) => row.time,
};

describe('case graph sortable table helpers', () => {
  it('sorts numbers descending while keeping empty values at the bottom', () => {
    const rows: Row[] = [
      { id: 'empty', amount: null, label: '空值' },
      { id: 'small', amount: 100, label: '小额' },
      { id: 'large', amount: 9000, label: '大额' },
    ];

    expect(sortableTableForTest.sortItemsByState(rows, { key: 'amount', direction: 'desc' }, accessors).map((row) => row.id)).toEqual([
      'large',
      'small',
      'empty',
    ]);
  });

  it('sorts Chinese text with numeric fragments naturally', () => {
    const rows: Row[] = [
      { id: 'b', label: '主体10' },
      { id: 'a', label: '主体2' },
      { id: 'c', label: '主体1' },
    ];

    expect(sortableTableForTest.sortItemsByState(rows, { key: 'label', direction: 'asc' }, accessors).map((row) => row.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('toggles the active column direction from the preferred first direction', () => {
    const first = sortableTableForTest.nextSortState(null, 'amount', 'desc');
    const second = sortableTableForTest.nextSortState(first, 'amount', 'desc');

    expect(first).toEqual({ key: 'amount', direction: 'desc' });
    expect(second).toEqual({ key: 'amount', direction: 'asc' });
  });
});
