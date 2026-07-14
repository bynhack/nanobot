import { normalizeCaseGraphOriginData, originDataToCanvasData } from './adapters';
import type {
  CaseGraphQueryResult,
  CaseGraphSnapshot,
  CaseGraphState,
  CaseGraphTargetDetailResult,
  CaseGraphTradeCard,
} from './types';

export type CaseGraphAction =
  | { type: 'caseGraph.reset' }
  | { type: 'caseGraph.case.selected'; caseId: string | null }
  | { type: 'caseGraph.graph.loading' }
  | { type: 'caseGraph.graph.created'; graph: CaseGraphSnapshot }
  | { type: 'caseGraph.graph.loaded'; graph: CaseGraphSnapshot }
  | { type: 'caseGraph.graph.query.loading' }
  | { type: 'caseGraph.graph.query.loaded'; result: CaseGraphQueryResult }
  | { type: 'caseGraph.graph.drilldown.loading' }
  | { type: 'caseGraph.graph.drilldown.loaded'; tradeCards: CaseGraphTradeCard[] }
  | { type: 'caseGraph.edgeDetail.loading' }
  | { type: 'caseGraph.edgeDetail.loaded'; detail: CaseGraphTargetDetailResult }
  | { type: 'caseGraph.request.failed'; error: string };

export function createCaseGraphState(): CaseGraphState {
  return {
    activeCaseId: null,
    activeGraphId: null,
    graphDetail: null,
    graphData: null,
    originData: null,
    groupMap: {},
    tradeCards: [],
    edgeDetail: null,
    requests: {
      graphLoading: false,
      graphQueryLoading: false,
      drilldownLoading: false,
      edgeDetailLoading: false,
      graphCreateLoading: false,
    },
    error: null,
  };
}

export function reduceCaseGraphState(state: CaseGraphState, action: CaseGraphAction): CaseGraphState {
  switch (action.type) {
    case 'caseGraph.reset':
      return createCaseGraphState();
    case 'caseGraph.case.selected':
      if (state.activeCaseId === action.caseId) {
        return state;
      }
      return {
        ...createCaseGraphState(),
        activeCaseId: action.caseId,
      };
    case 'caseGraph.graph.loading':
      return withRequests(state, { graphLoading: true, graphCreateLoading: true }, null);
    case 'caseGraph.graph.created':
    case 'caseGraph.graph.loaded':
      return {
        ...state,
        activeCaseId: action.graph.caseId,
        activeGraphId: action.graph.graph_id,
        graphDetail: action.graph,
        originData: normalizeCaseGraphOriginData(action.graph.graphData),
        graphData: originDataToCanvasData(normalizeCaseGraphOriginData(action.graph.graphData)),
        groupMap: action.graph.groupMap ? { ...action.graph.groupMap } : {},
        tradeCards: [...action.graph.tradeCards],
        edgeDetail: null,
        requests: {
          ...state.requests,
          graphLoading: false,
          graphCreateLoading: false,
        },
        error: null,
      };
    case 'caseGraph.graph.query.loading':
      return withRequests(state, { graphQueryLoading: true }, null);
    case 'caseGraph.graph.query.loaded':
      return {
        ...state,
        originData: normalizeCaseGraphOriginData(action.result),
        graphData: originDataToCanvasData(normalizeCaseGraphOriginData(action.result)),
        groupMap: action.result.groups ? { ...action.result.groups } : state.groupMap,
        tradeCards: action.result.tradeCards ? [...action.result.tradeCards] : state.tradeCards,
        graphDetail: state.graphDetail
          ? {
              ...state.graphDetail,
              tradeCards: action.result.tradeCards ? [...action.result.tradeCards] : state.graphDetail.tradeCards,
              groupMap: action.result.groups ? { ...action.result.groups } : state.graphDetail.groupMap,
              excludedTrades: action.result.excludedTrades
                ? [...action.result.excludedTrades]
                : state.graphDetail.excludedTrades,
              excludedAccountId:
                action.result.excludedAccountId === undefined
                  ? state.graphDetail.excludedAccountId
                  : action.result.excludedAccountId,
              graphData: action.result,
            }
          : state.graphDetail,
        requests: {
          ...state.requests,
          graphQueryLoading: false,
        },
        error: null,
      };
    case 'caseGraph.graph.drilldown.loading':
      return withRequests(state, { drilldownLoading: true }, null);
    case 'caseGraph.graph.drilldown.loaded':
      return {
        ...state,
        tradeCards: [...action.tradeCards],
        graphDetail: state.graphDetail
          ? {
              ...state.graphDetail,
              tradeCards: [...action.tradeCards],
            }
          : state.graphDetail,
        requests: {
          ...state.requests,
          drilldownLoading: false,
        },
        error: null,
      };
    case 'caseGraph.edgeDetail.loading':
      return withRequests(state, { edgeDetailLoading: true }, null);
    case 'caseGraph.edgeDetail.loaded':
      return {
        ...state,
        edgeDetail: action.detail,
        requests: {
          ...state.requests,
          edgeDetailLoading: false,
        },
        error: null,
      };
    case 'caseGraph.request.failed':
      return {
        ...state,
        requests: {
          graphLoading: false,
          graphQueryLoading: false,
          drilldownLoading: false,
          edgeDetailLoading: false,
          graphCreateLoading: false,
        },
        error: action.error,
      };
    default:
      return state;
  }
}

function withRequests(
  state: CaseGraphState,
  patch: Partial<CaseGraphState['requests']>,
  error: string | null,
): CaseGraphState {
  return {
    ...state,
    requests: {
      ...state.requests,
      ...patch,
    },
    error,
  };
}
