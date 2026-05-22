import { useMemo } from 'react';

import { GraphCanvas } from './graph-canvas';
import { buildMergedNetworkGraph } from './graph-view-adapters';
import type {
  CaseGraphConversationFocus,
  CaseGraphData,
  CaseGraphExcludedNode,
  CaseGraphGroupMap,
  CaseGraphNode,
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
  onChooseInvestigationOrigin: () => void;
  onCompleteGraphRelations: () => void;
  onOpenGraphConfig: () => void;
  onDrillDown: (direction: 'in' | 'out' | 'both', node: CaseGraphNode, tradeCard: CaseGraphTradeCard | null) => void;
  onExcludeNode: (node: CaseGraphExcludedNode) => void;
  onExcludeNodes: (nodes: CaseGraphExcludedNode[]) => void;
  excluding: boolean;
  onOpenEdgeDetail: (edgeId: string, edgeFocus?: CaseGraphConversationFocus) => void;
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
      onChooseInvestigationOrigin={props.onChooseInvestigationOrigin}
      onCompleteGraphRelations={props.onCompleteGraphRelations}
      onOpenGraphConfig={props.onOpenGraphConfig}
      onDrillDown={props.onDrillDown}
      onExcludeNode={props.onExcludeNode}
      onExcludeNodes={props.onExcludeNodes}
      onOpenEdgeDetail={props.onOpenEdgeDetail}
      onFocusChange={props.onFocusChange}
      onNodePositionsChange={props.onNodePositionsChange}
    />
  );
}
