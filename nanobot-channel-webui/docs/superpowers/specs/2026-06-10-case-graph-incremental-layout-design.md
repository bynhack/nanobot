# Case Graph Incremental Layout Design

## Decision

The case-graph fund layout will use a self-developed frontend layout engine.
G6 remains responsible for rendering, interaction, dragging, zooming, animation,
and graph element presentation. It will not decide business layout positions.

This is a clean product model, not a compatibility layer over the current
layout implementation. The feature has not shipped, so the new engine does not
need to preserve legacy layout algorithms or legacy graph-content coordinate
formats.

## Goals

- Initial graphing creates a stable fund-flow skeleton.
- Later clues, relation completion, manual trades, restored nodes, and grouped
  nodes grow from the existing graph instead of triggering whole-graph relayout.
- Existing nodes keep their positions unless the user manually moves them or a
  future explicit relayout command is introduced.
- User-dragged nodes and group cards are permanently locked.
- Group collapse, expand, and split are handled by the same layout model as
  other graph changes.
- Business flows describe what changed; they do not contain custom coordinate
  logic.
- Persisted layout comes from the layout engine or manual drag events, not from
  canvas render side effects.

## Non-Goals

- No first-version explicit relayout button.
- No legacy `graphContent` coordinate compatibility.
- No preservation of the current `directed-flow`, local compaction, first-member
  group anchor, or restore-node coordinate patch behavior.
- No backend layout algorithm in the first version.
- No broad browser acceptance test as part of the design step.

## Architecture

Add a new frontend module:

```text
frontend/src/case-graph/layout-engine/
```

The layout engine is the only source of automatic position calculation. It does
not call React state setters, APIs, or G6 methods. It receives graph state and a
layout event, then returns a layout plan.

Primary API shape:

```ts
computeCaseGraphLayoutPlan(input: LayoutPlanInput): LayoutPlan
```

`LayoutPlanInput` contains:

- current graph data
- previous layout state
- position metadata
- current operation event
- added nodes and changed edges
- operation anchor node ids
- group state
- canvas and node dimensions

`LayoutPlan` contains:

- full `nodePositions`
- current `positionPatch`
- generated node ids
- locked node ids
- layout diagnostics

The main consumers are:

- `workbench.tsx`: builds layout events after business operations and persists
  approved layout plans.
- `graph-canvas.tsx`: renders positions and emits manual move events after drag.
- backend state endpoints: save layout state, but do not compute positions.

## Layout Events

Business flows send semantic events to the layout engine instead of coordinate
patches.

Examples:

```ts
type LayoutEvent =
  | { type: 'initial_graph'; primaryAnchorIds: string[] }
  | { type: 'relation_drill'; anchorNodeIds: string[]; addedNodeIds: string[]; changedEdgeIds: string[] }
  | { type: 'relation_complete'; anchorNodeIds: string[]; addedNodeIds: string[]; changedEdgeIds: string[] }
  | { type: 'manual_trade'; anchorNodeIds: string[]; addedNodeIds: string[]; changedEdgeIds: string[] }
  | { type: 'manual_move'; movedPositions: Record<string, Point> }
  | { type: 'group_collapse'; groupId: string; memberNodeIds: string[] }
  | { type: 'group_expand'; groupId: string; memberNodeIds: string[] }
  | { type: 'group_split'; groupId: string; memberNodeIds: string[] }
  | { type: 'restore_node'; anchorNodeIds: string[]; restoredNodeIds: string[] };
```

## Position Model

Persisted layout should be versioned from the first implementation:

```ts
layout: {
  version: 2;
  nodePositions: Record<string, Point>;
  positionMeta: Record<string, PositionMeta>;
  groupLayout: Record<string, GroupLayoutState>;
}
```

`PositionMeta` records how a position was produced:

```ts
interface PositionMeta {
  source: 'initial' | 'generated' | 'manual' | 'group' | 'restored';
  locked?: boolean;
  anchorNodeIds?: string[];
  updatedAt?: string;
}
```

Priority order:

1. User-dragged locked positions.
2. User-dragged locked group card positions.
3. Existing persisted node positions.
4. New positions generated for the current event.
5. Fallback positions.

Manual positions use `source: 'manual'` and `locked: true`. Future automatic
layout must never move them.

## Initial Skeleton

The initial graph uses a mixed direction-and-anchor model:

- User-selected subjects or accounts are the primary narrative center.
- High-weight transfer accounts, high-degree nodes, and key transit nodes become
  secondary centers.
- Incoming nodes prefer the left side.
- Outgoing nodes prefer the right side.
- Bridge and transit nodes prefer positions between relevant centers.
- Cash, manual, and weak-relation nodes sit on the periphery.

The goal is a stable skeleton, not a globally optimal drawing.

## Incremental Growth

Later operations do not relayout the whole graph. They place new or restored
nodes around relevant anchors.

Rules:

- Ordinary upstream/downstream nodes grow near the operation anchor.
- Multi-anchor ordinary nodes prefer the operation anchor.
- Multi-anchor bridge or transit nodes prefer positions between anchors.
- Nodes in the same added batch are sorted by relation strength.
- Stronger relations receive closer and clearer slots.
- Candidate positions snap to a grid.
- Collisions expand the search outward.
- Existing nodes and locked nodes do not move.

Suggested pure functions:

```ts
buildInitialSkeleton(...)
detectLayoutAnchors(...)
classifyNodeLayoutRole(...)
generateGrowthSlots(...)
scoreCandidateSlot(...)
resolveCollisions(...)
applySnapGrid(...)
```

Candidate scoring should consider:

- collision avoidance
- distance to anchors
- fund direction fit
- edge crossing reduction
- spacing from sibling nodes
- group boundaries
- locked-node protection

## Groups

Groups are layout entities, not canvas-only effects.

On collapse:

- The group card position defaults to the current member bounding-box center.
- The group card becomes a layout anchor.
- Hidden member nodes are excluded from external collision checks.
- External display can connect to the group card.
- If the user drags the group card, it becomes permanently locked.

On expand or split:

- Member nodes first try to restore their pre-collapse positions.
- If those positions now conflict, members expand around the group card.
- Only group members can be repositioned during this operation.
- Nodes outside the group do not move.
- Split removes the group card and returns members to independent anchors.

Group layout state:

```ts
interface GroupLayoutState {
  groupId: string;
  collapsedPosition: Point;
  memberPositionsBeforeCollapse: Record<string, Point>;
  locked?: boolean;
}
```

## Persistence Flow

The current canvas render loop should not persist layout automatically. The old
flow where `onNodePositionsChange(..., 'layout')` updates the latest step must be
removed or replaced.

Only two write sources should persist layout:

- `layoutPatch`: output from the layout engine after a business operation.
- `manualMovePatch`: output from user drag, marked as manual and locked.

Step snapshots should store the official layout plan for that operation, not a
post-render canvas measurement.

The backend can remain a state store in the first version. It should accept and
return the new layout shape, but does not calculate positions.

## Error Handling

The layout engine must always return a usable plan.

- Missing anchor: place near the primary center's outer slots.
- All preferred slots collide: continue outward expansion.
- Dense graph: allow farther layers while preserving grid snapping.
- Multi-anchor conflict: prefer no collision first, then fewer crossings.
- Group expand conflict: expand members around the group card.
- Locked-node conflict: locked nodes never move; generated nodes avoid them.

Diagnostics should be returned for debugging and tests, but should not appear in
normal user-facing UI.

## Verification Strategy

Testing should focus on product invariants, not implementation details.

Core coverage:

- Initial graph positions primary and secondary centers correctly.
- Incoming and outgoing nodes prefer expected sides.
- Incremental operations do not move existing nodes.
- New ordinary nodes grow near the operation anchor.
- Bridge nodes land between anchors.
- Dragged nodes remain locked across later automatic layout.
- Group collapse places the card at member bounding-box center.
- Group expand restores member positions when possible.
- Group expand collision handling only repositions group members.
- Persisted layout uses layout-engine output, not render side effects.

No browser verification is required for this design document. Browser checks are
opt-in under the repository policy and can be considered later for significant
visual integration work.

## Implementation Notes

- Replace `graph-layout.ts` behavior with calls into the new engine instead of
  evolving the old functions.
- Remove canvas-level local compaction as a source of persisted coordinates.
- Remove workbench-specific restore/group coordinate patching once the equivalent
  layout events are supported.
- Keep G6 for rendering, drag interactions, viewport behavior, and animation.
- Do not add an explicit relayout UI in the first version, but keep the engine
  shape compatible with a future relayout event.
