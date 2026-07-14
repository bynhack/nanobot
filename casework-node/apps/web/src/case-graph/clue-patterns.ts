import { GADDI } from '@antv/algorithm';

import type { CaseGraphViewModel } from './graph-analysis';
import type { CaseGraphData } from './types';

export type CaseGraphCluePatternType = 'transit_chain' | 'convergence' | 'scatter' | 'cycle';

export interface CaseGraphCluePatternMatch {
  id: string;
  type: CaseGraphCluePatternType;
  label: string;
  caseTypes: string[];
  description: string;
  suggestion: string;
  nodeIds: string[];
  edgeIds: string[];
  score: number;
}

interface AlgorithmGraphNode {
  id: string;
  cluster: string;
}

interface AlgorithmGraphEdge {
  id: string;
  source: string;
  target: string;
  cluster: string;
}

const MAX_CLUE_PATTERNS = 6;
const MONEY_NODE_CLUSTER = '资金主体';
const MONEY_EDGE_CLUSTER = '资金线';

const TRANSIT_CHAIN_PATTERN = {
  nodes: [
    { id: 'source', cluster: MONEY_NODE_CLUSTER },
    { id: 'middle', cluster: MONEY_NODE_CLUSTER },
    { id: 'target', cluster: MONEY_NODE_CLUSTER },
  ],
  edges: [
    { source: 'source', target: 'middle', cluster: MONEY_EDGE_CLUSTER },
    { source: 'middle', target: 'target', cluster: MONEY_EDGE_CLUSTER },
  ],
};

const CYCLE_PATTERN = {
  nodes: [
    { id: 'a', cluster: MONEY_NODE_CLUSTER },
    { id: 'b', cluster: MONEY_NODE_CLUSTER },
    { id: 'c', cluster: MONEY_NODE_CLUSTER },
  ],
  edges: [
    { source: 'a', target: 'b', cluster: MONEY_EDGE_CLUSTER },
    { source: 'b', target: 'c', cluster: MONEY_EDGE_CLUSTER },
    { source: 'c', target: 'a', cluster: MONEY_EDGE_CLUSTER },
  ],
};

export function detectCaseGraphCluePatterns(
  graphData: CaseGraphData | null,
  viewModel: CaseGraphViewModel,
): CaseGraphCluePatternMatch[] {
  const nodes = graphData?.nodes ?? [];
  const edges = (graphData?.edges ?? []).filter((edge) => edge.edgeKind !== 'reality' && !edge.isExcluded);
  if (nodes.length < 2 || !edges.length) return [];

  const nodeIds = new Set(nodes.map((node) => node.id).filter(Boolean));
  const moneyEdges = edges.filter((edge) => nodeIds.has(edge.source || edge.from) && nodeIds.has(edge.target || edge.to));
  if (!moneyEdges.length) return [];

  const algorithmGraph = buildAlgorithmGraph(nodes, moneyEdges);
  const matches: CaseGraphCluePatternMatch[] = [];
  const seen = new Set<string>();
  const appendMatch = (match: CaseGraphCluePatternMatch) => {
    const signature = `${match.type}:${[...match.nodeIds].sort().join('|')}:${[...match.edgeIds].sort().join('|')}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    matches.push(match);
  };

  for (const match of runGaddi(algorithmGraph, TRANSIT_CHAIN_PATTERN)) {
    const orderedNodeIds = orderTransitChainNodes(match.nodes.map((node) => node.id), moneyEdges);
    if (orderedNodeIds.length !== 3) continue;
    const middleMetrics = viewModel.nodeMetricsById.get(orderedNodeIds[1]);
    if (!middleMetrics || middleMetrics.inDegree < 1 || middleMetrics.outDegree < 1) continue;
    const matchedEdges = resolveMatchedEdges(orderedNodeIds, moneyEdges);
    if (matchedEdges.length < 2) continue;
    const totalAmount = sumEdgeAmount(matchedEdges);
    appendMatch({
      id: `transit-chain:${orderedNodeIds.join('>')}`,
      type: 'transit_chain',
      label: '疑似中转过账',
      caseTypes: ['电诈资金转移', '跑分洗钱', '地下钱庄'],
      description: `${resolvePatternNodeName(orderedNodeIds[1], viewModel)} 同时承接来款并继续转出，呈现中间过渡账户特征。`,
      suggestion: '重点核查来款后是否短时间转出、转出对象是否集中，以及是否存在同设备、同 IP、同商户或现实关系。该提示只说明资金形态，不能直接作为犯罪结论。',
      nodeIds: orderedNodeIds,
      edgeIds: matchedEdges.map(resolvePatternEdgeId),
      score: totalAmount + middleMetrics.totalCount * 1000,
    });
  }

  for (const match of runGaddi(algorithmGraph, CYCLE_PATTERN)) {
    const matchedNodeIds = match.nodes.map((node) => node.id).filter(Boolean);
    const matchedEdges = match.edges
      .map((edge) => findMoneyEdge(moneyEdges, edge.source, edge.target))
      .filter((edge): edge is CaseGraphData['edges'][number] => Boolean(edge));
    if (matchedNodeIds.length < 3 || matchedEdges.length < 3) continue;
    appendMatch({
      id: `cycle:${matchedNodeIds.sort().join('|')}`,
      type: 'cycle',
      label: '疑似回流闭环',
      caseTypes: ['洗钱回流', '对敲交易', '利益输送'],
      description: '这些主体之间形成首尾相接的资金往来，呈现回流或互相走账形态。',
      suggestion: '重点核查资金是否回到原控制圈、交易间隔是否异常接近、双方是否存在亲属或公司关联。正常业务也可能形成闭环，需要结合材料核实。',
      nodeIds: matchedNodeIds,
      edgeIds: matchedEdges.map(resolvePatternEdgeId),
      score: sumEdgeAmount(matchedEdges) + matchedEdges.length * 1000,
    });
  }

  for (const metrics of viewModel.nodeMetricsById.values()) {
    if (metrics.inDegree >= 2) {
      const incomingEdges = moneyEdges.filter((edge) => edge.target === metrics.nodeId);
      appendMatch({
        id: `convergence:${metrics.nodeId}`,
        type: 'convergence',
        label: '疑似集中收款',
        caseTypes: ['电诈收款', '非法集资', '赌博资金归集'],
        description: `${metrics.displayName} 收到多个主体转入，呈现多来源资金归集形态。`,
        suggestion: '重点核查汇入主体是否分散、时间是否集中、金额是否接近，以及随后是否继续转出。该模式常见于收款账户，但也可能是正常经营收款。',
        nodeIds: [metrics.nodeId, ...metrics.incomingNeighbors],
        edgeIds: incomingEdges.map(resolvePatternEdgeId),
        score: metrics.receivedAmount + metrics.receivedCount * 1000,
      });
    }
    if (metrics.outDegree >= 2) {
      const outgoingEdges = moneyEdges.filter((edge) => edge.source === metrics.nodeId);
      appendMatch({
        id: `scatter:${metrics.nodeId}`,
        type: 'scatter',
        label: '疑似分散转移',
        caseTypes: ['分赃转移', '跑分洗钱', '地下钱庄'],
        description: `${metrics.displayName} 向多个主体转出，呈现拆分分散资金去向形态。`,
        suggestion: '重点核查是否存在小额拆分、快进快出、转出后继续下游扩散，以及转出对象是否属于同一控制圈。',
        nodeIds: [metrics.nodeId, ...metrics.outgoingNeighbors],
        edgeIds: outgoingEdges.map(resolvePatternEdgeId),
        score: metrics.sentAmount + metrics.sentCount * 1000,
      });
    }
  }

  return matches
    .filter((match) => match.nodeIds.length >= 2)
    .sort((left, right) => right.score - left.score || right.nodeIds.length - left.nodeIds.length)
    .slice(0, MAX_CLUE_PATTERNS);
}

function buildAlgorithmGraph(nodes: CaseGraphData['nodes'], edges: CaseGraphData['edges']) {
  return {
    nodes: nodes.map<AlgorithmGraphNode>((node) => ({
      id: node.id,
      cluster: MONEY_NODE_CLUSTER,
    })),
    edges: edges.map<AlgorithmGraphEdge>((edge) => ({
      id: resolvePatternEdgeId(edge),
      source: edge.source || edge.from,
      target: edge.target || edge.to,
      cluster: MONEY_EDGE_CLUSTER,
    })),
  };
}

function runGaddi(
  graph: { nodes: AlgorithmGraphNode[]; edges: AlgorithmGraphEdge[] },
  pattern: { nodes: AlgorithmGraphNode[]; edges: Array<Pick<AlgorithmGraphEdge, 'source' | 'target' | 'cluster'>> },
): Array<{ nodes: AlgorithmGraphNode[]; edges: AlgorithmGraphEdge[] }> {
  try {
    return GADDI(graph, pattern, true, undefined as unknown as number, undefined as unknown as number, 'cluster', 'cluster') as Array<{
      nodes: AlgorithmGraphNode[];
      edges: AlgorithmGraphEdge[];
    }>;
  } catch {
    return [];
  }
}

function orderTransitChainNodes(nodeIds: string[], edges: CaseGraphData['edges']): string[] {
  const uniqueNodeIds = [...new Set(nodeIds)];
  if (uniqueNodeIds.length !== 3) return [];
  for (const first of uniqueNodeIds) {
    for (const second of uniqueNodeIds) {
      if (second === first) continue;
      for (const third of uniqueNodeIds) {
        if (third === first || third === second) continue;
        if (findMoneyEdge(edges, first, second) && findMoneyEdge(edges, second, third)) {
          return [first, second, third];
        }
      }
    }
  }
  return [];
}

function resolveMatchedEdges(nodeIds: string[], edges: CaseGraphData['edges']): CaseGraphData['edges'] {
  const matched: CaseGraphData['edges'] = [];
  for (let index = 0; index < nodeIds.length - 1; index += 1) {
    const edge = findMoneyEdge(edges, nodeIds[index], nodeIds[index + 1]);
    if (edge) matched.push(edge);
  }
  return matched;
}

function findMoneyEdge(edges: CaseGraphData['edges'], source: string, target: string): CaseGraphData['edges'][number] | null {
  return edges.find((edge) => (edge.source || edge.from) === source && (edge.target || edge.to) === target) ?? null;
}

function sumEdgeAmount(edges: CaseGraphData['edges']): number {
  return edges.reduce((total, edge) => total + Number(edge.tradeAmount || edge.amount || 0), 0);
}

function resolvePatternEdgeId(edge: CaseGraphData['edges'][number]): string {
  return String(edge.id || `${edge.source || edge.from}->${edge.target || edge.to}`);
}

function resolvePatternNodeName(nodeId: string, viewModel: CaseGraphViewModel): string {
  return viewModel.nodeMetricsById.get(nodeId)?.displayName || nodeId;
}
