import type { CaseGraphData } from '../types';

export interface Point {
  x: number;
  y: number;
}

export type PositionSource = 'initial' | 'generated' | 'manual' | 'group' | 'restored';

export interface PositionMeta {
  source: PositionSource;
  locked?: boolean;
  anchorNodeIds?: string[];
  updatedAt?: string;
}

export interface GroupLayoutState {
  groupId: string;
  collapsedPosition: Point;
  memberPositionsBeforeCollapse: Record<string, Point>;
  locked?: boolean;
}

export interface CaseGraphLayoutStateV2 {
  version: 2;
  nodePositions: Record<string, Point>;
  positionMeta: Record<string, PositionMeta>;
  groupLayout: Record<string, GroupLayoutState>;
  viewport?: { x: number; y: number; zoom: number };
}

export type LayoutEvent =
  | { type: 'initial_graph'; primaryAnchorIds?: string[] }
  | { type: 'relation_drill'; anchorNodeIds?: string[]; addedNodeIds?: string[]; changedEdgeIds?: string[] }
  | { type: 'relation_complete'; anchorNodeIds?: string[]; addedNodeIds?: string[]; changedEdgeIds?: string[] }
  | { type: 'relation_filter'; anchorNodeIds?: string[]; addedNodeIds?: string[]; changedEdgeIds?: string[] }
  | { type: 'manual_trade'; anchorNodeIds?: string[]; addedNodeIds?: string[]; changedEdgeIds?: string[] }
  | { type: 'manual_node'; anchorNodeIds?: string[]; addedNodeIds?: string[]; changedEdgeIds?: string[] }
  | { type: 'restore_node'; anchorNodeIds?: string[]; restoredNodeIds?: string[] }
  | { type: 'manual_move'; movedPositions: Record<string, Point> }
  | { type: 'group_collapse'; groupId: string; memberNodeIds: string[] }
  | { type: 'group_expand'; groupId: string; memberNodeIds: string[] }
  | { type: 'group_split'; groupId: string; memberNodeIds: string[] }
  | { type: 'layout_refresh'; anchorNodeIds?: string[]; addedNodeIds?: string[]; changedEdgeIds?: string[] };

export interface LayoutDimensions {
  graphWidth: number;
  graphHeight: number;
  nodeWidth: number;
  nodeHeight: number;
  columnGap: number;
  rowGap: number;
}

export interface LayoutPlanInput extends LayoutDimensions {
  graphData: CaseGraphData | null;
  previousLayout?: Partial<CaseGraphLayoutStateV2> | null;
  positionMeta?: Record<string, PositionMeta> | null;
  groupLayout?: Record<string, GroupLayoutState> | null;
  event?: LayoutEvent;
  focusNodeIds?: string[];
  focusAccountIds?: string[];
  focusLabels?: string[];
}

export interface LayoutDiagnostic {
  nodeId?: string;
  code: string;
  message: string;
}

export interface LayoutPlan {
  nodePositions: Record<string, Point>;
  positionPatch: Record<string, Point>;
  positionMeta: Record<string, PositionMeta>;
  groupLayout: Record<string, GroupLayoutState>;
  generatedNodeIds: string[];
  lockedNodeIds: string[];
  diagnostics: LayoutDiagnostic[];
}
