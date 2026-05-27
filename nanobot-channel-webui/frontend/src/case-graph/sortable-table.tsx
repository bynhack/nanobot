import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

export type SortDirection = 'asc' | 'desc';
export interface SortState<Key extends string> {
  key: Key;
  direction: SortDirection;
}

type SortValue = string | number | boolean | null | undefined;
type SortValueList = SortValue | SortValue[];

export type SortAccessors<Item, Key extends string> = Record<Key, (item: Item) => SortValueList>;

export function nextSortState<Key extends string>(
  current: SortState<Key> | null,
  key: Key,
  defaultDirection: SortDirection = 'asc',
): SortState<Key> {
  if (!current || current.key !== key) {
    return { key, direction: defaultDirection };
  }
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}

export function sortItemsByState<Item, Key extends string>(
  items: Item[],
  sortState: SortState<Key> | null,
  accessors: SortAccessors<Item, Key>,
): Item[] {
  if (!sortState) return items;
  const accessor = accessors[sortState.key];
  if (!accessor) return items;
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const comparison = compareSortValues(accessor(left.item), accessor(right.item), sortState.direction);
      return comparison || left.index - right.index;
    })
    .map(({ item }) => item);
}

export function sortableHeaderAria<Key extends string>(
  sortState: SortState<Key> | null,
  key: Key,
): 'ascending' | 'descending' | 'none' {
  if (sortState?.key !== key) return 'none';
  return sortState.direction === 'asc' ? 'ascending' : 'descending';
}

export function SortableColumnHeader<Key extends string>({
  defaultDirection = 'asc',
  label,
  onSortChange,
  sortKey,
  sortState,
}: {
  defaultDirection?: SortDirection;
  label: string;
  onSortChange: (next: SortState<Key>) => void;
  sortKey: Key;
  sortState: SortState<Key> | null;
}) {
  const active = sortState?.key === sortKey;
  const direction = active ? sortState.direction : null;
  const Icon = !active ? ArrowUpDown : direction === 'asc' ? ArrowUp : ArrowDown;
  const title = active
    ? `${label}，当前${direction === 'asc' ? '升序' : '降序'}，点击切换排序`
    : `${label}，点击排序`;
  return (
    <button
      type="button"
      className={`case-graph-sort-header${active ? ' is-active' : ''}`}
      title={title}
      aria-label={title}
      onClick={() => onSortChange(nextSortState(sortState, sortKey, defaultDirection))}
    >
      <span>{label}</span>
      <Icon className="case-graph-sort-header-icon" size={13} aria-hidden="true" />
    </button>
  );
}

function compareSortValues(left: SortValueList, right: SortValueList, direction: SortDirection): number {
  const leftValues = Array.isArray(left) ? left : [left];
  const rightValues = Array.isArray(right) ? right : [right];
  const length = Math.max(leftValues.length, rightValues.length);
  for (let index = 0; index < length; index += 1) {
    const comparison = comparePrimitive(leftValues[index], rightValues[index], direction);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function comparePrimitive(left: SortValue, right: SortValue, direction: SortDirection): number {
  const leftEmpty = isEmptySortValue(left);
  const rightEmpty = isEmptySortValue(right);
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;

  const base = compareNonEmptyPrimitive(left, right);
  return direction === 'asc' ? base : -base;
}

function compareNonEmptyPrimitive(left: Exclude<SortValue, null | undefined>, right: Exclude<SortValue, null | undefined>): number {
  if (typeof left === 'number' || typeof right === 'number') {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber - rightNumber;
    }
  }
  if (typeof left === 'boolean' || typeof right === 'boolean') {
    return Number(left) - Number(right);
  }
  return String(left).localeCompare(String(right), 'zh-Hans-CN', {
    numeric: true,
    sensitivity: 'base',
  });
}

function isEmptySortValue(value: SortValue): boolean {
  return value == null || String(value).trim() === '';
}

export const sortableTableForTest = {
  nextSortState,
  sortItemsByState,
};
