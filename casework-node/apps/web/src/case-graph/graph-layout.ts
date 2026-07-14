import { computeCaseGraphLayoutPlan } from './layout-engine';
import type { Point } from './layout-engine';
import type { CaseGraphData } from './types';

export interface GraphPoint {
  x: number;
  y: number;
}

export type CaseGraphLayoutMode = 'incremental';

interface LayoutOptions {
  graphContent?: string | null;
  graphWidth: number;
  graphHeight: number;
  nodeWidth: number;
  nodeHeight: number;
  columnGap: number;
  rowGap: number;
  focusNodeIds?: string[];
  focusAccountIds?: string[];
  focusLabels?: string[];
  preferPersistedPositions?: boolean;
  layoutMode?: CaseGraphLayoutMode | string;
}

export function computeCaseGraphLayout(
  graphData: CaseGraphData | null,
  options: LayoutOptions,
): Map<string, GraphPoint> {
  const previousPositions: Record<string, Point> = {};
  if (options.preferPersistedPositions !== false) {
    for (const node of graphData?.nodes ?? []) {
      const x = finiteNumber(node.x);
      const y = finiteNumber(node.y);
      if (x == null || y == null) continue;
      previousPositions[node.id] = { x, y };
    }
  }

  const plan = computeCaseGraphLayoutPlan({
    graphData,
    graphWidth: options.graphWidth,
    graphHeight: options.graphHeight,
    nodeWidth: options.nodeWidth,
    nodeHeight: options.nodeHeight,
    columnGap: options.columnGap,
    rowGap: options.rowGap,
    focusNodeIds: options.focusNodeIds,
    focusAccountIds: options.focusAccountIds,
    focusLabels: options.focusLabels,
    previousLayout: { version: 2, nodePositions: previousPositions },
    event: Object.keys(previousPositions).length
      ? { type: 'layout_refresh' }
      : { type: 'initial_graph' },
  });

  return new Map(Object.entries(plan.nodePositions));
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
