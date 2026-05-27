import { X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { GraphCanvas } from './graph-canvas';
import { buildFlowGraphProjection, buildMergedNetworkGraph } from './graph-view-adapters';
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
  onOpenNodeDetailAnalysis: (node: CaseGraphNode) => void;
  onOpenNodeSummaryAnalysis: (node: CaseGraphNode) => void;
  onOpenGlobalSummaryAnalysis: () => void;
  onOpenManualNode: (position?: { x: number; y: number } | null) => void;
  onOpenManualTrade: (node?: CaseGraphNode | null) => void;
  onOpenRealityRelation: (node?: CaseGraphNode | null) => void;
  onExcludeNode: (node: CaseGraphExcludedNode) => void;
  onExcludeNodes: (nodes: CaseGraphExcludedNode[]) => void;
  onRestoreNode: (nodeId: string) => void;
  excluding: boolean;
  onOpenEdgeDetail: (edgeId: string, edgeFocus?: CaseGraphConversationFocus) => void;
  onFocusChange?: (focus: CaseGraphConversationFocus | null) => void;
  onNodePositionsChange?: (positions: Record<string, { x: number; y: number }>, reason: NodePositionsChangeReason) => void;
}

export function GraphView(props: GraphViewProps) {
  const [flowGraphOpen, setFlowGraphOpen] = useState(false);
  const mergedGraphData = useMemo(
    () => buildMergedNetworkGraph(props.graphData, props.groupMap),
    [props.graphData, props.groupMap],
  );
  const flowGraphData = useMemo(
    () => buildFlowGraphProjection(props.graphData, props.groupMap),
    [props.graphData, props.groupMap],
  );
  const flowEdgeCount = flowGraphData?.edges.length ?? 0;

  return (
    <>
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
        onOpenFlowGraph={() => setFlowGraphOpen(true)}
        onDrillDown={props.onDrillDown}
        onOpenNodeDetailAnalysis={props.onOpenNodeDetailAnalysis}
        onOpenNodeSummaryAnalysis={props.onOpenNodeSummaryAnalysis}
        onOpenGlobalSummaryAnalysis={props.onOpenGlobalSummaryAnalysis}
        onOpenManualNode={props.onOpenManualNode}
        onOpenManualTrade={props.onOpenManualTrade}
        onOpenRealityRelation={props.onOpenRealityRelation}
        onExcludeNode={props.onExcludeNode}
        onExcludeNodes={props.onExcludeNodes}
        onRestoreNode={props.onRestoreNode}
        onOpenEdgeDetail={props.onOpenEdgeDetail}
        onFocusChange={props.onFocusChange}
        onNodePositionsChange={props.onNodePositionsChange}
      />
      {flowGraphOpen ? (
        <div className="case-graph-modal-mask case-graph-modal-mask--detail" role="presentation" onClick={() => setFlowGraphOpen(false)}>
          <section
            className="case-graph-flow-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="case-graph-flow-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="case-graph-edge-detail-header">
              <div className="case-graph-detail-analysis-title">
                <h2 id="case-graph-flow-title">资金流向图</h2>
                <span>{flowGraphData?.nodes.length ?? 0} 个节点 · {flowEdgeCount} 条净流向</span>
              </div>
              <button
                type="button"
                className="case-graph-edge-detail-close"
                aria-label="关闭资金流向图"
                onClick={() => setFlowGraphOpen(false)}
              >
                <X size={20} />
              </button>
            </header>
            <div className="case-graph-flow-body">
              <GraphCanvas
                graphData={flowGraphData}
                tradeCards={props.tradeCards}
                focusAccountIds={props.focusAccountIds}
                focusLabels={props.focusLabels}
                loading={false}
                drilldownLoading={false}
                excluding={false}
                hasActiveTab={false}
                replayMode
                showCanvasTools={false}
                preferPersistedPositions={false}
                layoutMode="directed-flow"
                emptyMessage="当前图暂无可展示的资金流向。"
                onChooseInvestigationOrigin={() => {}}
                onCompleteGraphRelations={() => {}}
                onOpenGraphConfig={() => {}}
                onDrillDown={() => {}}
                onOpenNodeDetailAnalysis={() => {}}
                onOpenNodeSummaryAnalysis={() => {}}
                onOpenGlobalSummaryAnalysis={() => {}}
                onOpenManualNode={() => {}}
                onOpenManualTrade={() => {}}
                onOpenRealityRelation={() => {}}
                onExcludeNode={() => {}}
                onExcludeNodes={() => {}}
                onRestoreNode={() => {}}
                onOpenEdgeDetail={props.onOpenEdgeDetail}
                onFocusChange={props.onFocusChange}
              />
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
