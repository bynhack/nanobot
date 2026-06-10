import { useMemo } from 'react';

import { GraphCanvas } from './graph-canvas';
import { buildMergedNetworkGraph } from './graph-view-adapters';
import type {
  CaseGraphConversationFocus,
  CaseGraphData,
  CaseGraphExcludedNode,
  CaseGraphGroupMap,
  CaseGraphNode,
  CaseGraphReplayTimeline,
  CaseGraphTradeCard,
} from './types';

type NodePositionsChangeReason = 'layout' | 'drag';

interface GraphViewProps {
  graphData: CaseGraphData | null;
  graphContent?: string | null;
  groupMap: CaseGraphGroupMap;
  tradeCards: CaseGraphTradeCard[];
  focusAccountIds: string[];
  focusLabels: string[];
  loading: boolean;
  drilldownLoading: boolean;
  hasActiveTab: boolean;
  replayMode?: boolean;
  replayTimeline?: CaseGraphReplayTimeline;
  onChooseInvestigationOrigin: () => void;
  onCompleteGraphRelations: () => void;
  onOpenGraphConfig: () => void;
  onDrillDown: (direction: 'in' | 'out' | 'both', node: CaseGraphNode, tradeCard: CaseGraphTradeCard | null) => void;
  onOpenNodeSummaryAnalysis: (node: CaseGraphNode) => void;
  onOpenGlobalSummaryAnalysis: () => void;
  onOpenManualNode: (position?: { x: number; y: number } | null) => void;
  onOpenManualTrade: (node?: CaseGraphNode | null) => void;
  onOpenRealityRelation: (node?: CaseGraphNode | null) => void;
  onExcludeNode: (node: CaseGraphExcludedNode) => void;
  onExcludeNodes: (nodes: CaseGraphExcludedNode[]) => void;
  onRestoreNode: (nodeId: string) => void;
  onCreateInvestigationGroup: (nodes: CaseGraphNode[]) => void;
  onToggleInvestigationGroup: (groupId: string, collapsed: boolean) => void;
  onUpdateInvestigationGroup: (groupId: string, input: { name: string; groupType?: string; note?: string }) => void;
  onUngroupInvestigationGroup: (groupId: string) => void;
  onRemoveInvestigationGroupMember: (groupId: string, nodeId: string) => void;
  onRemoveInvestigationGroupMembers: (groupId: string, nodeIds: string[]) => void;
  onAddInvestigationGroupMembers: (groupId: string, nodeIds: string[]) => void;
  onUpdateNodeNote: (nodeId: string, input: { note: string; sourceNote?: string }) => void;
  groupOperationLoading?: boolean;
  excluding: boolean;
  onOpenEdgeDetail: (edgeId: string, edgeFocus?: CaseGraphConversationFocus, edgeOverride?: CaseGraphData['edges'][number]) => void;
  onFocusChange?: (focus: CaseGraphConversationFocus | null) => void;
  onNodePositionsChange?: (positions: Record<string, { x: number; y: number }>, reason: NodePositionsChangeReason) => void;
}

export function GraphView(props: GraphViewProps) {
  const mergedGraphData = useMemo(
    () => buildMergedNetworkGraph(props.graphData, props.groupMap),
    [props.graphData, props.groupMap],
  );

  return (
    <GraphCanvas
      graphData={mergedGraphData}
      graphContent={props.graphContent}
      tradeCards={props.tradeCards}
      focusAccountIds={props.focusAccountIds}
      focusLabels={props.focusLabels}
      loading={props.loading}
      drilldownLoading={props.drilldownLoading}
      excluding={props.excluding}
      hasActiveTab={props.hasActiveTab}
      replayMode={props.replayMode}
      replayTimeline={props.replayTimeline}
      onChooseInvestigationOrigin={props.onChooseInvestigationOrigin}
      onCompleteGraphRelations={props.onCompleteGraphRelations}
      onOpenGraphConfig={props.onOpenGraphConfig}
      onDrillDown={props.onDrillDown}
      onOpenNodeSummaryAnalysis={props.onOpenNodeSummaryAnalysis}
      onOpenGlobalSummaryAnalysis={props.onOpenGlobalSummaryAnalysis}
      onOpenManualNode={props.onOpenManualNode}
      onOpenManualTrade={props.onOpenManualTrade}
      onOpenRealityRelation={props.onOpenRealityRelation}
      onExcludeNode={props.onExcludeNode}
      onExcludeNodes={props.onExcludeNodes}
      onRestoreNode={props.onRestoreNode}
      onCreateInvestigationGroup={props.onCreateInvestigationGroup}
      onToggleInvestigationGroup={props.onToggleInvestigationGroup}
      onUpdateInvestigationGroup={props.onUpdateInvestigationGroup}
      onUngroupInvestigationGroup={props.onUngroupInvestigationGroup}
      onRemoveInvestigationGroupMember={props.onRemoveInvestigationGroupMember}
      onRemoveInvestigationGroupMembers={props.onRemoveInvestigationGroupMembers}
      onAddInvestigationGroupMembers={props.onAddInvestigationGroupMembers}
      onUpdateNodeNote={props.onUpdateNodeNote}
      groupOperationLoading={props.groupOperationLoading}
      onOpenEdgeDetail={props.onOpenEdgeDetail}
      onFocusChange={props.onFocusChange}
      onNodePositionsChange={props.onNodePositionsChange}
    />
  );
}
