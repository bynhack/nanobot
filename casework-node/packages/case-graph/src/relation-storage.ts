import { GraphRepository } from "./graph-repository.js";
import { normalizeEvidence, type EvidenceLevel } from "./operation-evidence.js";
import { record, text, type JsonRecord } from "./state.js";

export const RELATION_SCHEMA_VERSION = "case-graph.relation.v1";

export class RelationGraphStorage {
  readonly repository: GraphRepository;
  constructor(caseGraphsRoot: string) {
    this.repository = new GraphRepository(caseGraphsRoot);
  }
  loadGraph(caseId: string, graphId: string) {
    return this.repository.loadGraph(caseId, graphId);
  }
  listSteps(caseId: string, graphId: string) {
    return this.repository.listSteps(caseId, graphId);
  }

  async saveStep(input: {
    caseId: string;
    graphId: string;
    stepType: string;
    request: JsonRecord;
    graph: JsonRecord;
    delta: JsonRecord;
    summary: JsonRecord;
    evidenceLevel?: EvidenceLevel;
  }): Promise<JsonRecord> {
    const evidence = normalizeEvidence(
      input.stepType,
      input.request.evidence,
      text(input.request.operation),
      input.evidenceLevel,
    );
    const params = { ...input.request };
    delete params.evidence;
    const result = await this.repository.appendStep({
      caseId: input.caseId,
      graphId: input.graphId,
      graphName: text(input.request.graphName),
      operation: {
        type: input.stepType,
        label: text(input.summary.label) || input.stepType,
        params,
        evidence,
      },
      graph: input.graph,
      delta: input.delta,
      summary: input.summary,
    });
    const step = record(result.step);
    return {
      schemaVersion: RELATION_SCHEMA_VERSION,
      caseId: input.caseId,
      graphId: input.graphId,
      queryMode: input.stepType,
      step: {
        stepId: step.stepId,
        type: input.stepType,
        createdAt: step.createdAt,
        request: input.request,
        evidence,
        summary: input.summary,
        file: step.file,
      },
      graph: record(record(result.graph).graph),
      graphState: result.graph,
      delta: input.delta,
    };
  }
}
