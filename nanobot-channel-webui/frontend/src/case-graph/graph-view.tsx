import { useMemo } from 'react';

import { GraphCanvas } from './graph-canvas';
import { buildMergedNetworkGraph } from './graph-view-adapters';
import type {
  CaseGraphConversationFocus,
  CaseGraphData,
  CaseGraphGroupMap,
  CaseGraphTradeCard,
} from './types';

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
  onDrillDown: (direction: 'in' | 'out' | 'both', tradeCard: CaseGraphTradeCard) => void;
  onOpenEdgeDetail: (edgeId: string) => void;
  onFocusChange?: (focus: CaseGraphConversationFocus | null) => void;
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
      hasActiveTab={props.hasActiveTab}
      onDrillDown={props.onDrillDown}
      onOpenEdgeDetail={props.onOpenEdgeDetail}
      onFocusChange={props.onFocusChange}
    />
  );
}
