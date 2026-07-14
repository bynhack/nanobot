import { randomUUID } from "node:crypto";
import type { CaseGraphQueryClient, JsonRecord as R } from "./query-client.js";
import { RelationGraphStorage } from "./relation-storage.js";
import { CaseGraphStorage } from "./case-graph-storage.js";
import {
  evidenceFromBusinessFields,
  type EvidenceLevel,
} from "./operation-evidence.js";

export class RelationGraphService {
  constructor(
    private readonly query: CaseGraphQueryClient,
    private readonly storage: RelationGraphStorage,
    private readonly snapshots: CaseGraphStorage,
  ) {}
  async querySeedOneHop(p: R) {
    const x = normalizeQuery(p),
      before = positions(
        await this.loadOrEmpty(x.caseId, x.graphId),
        x.options,
      ),
      excluded = excludedNodes(before),
      seeds = activeSeeds(x.seeds);
    let incoming = await this.query.queryRelationOneHop({
      caseId: x.caseId,
      seedAccounts: seeds,
      direction: x.direction,
      filters: {
        ...x.filters,
        limit: x.drillNums,
        drillNums: x.drillNums,
        drillType: x.drillType,
      },
    });
    incoming = remapGraphToExistingNodes(before, incoming);
    const existingPairGraph = await this.queryExistingSeedPairRelations(
      x.caseId,
      before,
      seeds,
      excluded,
      {
        ...x.filters,
        limit: x.drillNums,
        drillNums: x.drillNums,
        drillType: x.drillType,
      },
    );
    if (array(existingPairGraph.edges).length)
      incoming = mergeGraphs(incoming, existingPairGraph);
    let graph = applyExcluded(mergeGraphs(before, incoming), excluded);
    graph.drillNums = x.drillNums;
    graph.drillType = x.drillType;
    await this.sync(x.graphId, graph, seeds);
    return this.save(
      x,
      "seed_one_hop",
      graph,
      delta(before, graph),
      {
        addedNodeCount: delta(before, graph).addedNodes.length,
        addedEdgeCount: delta(before, graph).addedEdges.length,
      },
      x.evidenceContext === "drill_with_changed_settings"
        ? "optional"
        : undefined,
    );
  }
  async completeCurrentGraph(p: R) {
    const { caseId, graphId } = ids(p),
      before = positions(await this.load(caseId, graphId), rec(p.options)),
      excluded = excludedNodes(before),
      accounts = excludeAccounts(normalizeAccounts(p.accounts), excluded);
    let incoming = await this.query.queryRelationBetweenAccounts({
        caseId,
        accounts,
        filters: rec(p.filters),
      });
    incoming = remapGraphToExistingNodes(before, incoming);
    const graph = applyExcluded(mergeGraphs(before, incoming), excluded);
    await this.sync(graphId, graph, accounts);
    return this.save(
      { ...p, caseId, graphId },
      "complete_current_graph",
      graph,
      delta(before, graph),
      {
        addedNodeCount: delta(before, graph).addedNodes.length,
        addedEdgeCount: delta(before, graph).addedEdges.length,
        excludedNodeCount: excludedNodes(graph).length,
      },
    );
  }
  async filterCurrentGraph(p: R) {
    const { caseId, graphId } = ids(p),
      before = positions(await this.load(caseId, graphId), rec(p.options)),
      graph = applyExcluded(
        filterGraphFromTradeFacts(before, rec(p.filters)),
        excludedNodes(before),
      );
    await this.sync(graphId, graph, accountsFromGraph(graph));
    const d = delta({ ...before, edges: [] }, graph);
    return this.save(p, "filter_current_graph", graph, d, {
      label: "全图筛选",
      addedNodeCount: d.addedNodes.length,
      addedEdgeCount: d.addedEdges.length,
      filterCount: Object.values(rec(p.filters)).filter(
        (v) => v !== "" && v != null && (!Array.isArray(v) || v.length),
      ).length,
      excludedNodeCount: excludedNodes(graph).length,
    });
  }
  async excludeTrades(p: R) {
    const { caseId, graphId } = ids(p),
      before = positions(await this.load(caseId, graphId), rec(p.options)),
      old = new Set(strings(before.excludedTrades)),
      next = strings(p.excludedTrades),
      facts = { ...factsMap(before.tradeFacts), ...factsMap(p.tradeFacts) },
      edgeMap = rec(p.edgeTradeIds),
      graph = applyTradeExclusions(
        { ...before, tradeFacts: facts, excludedTrades: next },
        next,
        edgeMap,
      );
    await this.sync(graphId, graph, accountsFromGraph(graph));
    return this.save(
      p,
      "detail_trade_filter",
      graph,
      delta(before, graph),
      {
        label: "交易核查",
        excludedTradeCount: next.length,
        tradeFactCount: Object.keys(facts).length,
        edgeCount: array(graph.edges).length,
      },
      next.some((id) => !old.has(id)) ? "required" : "optional",
    );
  }
  async excludeNode(p: R) {
    const { caseId, graphId } = ids(p),
      graph = await this.load(caseId, graphId),
      raw = p.nodes ?? (isRec(p.node) ? [p.node] : null);
    if (!Array.isArray(raw)) throw new FieldError("node");
    const add = raw.filter(isRec).map((n) => normalizeExcluded(n, graph));
    if (!add.length) throw new FieldError("node");
    const merged = mergeExcluded(excludedNodes(graph), add),
      next = applyExcluded(graph, merged);
    await this.sync(graphId, next, accountsFromGraph(next));
    return this.save(
      p,
      "manual_exclude_node",
      next,
      { addedNodes: [], addedEdges: [], updatedNodes: add, updatedEdges: [] },
      { excludedNodeCount: merged.length, updatedNodeCount: add.length },
      text(p.evidenceContext) === "candidate_subject_changes"
        ? "optional"
        : undefined,
    );
  }
  restoreNode(p: R) {
    return this.restoreNodes({ ...p, nodeIds: [req(p.nodeId, "nodeId")] });
  }
  async restoreNodes(p: R) {
    const { caseId, graphId } = ids(p),
      idsToRestore = strings(p.nodeIds);
    if (!idsToRestore.length) throw new FieldError("nodeIds");
    let graph = positions(await this.load(caseId, graphId), rec(p.options));
    graph = applyExcluded(
      graph,
      excludedNodes(graph).filter(
        (n) => !idsToRestore.includes(text(n.nodeId)),
      ),
    );
    await this.sync(graphId, graph, accountsFromGraph(graph));
    return this.save(
      p,
      "manual_restore_node",
      graph,
      {
        addedNodes: [],
        addedEdges: [],
        updatedNodes: idsToRestore.map((nodeId) => ({ nodeId })),
        updatedEdges: [],
      },
      { excludedNodeCount: excludedNodes(graph).length },
    );
  }
  async applyInvestigationGroup(p: R) {
    const { caseId, graphId } = ids(p),
      op = req(p.operation, "operation");
    if (
      ![
        "create",
        "update",
        "collapse",
        "expand",
        "ungroup",
        "remove_member",
        "add_members",
      ].includes(op)
    )
      throw new FieldError("operation");
    const options = rec(p.options);
    let graph = await this.load(caseId, graphId);
    let valid = new Set(array(graph.nodes).map((n) => text(rec(n).id)).filter(Boolean));
    let groups = normalizeInvestigationGroups(graph.investigationGroups, valid);
    const groupId = text(p.groupId),
      ignoredPositionNodeIds = investigationGroupPositionIgnoreIds(
        groups,
        op,
        groupId,
        p,
      );
    graph = positions(graph, options, ignoredPositionNodeIds);
    valid = new Set(array(graph.nodes).map((n) => text(rec(n).id)).filter(Boolean));
    groups = normalizeInvestigationGroups(graph.investigationGroups, valid);
    const before = structuredClone(graph),
      excluded = new Set(excludedNodes(graph).map((n) => text(n.nodeId)).filter(Boolean)),
      groupPosition = point(p.groupPosition),
      now = new Date().toISOString();
    let updated: R[] = [],
      removedGroupIds: string[] = [];
    if (op === "create") {
      const members = uniq(
        strings(p.nodeIds).filter((id) => valid.has(id) && !excluded.has(id)),
      );
      if (members.length < 2) throw new FieldError("nodeIds");
      [groups, removedGroupIds] = removeInvestigationGroupMembers(groups, members);
      const g = {
        id:
          groupId ||
          `investigation_group:${randomUUID().replaceAll("-", "")}`,
        name: text(p.name) || `研判组 ${groups.length + 1}`,
        memberNodeIds: members,
        groupType: text(p.groupType),
        note: text(p.note),
        collapsed: Boolean(p.collapsed),
        createdAt: now,
        updatedAt: now,
        ...groupPosition,
      };
      groups.push(g);
      updated = [g];
    } else {
      const id = req(groupId, "groupId");
      let membersToAdd: string[] = [];
      if (op === "add_members") {
        membersToAdd = uniq(
          strings(p.memberNodeIds ?? p.nodeIds).filter(
            (nodeId) => valid.has(nodeId) && !excluded.has(nodeId),
          ),
        );
        if (!membersToAdd.length) throw new FieldError("memberNodeIds");
        const [detachedGroups, removed] = removeInvestigationGroupMembers(
          groups,
          membersToAdd,
        );
        groups = detachedGroups;
        removedGroupIds.push(...removed);
      }
      let found = false;
      groups = groups.flatMap((g) => {
        if (text(g.id) !== id) return [g];
        found = true;
        if (op === "ungroup") {
          removedGroupIds.push(id);
          return [];
        }
        let n = { ...g };
        if (op === "update") {
          for (const k of ["name", "groupType", "note"])
            if (k in p) n[k] = text(p[k]);
          if ("collapsed" in p) n.collapsed = Boolean(p.collapsed);
        }
        if (op === "collapse")
          n = { ...n, collapsed: true, ...groupPosition };
        if (op === "expand") n.collapsed = false;
        if (op === "remove_member") {
          const remove = uniq(
            [...strings(p.memberNodeIds), text(p.memberNodeId)].filter(Boolean),
          );
          if (!remove.length) throw new FieldError("memberNodeId");
          n.memberNodeIds = strings(n.memberNodeIds).filter(
            (x) => !remove.includes(x),
          );
          if (n.memberNodeIds.length < 2) {
            removedGroupIds.push(id);
            return [];
          }
        }
        if (op === "add_members") {
          n.memberNodeIds = uniq([...strings(n.memberNodeIds), ...membersToAdd]);
          if (n.memberNodeIds.length < 2) throw new FieldError("memberNodeIds");
          n = { ...n, ...groupPosition };
        }
        n.updatedAt = now;
        updated = [n];
        return [n];
      });
      if (!found) throw new FieldError("groupId");
    }
    graph.investigationGroups = groups;
    await this.sync(graphId, graph, accountsFromGraph(graph));
    const d: R = delta(before, graph);
    d.updatedGroups = updated;
    d.removedGroupIds = uniq(removedGroupIds);
    const labels: Record<string, string> = {
      create: "归并成组",
      update: "编辑研判组",
      collapse: "收起研判组",
      expand: "展开研判组",
      ungroup: "拆分研判组",
      remove_member: "移出研判组",
      add_members: "加入研判组",
    };
    return this.save(
      {
        caseId,
        graphId,
        operation: op,
        groupId: p.groupId,
        nodeIds: strings(p.nodeIds),
        memberNodeId: text(p.memberNodeId) || null,
        memberNodeIds: strings(p.memberNodeIds),
        name: text(p.name) || null,
        groupType: text(p.groupType) || null,
        note: text(p.note) || null,
        collapsed: "collapsed" in p ? p.collapsed : null,
        groupPosition: Object.keys(groupPosition).length ? groupPosition : null,
        options,
        evidence: p.evidence,
      },
      `investigation_group_${op}`,
      graph,
      d,
      {
        label: labels[op],
        groupCount: groups.length,
        updatedGroupCount: updated.length,
        removedGroupCount: uniq(removedGroupIds).length,
        memberNodeCount: updated.length
          ? strings(updated[0]!.memberNodeIds).length
          : 0,
      },
    );
  }
  async addManualNode(p: R) {
    const { caseId, graphId } = ids(p),
      label = req(p.label || p.name || p.accountName, "label"),
      graph = positions(await this.load(caseId, graphId), rec(p.options)),
      nodes = new Map(
        array(graph.nodes)
          .filter(isRec)
          .map((node) => [text(node.id), rec(node)]),
      ),
      card = text(p.tradeCard);
    if (!nodes.size) throw new FieldError("graphAnchor");
    if (card && existingNodeIdentityIndex(graph).has(`tradeCard:${card}`))
      throw new FieldError("duplicateTradeCard");
    const id = `manual:node:${randomUUID().replaceAll("-", "")}`,
      discoveryReason = text(p.discoveryReason),
      sourceNote = text(p.sourceNote),
      note = text(p.note),
      node: R = {
        id,
        label,
        name: label,
        accountName: label,
        accountId: id,
        tradeCard: card,
        type: "manual",
        source: "manual",
        isManual: true,
        discoveryReason,
        sourceNote,
        note,
        createdAt: new Date().toISOString(),
        accounts: card
          ? [
              {
                accountId: id,
                accountName: label,
                tradeCard: card,
                source: "manual",
                discoveryReason,
                sourceNote,
              },
            ]
          : [],
        ...point(p.position),
      };
    ensureDetachedNodePosition(node, nodes);
    nodes.set(id, node);
    graph.nodes = [...nodes.values()];
    const layout = rec(graph.layout);
    layout.nodePositions = {
      ...rec(layout.nodePositions),
      [id]: { x: node.x, y: node.y },
    };
    graph.layout = layout;
    await this.sync(graphId, graph, accountsFromGraph(graph));
    return this.save(
      {
        ...p,
        evidence:
          p.evidence ??
          evidenceFromBusinessFields("人工补充主体依据", [
            ["发现原因", discoveryReason],
            ["来源材料", sourceNote],
            ["情况说明", note],
          ]),
      },
      "manual_node_add",
      graph,
      {
        addedNodes: [node],
        addedEdges: [],
        updatedNodes: [],
        updatedEdges: [],
      },
      { label: "创建交易主体", nodeLabel: label, addedNodeCount: 1, addedEdgeCount: 0 },
    );
  }
  async addManualTrade(p: R) {
    const { caseId, graphId } = ids(p),
      graph = positions(await this.load(caseId, graphId), rec(p.options)),
      before = structuredClone(graph),
      nodes = new Map(
        array(graph.nodes)
          .filter(isRec)
          .map((node) => [text(node.id), rec(node)]),
      );
    if (!isRec(p.payer)) throw new FieldError("payer");
    if (!isRec(p.payee)) throw new FieldError("payee");
    const [payer, payerCreated] = resolveManualParty(rec(p.payer), nodes),
      [payee, payeeCreated] = resolveManualParty(rec(p.payee), nodes);
    if (payer.id === payee.id) throw new FieldError("counterparty");
    if (payerCreated && payeeCreated) throw new FieldError("graphAnchor");
    const amount = Number(p.amount);
    if (!Number.isFinite(amount) || amount < 0) throw new FieldError("amount");
    ensureManualNodePosition(payer, payee, payerCreated, -1);
    ensureManualNodePosition(payee, payer, payeeCreated, 1);
    nodes.set(text(payer.id), payer);
    nodes.set(text(payee.id), payee);
    const tradeId = `manual:trade:${randomUUID().replaceAll("-", "")}`,
      tradeTime = text(p.tradeTime) || null,
      method = text(p.method) || "其他",
      summary = text(p.summary),
      sourceNote = text(p.sourceNote || p.note),
      createdAt = new Date().toISOString(),
      fact: R = {
        tradeId,
        serialNumber: tradeId,
        tradeAmount: amount,
        tradeTime,
        tradeAbstract: summary || `人工补充${method}资金往来`,
        payerAccountId: text(payer.id),
        payerTradeCard: text(payer.tradeCard),
        payerAccountName: nodeDisplayName(payer),
        payeeAccountId: text(payee.id),
        payeeTradeCard: text(payee.tradeCard),
        payeeAccountName: nodeDisplayName(payee),
        source: "manual",
        method,
        sourceNote,
        createdAt,
      },
      facts = { ...factsMap(graph.tradeFacts), [tradeId]: fact },
      edgeId = `money:${text(payer.id)}->${text(payee.id)}`,
      edges = new Map<string, R>();
    for (const value of array(graph.edges)) {
      if (!isRec(value)) continue;
      const edge = rec(value),
        [source, target] = edgeEndpoints(edge);
      if (!source || !target || source === target) continue;
      edges.set(`money:${source}->${target}`, {
        ...edge,
        id: `money:${source}->${target}`,
        from: source,
        to: target,
        source,
        target,
      });
    }
    const existing = edges.get(edgeId),
      tradeIds = [...strings(existing?.tradeIds), tradeId],
      knownFacts = tradeIds.filter((id) => facts[id]).map((id) => facts[id]!),
      edge: R = existing
        ? knownFacts.length === tradeIds.length
          ? recomputeEdge({ ...existing, tradeIds }, knownFacts)
          : {
              ...existing,
              tradeIds,
              tradeAmount: (finite(existing.tradeAmount ?? existing.amount) || 0) + amount,
              amount: (finite(existing.tradeAmount ?? existing.amount) || 0) + amount,
              tradeCount: (finite(existing.tradeCount ?? existing.count) || 0) + 1,
              count: (finite(existing.tradeCount ?? existing.count) || 0) + 1,
            }
        : {
            id: edgeId,
            from: payer.id,
            to: payee.id,
            source: payer.id,
            target: payee.id,
            tradeCount: 1,
            count: 1,
            tradeAmount: amount,
            amount,
            tradeIds: [tradeId],
            scope: "manual",
          };
    edge.manualTradeCount = (finite(edge.manualTradeCount) || 0) + 1;
    edge.hasManualTrade = true;
    edge.sourceTypes = uniq([...strings(edge.sourceTypes), "manual"]).sort();
    if (tradeTime) {
      edge.startTime ||= tradeTime;
      edge.endTime ||= tradeTime;
      edge.startDate ||= tradeTime;
      edge.endDate ||= tradeTime;
    }
    edges.set(edgeId, edge);
    const manualEdge = {
      id: `manual:edge:${randomUUID().replaceAll("-", "")}`,
      from: payer.id,
      to: payee.id,
      source: payer.id,
      target: payee.id,
      tradeIds: [tradeId],
      tradeAmount: amount,
      tradeCount: 1,
      method,
      summary,
      sourceNote,
      createdAt,
    };
    graph.nodes = [...nodes.values()];
    graph.edges = [...edges.values()];
    graph.tradeFacts = facts;
    graph.manualEdges = [...array(graph.manualEdges), manualEdge];
    const layout = rec(graph.layout),
      layoutPositions = rec(layout.nodePositions);
    for (const node of [payer, payee])
      if (finite(node.x) !== null && finite(node.y) !== null)
        layoutPositions[text(node.id)] = { x: node.x, y: node.y };
    graph.layout = { ...layout, nodePositions: layoutPositions };
    await this.sync(graphId, graph, accountsFromGraph(graph));
    const d = delta(before, graph);
    if (existing && !d.addedEdges.some((item: R) => text(item.id) === edgeId))
      d.updatedEdges = [edge];
    return this.save(
      {
        ...p,
        evidence:
          p.evidence ??
          evidenceFromBusinessFields("人工补充资金往来依据", [
            ["线索来源", sourceNote],
            ["情况说明", summary],
          ]),
      },
      "manual_trade_add",
      graph,
      d,
      {
        label: "补充资金往来",
        amount,
        method,
        addedNodeCount: d.addedNodes.length,
        addedEdgeCount: d.addedEdges.length,
        updatedEdgeCount: d.updatedEdges.length,
      },
    );
  }
  async addRealityRelation(p: R) {
    const { caseId, graphId } = ids(p),
      source = req(p.sourceNodeId || p.source, "sourceNodeId"),
      target = req(p.targetNodeId || p.target, "targetNodeId"),
      kind = req(p.relationType || p.label, "relationType");
    if (source === target) throw new FieldError("counterparty");
    const graph = positions(await this.load(caseId, graphId), rec(p.options)),
      nodes = new Set(array(graph.nodes).map((n) => text(rec(n).id)));
    if (!nodes.has(source)) throw new FieldError("sourceNodeId");
    if (!nodes.has(target)) throw new FieldError("targetNodeId");
    const rel = {
      id: text(p.relationId) || `reality:${randomUUID().replaceAll("-", "")}`,
      source,
      target,
      sourceNodeId: source,
      targetNodeId: target,
      relationType: kind,
      label: text(p.label) || kind,
      note: text(p.note),
      sourceType: "manual",
      createdAt: new Date().toISOString(),
    },
      previous = array(graph.realityRelations).filter(isRec).map(rec),
      same = (item: R) =>
        text(item.source || item.sourceNodeId) === source &&
        text(item.target || item.targetNodeId) === target &&
        text(item.relationType || item.label) === kind,
      existing = previous.find(same);
    if (existing) {
      rel.id = text(existing.id) || rel.id;
      graph.realityRelations = previous.map((item) =>
        same(item) ? { ...item, ...rel } : item,
      );
    } else graph.realityRelations = [...previous, rel];
    await this.sync(graphId, graph, accountsFromGraph(graph));
    const d: R = delta(graph, graph);
    d.addedRealityRelations = existing ? [] : [rel];
    d.updatedRealityRelations = existing ? [rel] : [];
    return this.save(
      {
        ...p,
        evidence:
          p.evidence ??
          evidenceFromBusinessFields("现实关系信息", [
            ["关系类型", kind],
            ["说明", p.note],
          ]),
      },
      "reality_relation_add",
      graph,
      d,
      {
        label: "标注现实关系",
        relationType: kind,
        relationCount: array(graph.realityRelations).length,
      },
    );
  }
  async querySummaryCandidates(p: R) {
    const { caseId, graphId } = ids(p),
      graph = await this.load(caseId, graphId),
      focus = text(p.focusNodeId);
    if (!focus) {
      const q = await this.query.queryRelationGlobalCandidates({
          caseId,
          filters: { limit: 500 },
        }),
        items = summaryItemsFromGlobalCandidates(graph, array(q.items));
      return {
        caseId,
        graphId,
        focusNodeId: null,
        direction: "both",
        scope: "global",
        items,
      };
    }
    const focusAccounts = normalizeAccounts(p.focusNodeAccounts);
    if (!array(graph.nodes).some((n) => text(rec(n).id) === focus))
      throw new FieldError("focusNodeId");
    if (!focusAccounts.length) {
      const node = rec(
        array(graph.nodes).find((n) => text(rec(n).id) === focus),
      );
      focusAccounts.push(...normalizeAccounts(node.accounts ?? [node]));
    }
    if (!focusAccounts.length) throw new FieldError("focusNodeAccounts");
    const direction = ["in", "out", "both"].includes(text(p.direction))
        ? text(p.direction)
        : "both",
      raw = await this.query.queryRelationOneHop({
        caseId,
        seedAccounts: focusAccounts,
        direction,
        filters: { limit: 500 },
      }),
      q = remapGraphToExistingNodes(graph, raw),
      items = summaryItemsFromGraph(graph, q, focus, focusAccounts);
    return { caseId, graphId, focusNodeId: focus, direction, items };
  }
  async applySummarySelection(p: R) {
    const { caseId, graphId } = ids(p),
      before = positions(await this.load(caseId, graphId), rec(p.options)),
      candidateIds = strings(p.candidateNodeIds),
      allowed = new Set(candidateIds),
      selected = new Set(
        strings(p.selectedNodeIds).filter(
          (id) => !allowed.size || allowed.has(id),
        ),
      ),
      selectedCandidates = array(p.selectedCandidates ?? p.candidateAccounts)
        .filter(isRec)
        .filter((x) => !selected.size || selected.has(text(x.nodeId || x.id))),
      selectedAccounts = uniqAccounts([
        ...accountsForNodeIds(before, candidateIds, selected),
        ...normalizeAccounts(
          selectedCandidates.flatMap((x) =>
            array(x.accounts).length ? x.accounts : [x],
          ),
        ),
      ]);
    let graph = before;
    if (!text(p.focusNodeId)) {
      const nodes = selectedCandidates
        .map(summaryCandidateNode)
        .filter((n) => text(n.id));
      graph = mergeGraphs(graph, { nodes, edges: [], tradeFacts: {} });
    } else {
      const focus = rec(
        array(before.nodes).find(
          (n) => text(rec(n).id) === text(p.focusNodeId),
        ),
      );
      const focusAccounts = normalizeAccounts(
        array(focus.accounts).length ? focus.accounts : [focus],
      );
      if (!focusAccounts.length) throw new FieldError("focusNodeAccounts");
      if (selectedAccounts.length) {
        let incoming = await this.query.queryRelationBetweenAccounts({
          caseId,
          accounts: uniqAccounts([...focusAccounts, ...selectedAccounts]),
          filters: { _relationUnbounded: true },
        });
        incoming = remapGraphToExistingNodes(before, incoming);
        const focusKeys = accountKeys(focusAccounts),
          selectedKeys = accountKeys(selectedAccounts),
          edges = array(incoming.edges)
            .filter(isRec)
            .filter((e) => {
              const s = rec(
                  array(incoming.nodes).find(
                    (n) => text(rec(n).id) === text(e.source),
                  ),
                ),
                t = rec(
                  array(incoming.nodes).find(
                    (n) => text(rec(n).id) === text(e.target),
                  ),
                );
              return (
                (nodeMatches(s, focusKeys) && nodeMatches(t, selectedKeys)) ||
                (nodeMatches(t, focusKeys) && nodeMatches(s, selectedKeys))
              );
            }),
          nodeIds = new Set(
            edges.flatMap((e) => [text(e.source), text(e.target)]),
          ),
          tradeIds = new Set(edges.flatMap((e) => strings(e.tradeIds)));
        incoming = {
          ...incoming,
          nodes: array(incoming.nodes).filter((n) =>
            nodeIds.has(text(rec(n).id)),
          ),
          edges,
          tradeFacts: Object.fromEntries(
            Object.entries(factsMap(incoming.tradeFacts)).filter(([id]) =>
              tradeIds.has(id),
            ),
          ),
        };
        graph = mergeGraphs(graph, incoming);
      }
    }
    const keys = accountKeys(selectedAccounts),
      nextExcluded = excludedNodes(graph).filter(
        (n) => !nodeMatches(rec(n.node ?? n), keys),
      );
    graph = applyExcluded(graph, nextExcluded);
    await this.sync(graphId, graph, accountsFromGraph(graph));
    const d = delta(before, graph);
    d.updatedNodes = candidateIds.map((nodeId) => ({
      nodeId,
      selected: selected.has(nodeId),
    }));
    return this.save(
      {
        ...p,
        focusNodeId: text(p.focusNodeId) || null,
        scope: text(p.focusNodeId) ? "node" : "global",
      },
      "summary_analysis",
      graph,
      d,
      {
        label: "线索扩展",
        candidateNodeCount: candidateIds.length,
        retainedNodeCount: selected.size,
        excludedNodeCount: nextExcluded.length,
        addedNodeCount: d.addedNodes.length,
        addedEdgeCount: d.addedEdges.length,
      },
    );
  }
  private load(c: string, g: string) {
    return this.storage.loadGraph(c, g);
  }
  private async loadOrEmpty(c: string, g: string) {
    try {
      return await this.load(c, g);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw e;
    }
  }
  private async queryExistingSeedPairRelations(
    caseId: string,
    currentGraph: R,
    seedAccounts: R[],
    excluded: R[],
    filters: R,
  ) {
    if (!array(currentGraph.nodes).length || !seedAccounts.length)
      return { nodes: [], edges: [] };
    const currentAccounts = excludeAccounts(
        accountsFromGraph(currentGraph),
        excluded,
      ),
      existingAccounts = accountsExcludingSeeds(currentAccounts, seedAccounts);
    if (!existingAccounts.length) return { nodes: [], edges: [] };
    let graph = await this.query.queryRelationBetweenAccounts({
      caseId,
      accounts: uniqAccounts([...seedAccounts, ...existingAccounts]),
      filters,
    });
    graph = remapGraphToExistingNodes(currentGraph, graph);
    return filterGraphToSeedExistingEdges(
      currentGraph,
      graph,
      seedAccounts,
    );
  }
  private async sync(id: string, g: R, c: R[]) {
    await this.snapshots.updateGraph(id, { graphData: g, tradeCards: c });
  }
  private save(p: R, type: string, g: R, d: R, s: R, level?: EvidenceLevel) {
    return this.storage.saveStep({
      caseId: text(p.caseId),
      graphId: text(p.graphId),
      stepType: type,
      request: p,
      graph: g,
      delta: d,
      summary: s,
      ...(level ? { evidenceLevel: level } : {}),
    });
  }
}
export class FieldError extends Error {
  constructor(public field: string) {
    super(field);
  }
}
function normalizeQuery(p: R) {
  const { caseId, graphId } = ids(p),
    seeds = array(p.seeds)
      .filter(isRec)
      .map((s) => {
        const ids = strings(s.accountIds),
          excluded = new Set(strings(s.excludedAccountIds)),
          active = ids.filter((x) => !excluded.has(x));
        return {
          suspectId: text(s.suspectId),
          suspectName: text(s.suspectName),
          accountIds: ids,
          excludedAccountIds: [...excluded].sort(),
          activeAccountIds: active,
          accounts: normalizeAccounts(s.accounts).filter((a) =>
            active.includes(text(a.accountId)),
          ),
        };
      })
      .filter((s) => s.activeAccountIds.length);
  if (!seeds.length) throw new FieldError("seeds");
  const dir = ["in", "out", "both"].includes(text(p.direction))
    ? text(p.direction)
    : "both";
  return {
    ...p,
    caseId,
    graphId,
    seeds,
    direction: dir,
    drillNums: positive(p.drillNums ?? p.limit, 10),
    drillType: [1, 2, 3].includes(Number(p.drillType))
      ? Number(p.drillType)
      : 1,
    filters: rec(p.filters),
    options: rec(p.options),
    evidence: isRec(p.evidence) ? p.evidence : null,
    evidenceContext: text(p.evidenceContext),
  };
}
function activeSeeds(seeds: R[]): R[] {
  const accounts: R[] = [],
    seen = new Set<string>();
  for (const seed of seeds) {
    const suspectId = text(seed.suspectId),
      suspectName = text(seed.suspectName),
      accountIndex = new Map(
        array(seed.accounts)
          .filter(isRec)
          .map((account) => [text(account.accountId), account]),
      );
    for (const accountId of strings(seed.activeAccountIds)) {
      if (seen.has(accountId)) continue;
      seen.add(accountId);
      const account = rec(accountIndex.get(accountId));
      accounts.push({
        accountId,
        tradeCard: text(account.tradeCard || account.payAccount),
        accountName: text(account.accountName || suspectName),
        suspectId,
        suspectName,
      });
    }
  }
  return accounts;
}
function ids(p: R) {
  return {
    caseId: req(p.caseId, "caseId"),
    graphId: req(p.graphId, "graphId"),
  };
}
function req(v: unknown, k: string) {
  const x = text(v);
  if (!x) throw new FieldError(k);
  return x;
}
function text(v: unknown) {
  return v == null ? "" : String(v).trim();
}
function rec(v: unknown): R {
  return isRec(v) ? { ...v } : {};
}
function isRec(v: unknown): v is R {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function array(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function strings(v: unknown): string[] {
  return array(v).map(text).filter(Boolean);
}
function uniq<T>(x: T[]): T[] {
  return [...new Set(x)];
}
function positive(v: unknown, d: number) {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.max(1, Math.min(n, 1000)) : d;
}
function point(v: unknown): R {
  const p = rec(v),
    x = Number(p.x),
    y = Number(p.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : {};
}
function normalizeAccounts(v: unknown): R[] {
  return array(v)
    .filter(isRec)
    .map((a) => ({
      accountId: text(a.accountId || a.id),
      tradeCard: text(a.tradeCard || a.payAccount),
      accountName: text(a.accountName || a.name || a.label),
    }))
    .filter((a) => a.accountId || a.tradeCard || a.accountName);
}
function accountsFromGraph(g: R) {
  const excluded = new Set(
    excludedNodes(g).map((item) => text(item.nodeId)).filter(Boolean),
  );
  return normalizeAccounts(
    array(g.nodes)
      .filter(isRec)
      .filter(
        (node) =>
          !Boolean(rec(node).isExcluded) &&
          !excluded.has(text(rec(node).id)),
      )
      .flatMap((n) => (array(n.accounts).length ? n.accounts : [n])),
  );
}

function excludeAccounts(accounts: R[], excluded: R[]) {
  const ids = new Set(excluded.flatMap((item) => strings(item.accountIds))),
    cards = new Set(excluded.flatMap((item) => strings(item.tradeCards)));
  if (!ids.size && !cards.size) return accounts;
  return accounts.filter(
    (account) =>
      !ids.has(text(account.accountId)) &&
      !cards.has(text(account.tradeCard || account.payAccount)),
  );
}

function accountsExcludingSeeds(accounts: R[], seeds: R[]) {
  const ids = new Set(seeds.map((item) => text(item.accountId)).filter(Boolean)),
    cards = new Set(
      seeds
        .map((item) => text(item.tradeCard || item.payAccount))
        .filter(Boolean),
    );
  return accounts.filter(
    (account) =>
      !ids.has(text(account.accountId)) &&
      !cards.has(text(account.tradeCard || account.payAccount)),
  );
}

function nodeIdsForAccounts(graph: R, accounts: R[]) {
  const index = existingNodeIdentityIndex(graph),
    result = new Set<string>();
  for (const account of accounts) {
    const accountId = text(account.accountId),
      tradeCard = text(account.tradeCard || account.payAccount),
      byId = accountId
        ? index.get(`accountId:${accountId}`) ||
          index.get(`account:${accountId}`)
        : "",
      byCard = tradeCard ? index.get(`tradeCard:${tradeCard}`) : "";
    if (byId) result.add(byId);
    if (byCard) result.add(byCard);
  }
  return result;
}

function accountsForNodeIds(
  graph: R,
  candidateNodeIds: string[],
  selectedNodeIds: Set<string>,
) {
  const candidates = new Set(candidateNodeIds),
    selected = selectedNodeIds.size
      ? selectedNodeIds
      : candidates,
    accounts: unknown[] = [];
  for (const value of array(graph.nodes)) {
    if (!isRec(value)) continue;
    const node = rec(value), id = text(node.id);
    if (!selected.has(id)) continue;
    accounts.push(...(array(node.accounts).length ? array(node.accounts) : [node]));
  }
  return normalizeAccounts(accounts);
}

function filterGraphToSeedExistingEdges(
  currentGraph: R,
  incomingGraph: R,
  seedAccounts: R[],
): R {
  const currentNodes = new Map(
      array(currentGraph.nodes)
        .filter(isRec)
        .map((node) => [text(node.id), rec(node)]),
    ),
    seedNodeIds = nodeIdsForAccounts(currentGraph, seedAccounts);
  if (!seedNodeIds.size || currentNodes.size <= seedNodeIds.size)
    return { nodes: [], edges: [] };
  const edges: R[] = [],
    retainedNodeIds = new Set<string>();
  for (const value of array(incomingGraph.edges)) {
    if (!isRec(value)) continue;
    const edge = rec(value),
      source = text(edge.from || edge.source),
      target = text(edge.to || edge.target);
    if (
      !source ||
      !target ||
      source === target ||
      !currentNodes.has(source) ||
      !currentNodes.has(target) ||
      seedNodeIds.has(source) === seedNodeIds.has(target)
    )
      continue;
    edges.push({
      ...edge,
      id: `money:${source}->${target}`,
      from: source,
      to: target,
      source,
      target,
    });
    retainedNodeIds.add(source);
    retainedNodeIds.add(target);
  }
  if (!edges.length) return { nodes: [], edges: [] };
  return {
    ...incomingGraph,
    nodes: [...retainedNodeIds]
      .map((id) => currentNodes.get(id))
      .filter((node): node is R => Boolean(node)),
    edges,
  };
}
function positions(g: R, o: R, ignored = new Set<string>()) {
  const ps = rec(o.nodePositions),
    layout = rec(g.layout),
    old = rec(layout.nodePositions);
  g.nodes = array(g.nodes).map((n) => {
    const x = rec(n),
      nodeId = text(x.id),
      p = rec((ignored.has(nodeId) ? undefined : ps[nodeId]) ?? old[nodeId]);
    return Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))
      ? { ...x, x: Number(p.x), y: Number(p.y) }
      : x;
  });
  const accepted = Object.fromEntries(
    Object.entries(ps).filter(([nodeId]) => !ignored.has(nodeId)),
  );
  g.layout = { ...layout, nodePositions: { ...old, ...accepted } };
  return g;
}
function normalizeInvestigationGroups(value: unknown, valid: Set<string>) {
  const groups: R[] = [],
    used = new Set<string>();
  for (const raw of array(value)) {
    if (!isRec(raw)) continue;
    const item = rec(raw),
      id = text(item.id);
    if (!id) continue;
    const members: string[] = [];
    for (const nodeId of strings(item.memberNodeIds ?? item.nodeIds)) {
      if ((valid.size && !valid.has(nodeId)) || used.has(nodeId)) continue;
      members.push(nodeId);
      used.add(nodeId);
    }
    if (members.length < 2) continue;
    groups.push({
      id,
      name: text(item.name) || "研判组",
      memberNodeIds: uniq(members),
      groupType: text(item.groupType),
      note: text(item.note),
      collapsed: Boolean(item.collapsed),
      createdAt: text(item.createdAt),
      updatedAt: text(item.updatedAt),
      ...point(item),
    });
  }
  return groups;
}
function removeInvestigationGroupMembers(
  groups: R[],
  memberNodeIds: string[],
): [R[], string[]] {
  const remove = new Set(memberNodeIds),
    next: R[] = [],
    removed: string[] = [];
  for (const group of groups) {
    const item = {
      ...group,
      memberNodeIds: strings(group.memberNodeIds).filter((id) => !remove.has(id)),
    };
    if (item.memberNodeIds.length < 2) {
      if (text(group.id)) removed.push(text(group.id));
    } else next.push(item);
  }
  return [next, removed];
}
function investigationGroupPositionIgnoreIds(
  groups: R[],
  operation: string,
  groupId: string,
  payload: R,
) {
  if (!["expand", "ungroup", "remove_member"].includes(operation) || !groupId)
    return new Set<string>();
  const group = groups.find((item) => text(item.id) === groupId);
  if (!group || !Boolean(group.collapsed)) return new Set<string>();
  const members = strings(group.memberNodeIds);
  if (operation === "expand" || operation === "ungroup") return new Set(members);
  const requested = uniq(
    [...strings(payload.memberNodeIds), text(payload.memberNodeId)].filter(Boolean),
  );
  return new Set(requested.filter((id) => members.includes(id)));
}
function mergeById(a: unknown[], b: unknown[]) {
  const m = new Map<string, R>();
  for (const x of [...a, ...b])
    if (isRec(x) && text(x.id))
      m.set(text(x.id), { ...(m.get(text(x.id)) || {}), ...x });
  return [...m.values()];
}
function mergeGraphs(a: R, b: R) {
  const nodes = mergeById(array(a.nodes), array(b.nodes)),
    edges = mergeById(array(a.edges), array(b.edges));
  return {
    ...a,
    ...b,
    nodes,
    edges,
    layout: {
      ...rec(b.layout),
      ...rec(a.layout),
      nodePositions: {
        ...rec(rec(b.layout).nodePositions),
        ...rec(rec(a.layout).nodePositions),
      },
    },
    tradeFacts: { ...factsMap(a.tradeFacts), ...factsMap(b.tradeFacts) },
    excludedNodes: excludedNodes(a),
    investigationGroups: array(a.investigationGroups),
    manualEdges: array(a.manualEdges),
    realityRelations: array(a.realityRelations),
  };
}

export function remapGraphToExistingNodes(currentGraph: R, incomingGraph: R): R {
  const remap = existingNodeIdentityIndex(currentGraph);
  if (!remap.size) return incomingGraph;

  const existingNodes = new Map(
      array(currentGraph.nodes)
        .filter(isRec)
        .map((node) => [text(node.id), rec(node)]),
    ),
    endpointRemap = new Map(remap),
    nodesById = new Map<string, R>();

  for (const value of array(incomingGraph.nodes)) {
    if (!isRec(value)) continue;
    const node = rec(value),
      nodeId = text(node.id),
      canonicalId = canonicalNodeId(node, remap) || nodeId;
    if (nodeId && canonicalId) endpointRemap.set(nodeId, canonicalId);
    if (!canonicalId) continue;
    nodesById.set(
      canonicalId,
      existingNodes.get(canonicalId) || { ...node, id: canonicalId },
    );
  }

  const edges: R[] = [],
    seenEdges = new Set<string>();
  for (const value of array(incomingGraph.edges)) {
    if (!isRec(value)) continue;
    const edge = rec(value),
      sourceValue = text(edge.from || edge.source),
      targetValue = text(edge.to || edge.target),
      source = endpointRemap.get(sourceValue) || sourceValue,
      target = endpointRemap.get(targetValue) || targetValue;
    if (!source || !target || source === target) continue;
    const id = `money:${source}->${target}`;
    if (seenEdges.has(id)) continue;
    seenEdges.add(id);
    edges.push({
      ...edge,
      id,
      from: source,
      to: target,
      source,
      target,
    });
  }
  return { ...incomingGraph, nodes: [...nodesById.values()], edges };
}

function existingNodeIdentityIndex(graph: R) {
  const index = new Map<string, string>();
  for (const value of array(graph.nodes)) {
    if (!isRec(value)) continue;
    const node = rec(value),
      nodeId = text(node.id);
    if (!nodeId) continue;
    addNodeIdentity(index, nodeId, node);
    for (const account of array(node.accounts))
      if (isRec(account)) addNodeIdentity(index, nodeId, rec(account));
  }
  return index;
}

function addNodeIdentity(index: Map<string, string>, nodeId: string, value: R) {
  const accountId = text(value.accountId),
    tradeCard = text(value.tradeCard || value.payAccount);
  if (accountId) {
    if (!index.has(`account:${accountId}`))
      index.set(`account:${accountId}`, nodeId);
    if (!index.has(`accountId:${accountId}`))
      index.set(`accountId:${accountId}`, nodeId);
  }
  if (tradeCard && !index.has(`tradeCard:${tradeCard}`))
    index.set(`tradeCard:${tradeCard}`, nodeId);
}

function canonicalNodeId(node: R, remap: Map<string, string>) {
  const nodeId = text(node.id);
  if (remap.has(nodeId)) return remap.get(nodeId) || "";
  const direct = canonicalAccountIdentity(node, remap);
  if (direct) return direct;
  for (const account of array(node.accounts)) {
    if (!isRec(account)) continue;
    const nested = canonicalAccountIdentity(rec(account), remap);
    if (nested) return nested;
  }
  return nodeId;
}

function canonicalAccountIdentity(value: R, remap: Map<string, string>) {
  const accountId = text(value.accountId),
    tradeCard = text(value.tradeCard || value.payAccount);
  if (accountId && remap.has(`accountId:${accountId}`))
    return remap.get(`accountId:${accountId}`) || "";
  if (tradeCard && remap.has(`tradeCard:${tradeCard}`))
    return remap.get(`tradeCard:${tradeCard}`) || "";
  return "";
}
function delta(a: R, b: R) {
  const an = new Map(
      array(a.nodes)
        .filter(isRec)
        .map((n) => [text(n.id), n]),
    ),
    ae = new Map(
      array(a.edges)
        .filter(isRec)
        .map((e) => [text(e.id), e]),
    ),
    bn = array(b.nodes).filter(isRec),
    be = array(b.edges).filter(isRec);
  return {
    addedNodes: bn.filter((n) => !an.has(text(n.id))),
    addedEdges: be.filter((e) => !ae.has(text(e.id))),
    updatedNodes: bn.filter(
      (n) =>
        an.has(text(n.id)) &&
        JSON.stringify(an.get(text(n.id))) !== JSON.stringify(n),
    ),
    updatedEdges: be.filter(
      (e) =>
        ae.has(text(e.id)) &&
        JSON.stringify(ae.get(text(e.id))) !== JSON.stringify(e),
    ),
    removedNodes: array(a.nodes)
      .filter(isRec)
      .filter((n) => !bn.some((x) => text(x.id) === text(n.id))),
    removedEdges: array(a.edges)
      .filter(isRec)
      .filter((e) => !be.some((x) => text(x.id) === text(e.id))),
  };
}
function excludedNodes(g: R) {
  return array(g.excludedNodes).filter(isRec).map(rec);
}
function normalizeExcluded(n: R, g: R) {
  const id = req(n.nodeId || n.id, "nodeId"),
    source = rec(array(g.nodes).find((x) => text(rec(x).id) === id)),
    merged = { ...source, ...n },
    accounts = normalizeAccounts(
      Array.isArray(merged.accounts) ? merged.accounts : [merged],
    );
  return {
    nodeId: id,
    label:
      text(
        merged.label ||
          merged.name ||
          merged.accountName ||
          merged.tradeCard,
      ) || id,
    type: text(merged.type) || (accounts.length > 1 ? "subject" : "account"),
    accountIds: accounts.map((account) => text(account.accountId)).filter(Boolean),
    tradeCards: accounts.map((account) => text(account.tradeCard)).filter(Boolean),
    reason: text(merged.reason) || "manual",
  };
}
function mergeExcluded(a: R[], b: R[]) {
  const m = new Map(a.map((x) => [text(x.nodeId), x]));
  for (const x of b)
    m.set(text(x.nodeId), { ...(m.get(text(x.nodeId)) || {}), ...x });
  return [...m.values()];
}
function applyExcluded(g: R, x: R[]): R {
  const ids = new Set(x.map((n) => text(n.nodeId)).filter(Boolean)),
    keys = {
      ids: new Set(x.flatMap((n) => strings(n.accountIds))),
      cards: new Set(x.flatMap((n) => strings(n.tradeCards))),
    },
    nodes: R[] = array(g.nodes)
      .filter(isRec)
      .map((n) => {
        const item = rec(n);
        return {
          ...item,
          isExcluded: ids.has(text(item.id)) || nodeMatches(item, keys),
        };
      }),
    seen = new Set(nodes.map((n) => text(n.id)));
  for (const item of x) {
    const id = text(item.nodeId);
    if (id && !seen.has(id)) {
      const source = rec(item.node),
        label = text(item.label) || id;
      nodes.push({
        ...source,
        id,
        label,
        name: text(source.name || label),
        accountName: text(source.accountName || label),
        accountIds: strings(item.accountIds),
        accounts: array(source.accounts),
        tradeCard: text(source.tradeCard || strings(item.tradeCards)[0]),
        isExcluded: true,
      });
      seen.add(id);
    }
  }
  const excludedIds = new Set(
      nodes.filter((n) => n.isExcluded).map((n) => text(n.id)),
    ),
    edges = array(g.edges)
      .filter(isRec)
      .map((e) => ({
        ...rec(e),
        isExcluded:
          excludedIds.has(text(e.source || e.from)) ||
          excludedIds.has(text(e.target || e.to)),
      }));
  return { ...g, nodes, edges, excludedNodes: x };
}
function factsMap(v: unknown): Record<string, R> {
  const out: Record<string, R> = {};
  if (Array.isArray(v)) {
    for (const x of v)
      if (isRec(x) && text(x.tradeId || x.id))
        out[text(x.tradeId || x.id)] = {
          ...x,
          tradeId: text(x.tradeId || x.id),
        };
  } else {
    for (const [k, x] of Object.entries(rec(v)))
      if (isRec(x)) {
        const id = text(x.tradeId || k);
        if (id) out[id] = { ...x, tradeId: id };
      }
  }
  return out;
}
export function filterGraphFromTradeFacts(g: R, f: R) {
  const facts = factsMap(g.tradeFacts),
    bounds = {
      minAmount: finite(f.minAmount),
      maxAmount: finite(f.maxAmount),
      startTime: text(f.startTime),
      endTime: text(f.endTime),
    },
    active = Object.values(bounds).some(
      (value) => value !== null && value !== "",
    ),
    excluded = new Set(strings(g.excludedTrades)),
    nodes = new Map(
      array(g.nodes)
        .filter(isRec)
        .map((node) => [text(node.id), rec(node)]),
    ),
    retained = new Set<string>(),
    edges: R[] = [];
  for (const value of array(g.edges)) {
    if (!isRec(value)) continue;
    const edge = rec(value),
      [source, target] = edgeEndpoints(edge);
    if (!source || !target || source === target) continue;
    const normalized = {
        ...edge,
        id: `money:${source}->${target}`,
        from: source,
        to: target,
        source,
        target,
      },
      tradeIds = strings(edge.tradeIds).filter((id) => !excluded.has(id));
    if (!tradeIds.length) {
      if (active)
        throw new Error(
          "当前图缺少交易流水明细，无法执行全图筛选，请重新分析上图后再筛选",
        );
      retained.add(source);
      retained.add(target);
      edges.push(normalized);
      continue;
    }
    if (tradeIds.some((id) => !facts[id]))
      throw new Error(
        "当前图的交易流水事实不完整，无法执行全图筛选，请重新分析上图后再筛选",
      );
    const matching = tradeIds.filter((id) => factMatches(facts[id]!, bounds));
    if (!matching.length) continue;
    retained.add(source);
    retained.add(target);
    edges.push({
      ...recomputeEdge(normalized, matching.map((id) => facts[id]!)),
      tradeIds: matching,
    });
  }
  return {
    ...g,
    nodes: [...nodes].filter(([id]) => retained.has(id)).map(([, node]) => node),
    edges,
    tradeFacts: facts,
    filters: {
      minAmount: Object.hasOwn(f, "minAmount") ? f.minAmount : null,
      maxAmount: Object.hasOwn(f, "maxAmount") ? f.maxAmount : null,
      startTime: text(f.startTime),
      endTime: text(f.endTime),
    },
  };
}
export function applyTradeExclusions(g: R, excluded: string[], edgeMap: R) {
  const ex = new Set(excluded),
    facts = factsMap(g.tradeFacts),
    idsByEdge = Object.fromEntries(
      Object.entries(edgeMap).map(([id, value]) => [id, strings(value)]),
    ) as Record<string, string[]>,
    previous = new Set(strings(g.excludedTrades)),
    restored = [...previous].filter((id) => !ex.has(id)),
    identity = existingNodeIdentityIndex(g);
  for (const tradeId of restored.sort()) {
    const fact = facts[tradeId];
    if (!fact) continue;
    const source = nodeIdForFactParty(fact, "payer", identity),
      target = nodeIdForFactParty(fact, "payee", identity);
    if (!source || !target || source === target) continue;
    const edgeId = `money:${source}->${target}`,
      ids = (idsByEdge[edgeId] ||= []);
    if (!ids.includes(tradeId)) ids.push(tradeId);
  }
  const nodes = new Map(
      array(g.nodes)
        .filter(isRec)
        .map((node) => [text(node.id), rec(node)]),
    ),
    retained = new Set<string>(),
    edges: R[] = [],
    existing = new Set<string>();
  for (const value of array(g.edges)) {
    if (!isRec(value)) continue;
    const edge = rec(value),
      [source, target] = edgeEndpoints(edge);
    if (!source || !target || source === target) continue;
    const edgeId = `money:${source}->${target}`;
    existing.add(edgeId);
    const tradeIds = idsByEdge[edgeId] || strings(edge.tradeIds);
    if (tradeIds.length) {
      const visible = tradeIds.filter((id) => !ex.has(id));
      if (!visible.length) continue;
      const known = visible.filter((id) => facts[id]).map((id) => facts[id]!);
      if (known.length !== visible.length && visible.length !== tradeIds.length)
        throw new FieldError("tradeFacts");
      const normalized = {
        ...edge,
        id: edgeId,
        from: source,
        to: target,
        source,
        target,
        tradeIds,
      };
      edges.push(
        known.length === visible.length
          ? recomputeEdge(normalized, known)
          : normalized,
      );
    } else {
      edges.push({
        ...edge,
        id: edgeId,
        from: source,
        to: target,
        source,
        target,
      });
    }
    retained.add(source);
    retained.add(target);
  }
  for (const [edgeId, tradeIds] of Object.entries(idsByEdge)) {
    if (existing.has(edgeId)) continue;
    const [source, target] = edgeEndpoints({ id: edgeId });
    if (!source || !target || source === target) continue;
    const visible = tradeIds.filter((id) => !ex.has(id)),
      known = visible.filter((id) => facts[id]).map((id) => facts[id]!);
    if (!visible.length || known.length !== visible.length) continue;
    ensureFactNode(nodes, source, known[0]!, "payer");
    ensureFactNode(nodes, target, known[0]!, "payee");
    edges.push({
      ...recomputeEdge(
        { id: edgeId, from: source, to: target, source, target },
        known,
      ),
      tradeIds: visible,
    });
    retained.add(source);
    retained.add(target);
  }
  return {
    ...g,
    nodes: [...nodes].filter(([id]) => retained.has(id)).map(([, node]) => node),
    edges,
    excludedTrades: excluded,
    tradeFacts: facts,
  };
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function factMatches(
  fact: R,
  filters: {
    minAmount: number | null;
    maxAmount: number | null;
    startTime: string;
    endTime: string;
  },
) {
  const amount = finite(fact.tradeAmount),
    time = text(fact.tradeTime);
  if (filters.minAmount !== null && (amount === null || amount < filters.minAmount))
    return false;
  if (filters.maxAmount !== null && (amount === null || amount > filters.maxAmount))
    return false;
  if (filters.startTime && (!time || time < filters.startTime)) return false;
  if (filters.endTime && (!time || time > filters.endTime)) return false;
  return true;
}

function edgeEndpoints(edge: R): [string, string] {
  let source = text(edge.from || edge.source),
    target = text(edge.to || edge.target);
  if ((!source || !target) && text(edge.id).startsWith("money:")) {
    const parts = text(edge.id).slice("money:".length).split("->");
    if (parts.length === 2) [source, target] = parts as [string, string];
  }
  return [source, target];
}

function recomputeEdge(edge: R, facts: R[]) {
  const amount = facts.reduce(
      (sum, fact) => sum + (finite(fact.tradeAmount) || 0),
      0,
    ),
    times = facts.map((fact) => text(fact.tradeTime)).filter(Boolean),
    result: R = {
      ...edge,
      tradeAmount: amount,
      amount,
      tradeCount: facts.length,
      count: facts.length,
    };
  if (times.length) {
    result.startTime = [...times].sort()[0];
    result.endTime = [...times].sort().at(-1);
    result.startDate = result.startTime;
    result.endDate = result.endTime;
  }
  return result;
}

function nodeIdForFactParty(
  fact: R,
  partyName: "payer" | "payee",
  identity: Map<string, string>,
) {
  const accountId = text(fact[`${partyName}AccountId`]),
    tradeCard = text(fact[`${partyName}TradeCard`]);
  if (accountId) {
    const nodeId =
      identity.get(`accountId:${accountId}`) ||
      identity.get(`account:${accountId}`);
    if (nodeId) return nodeId;
  }
  if (tradeCard) {
    const nodeId = identity.get(`tradeCard:${tradeCard}`);
    if (nodeId) return nodeId;
  }
  if (accountId) return `account:${accountId}`;
  if (tradeCard) return `account:${tradeCard}`;
  return "";
}

function ensureFactNode(
  nodes: Map<string, R>,
  nodeId: string,
  fact: R,
  partyName: "payer" | "payee",
) {
  if (nodes.has(nodeId)) return;
  const accountId = text(fact[`${partyName}AccountId`]),
    tradeCard = text(fact[`${partyName}TradeCard`]),
    accountName = text(fact[`${partyName}AccountName`]),
    label = accountName || tradeCard || nodeId,
    account = { accountId, tradeCard, accountName: label };
  nodes.set(nodeId, {
    id: nodeId,
    type: "account",
    role: "counterparty",
    label,
    accountId: accountId || null,
    accountIds: accountId ? [accountId] : [],
    tradeCard,
    accountName: label,
    accounts: [account],
    depth: 1,
    isExcluded: false,
  });
}
function party(v: R, g: R): R {
  const id = text(v.nodeId || v.id);
  if (id) {
    const n = rec(array(g.nodes).find((x) => text(rec(x).id) === id));
    if (!text(n.id)) throw new FieldError("counterparty");
    return n;
  }
  const label = req(v.label || v.accountName, "counterparty"),
    node = {
      id: `manual:${randomUUID().replaceAll("-", "")}`,
      label,
      name: label,
      accountName: label,
      accountId: text(v.accountId),
      tradeCard: text(v.tradeCard),
      isManual: true,
      nodeType: "manual",
    };
  return node;
}
function resolveManualParty(value: R, nodes: Map<string, R>): [R, boolean] {
  const requestedId = text(value.nodeId || value.id);
  if (requestedId && nodes.has(requestedId))
    return [{ ...nodes.get(requestedId)! }, false];
  const label = text(
    value.label || value.name || value.accountName || value.tradeCard,
  );
  if (!value.createNew && label) {
    const existing = [...nodes.values()].find(
      (node) => nodeDisplayName(node).toLocaleLowerCase() === label.toLocaleLowerCase(),
    );
    if (existing) return [{ ...existing }, false];
  }
  if (!label) throw new FieldError("counterparty");
  const id =
      requestedId && !nodes.has(requestedId)
        ? requestedId
        : `manual:node:${randomUUID().replaceAll("-", "")}`,
    tradeCard = text(value.tradeCard),
    accountId = text(value.accountId) || id,
    node: R = {
      id,
      label,
      name: label,
      accountName: label,
      tradeCard,
      accountId,
      type: "manual",
      source: "manual",
      isManual: true,
      accounts: tradeCard
        ? [{ accountId, accountName: label, tradeCard, source: "manual" }]
        : [],
    };
  return [node, true];
}

function ensureManualNodePosition(
  node: R,
  anchor: R,
  created: boolean,
  direction: number,
) {
  if (!created || (finite(node.x) !== null && finite(node.y) !== null)) return;
  node.x = (finite(anchor.x) ?? 520) + direction * 360;
  node.y = (finite(anchor.y) ?? 300) + 112;
}

function nodeDisplayName(node: R) {
  return text(
    node.accountName ||
      node.label ||
      node.name ||
      node.tradeCard ||
      node.accountId ||
      node.id,
  );
}
function ensureDetachedNodePosition(node: R, existing: Map<string, R>) {
  if (finite(node.x) !== null && finite(node.y) !== null) return;
  const points = [...existing.values()]
    .map((value) => [finite(value.x), finite(value.y)] as const)
    .filter(
      (value): value is readonly [number, number] =>
        value[0] !== null && value[1] !== null,
    );
  if (!points.length) {
    node.x = 520;
    node.y = 300;
    return;
  }
  node.x = Math.max(...points.map(([x]) => x)) + 320;
  node.y = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
}
function uniqAccounts(v: R[]) {
  const m = new Map<string, R>();
  for (const a of normalizeAccounts(v)) {
    const k = text(a.accountId)
      ? `id:${text(a.accountId)}`
      : `card:${text(a.tradeCard)}`;
    if (k !== "card:") m.set(k, a);
  }
  return [...m.values()];
}
function accountKeys(v: R[]) {
  return {
    ids: new Set(v.map((a) => text(a.accountId)).filter(Boolean)),
    cards: new Set(
      v.map((a) => text(a.tradeCard || a.payAccount)).filter(Boolean),
    ),
  };
}
function nodeMatches(n: R, k: { ids: Set<string>; cards: Set<string> }) {
  return (
    [
      text(n.accountId),
      ...strings(n.accountIds),
      ...normalizeAccounts(array(n.accounts).length ? n.accounts : [n]).map(
        (a) => text(a.accountId),
      ),
    ].some((x) => x && k.ids.has(x)) ||
    [
      text(n.tradeCard || n.payAccount),
      ...normalizeAccounts(array(n.accounts).length ? n.accounts : [n]).map(
        (a) => text(a.tradeCard),
      ),
    ].some((x) => x && k.cards.has(x))
  );
}
function summaryCandidateNode(v: R): R {
  const accounts = normalizeAccounts(
      array(v.accounts).length ? v.accounts : [v],
    ),
    first = accounts[0] || {},
    accountId = text(v.accountId || first.accountId),
    tradeCard = text(v.tradeCard || first.tradeCard || first.payAccount),
    id =
      text(v.nodeId || v.id) ||
      (accountId ? `account:${accountId}` : `account:${tradeCard}`),
    label =
      text(v.label || v.accountName || first.accountName || tradeCard || id) ||
      "未知主体";
  return {
    id,
    type: text(v.type) || "account",
    role: text(v.role) || "candidate",
    label,
    accountId: accountId || null,
    accountIds: accountId ? [accountId] : [],
    tradeCard,
    accountName: label,
    accounts,
    depth: Number(v.depth ?? 1),
  };
}

function summaryItem(nodeId: string, node: R, onGraph: boolean, isExcluded: boolean) {
  const accounts = normalizeAccounts(
      array(node.accounts).length ? node.accounts : [node],
    ),
    status = isExcluded ? "excluded" : onGraph ? "on_graph" : "candidate";
  return {
    nodeId,
    label:
      text(node.label || node.name || node.accountName || node.tradeCard) ||
      nodeId,
    accountText: uniq([
      ...accounts.map((account) => text(account.accountId)),
      ...accounts.map((account) => text(account.tradeCard)),
    ]).filter(Boolean).join("、"),
    accounts,
    receivedAmount: 0,
    receivedCount: 0,
    paidAmount: 0,
    paidCount: 0,
    totalAmount: 0,
    netAmount: 0,
    minAmount: null as number | null,
    maxAmount: null as number | null,
    startTime: "",
    endTime: "",
    tradeIds: [] as string[],
    isOnGraph: onGraph,
    isExcluded,
    status,
  };
}

type SummaryItem = ReturnType<typeof summaryItem>;

function updateSummaryTime(item: SummaryItem, value: unknown) {
  const time = text(value);
  if (!time) return;
  item.startTime = item.startTime ? [item.startTime, time].sort()[0]! : time;
  item.endTime = item.endTime ? [item.endTime, time].sort().at(-1)! : time;
}

function updateSummaryAmounts(item: SummaryItem, amount: number, time: unknown) {
  item.totalAmount += amount;
  item.netAmount = item.receivedAmount - item.paidAmount;
  item.minAmount = item.minAmount === null ? amount : Math.min(item.minAmount, amount);
  item.maxAmount = item.maxAmount === null ? amount : Math.max(item.maxAmount, amount);
  updateSummaryTime(item, time);
}

function applySummaryFact(item: SummaryItem, fact: R, direction: "in" | "out") {
  const amount = finite(fact.tradeAmount) || 0;
  if (direction === "in") {
    item.receivedAmount += amount;
    item.receivedCount += 1;
  } else {
    item.paidAmount += amount;
    item.paidCount += 1;
  }
  updateSummaryAmounts(item, amount, fact.tradeTime);
}

function applySummaryEdge(item: SummaryItem, edge: R, direction: "in" | "out") {
  const amount = finite(edge.tradeAmount ?? edge.amount) || 0,
    count = Math.trunc(finite(edge.tradeCount ?? edge.count) || 0);
  if (direction === "in") {
    item.receivedAmount += amount;
    item.receivedCount += count;
  } else {
    item.paidAmount += amount;
    item.paidCount += count;
  }
  updateSummaryAmounts(item, amount, edge.startTime || edge.startDate);
  updateSummaryTime(item, edge.endTime || edge.endDate);
}

function summaryStatus(graph: R, nodeId: string, node: R) {
  const existing = new Set(array(graph.nodes).filter(isRec).map((value) => text(value.id))),
    excluded = excludedNodes(graph),
    ids = new Set(excluded.map((item) => text(item.nodeId)).filter(Boolean)),
    keys = {
      ids: new Set(excluded.flatMap((item) => strings(item.accountIds))),
      cards: new Set(excluded.flatMap((item) => strings(item.tradeCards))),
    },
    isExcluded = ids.has(nodeId) || nodeMatches({ ...node, id: nodeId }, keys);
  return { onGraph: existing.has(nodeId), isExcluded };
}

function sortSummaryItems(items: SummaryItem[]) {
  const rank = (status: string) => status === "candidate" ? 0 : status === "excluded" ? 1 : 2;
  return items.sort(
    (a, b) =>
      rank(a.status) - rank(b.status) ||
      b.totalAmount - a.totalAmount ||
      b.tradeIds.length - a.tradeIds.length ||
      a.label.localeCompare(b.label),
  );
}

function summaryItemsFromGraph(
  currentGraph: R,
  summaryGraph: R,
  focusNodeId: string,
  focusAccounts: R[],
) {
  const summaryNodes = new Map(
      array(summaryGraph.nodes)
        .filter(isRec)
        .map((node) => [text(node.id), rec(node)]),
    ),
    currentNodes = new Map(
      array(currentGraph.nodes)
        .filter(isRec)
        .map((node) => [text(node.id), rec(node)]),
    ),
    resolvedFocus =
      [...nodeIdsForAccounts(summaryGraph, focusAccounts)][0] || focusNodeId,
    facts = factsMap(summaryGraph.tradeFacts),
    items = new Map<string, SummaryItem>();
  if (!resolvedFocus) return [];
  for (const value of array(summaryGraph.edges)) {
    if (!isRec(value)) continue;
    const edge = rec(value),
      [source, target] = edgeEndpoints(edge);
    if (!source || !target || (source !== resolvedFocus && target !== resolvedFocus))
      continue;
    const direction: "in" | "out" = target === resolvedFocus ? "in" : "out",
      counterpartyId = direction === "in" ? source : target,
      counterparty = summaryNodes.get(counterpartyId);
    if (!counterparty) continue;
    const display = currentNodes.get(counterpartyId) || counterparty,
      status = summaryStatus(currentGraph, counterpartyId, display),
      item = items.get(counterpartyId) ||
        summaryItem(counterpartyId, display, status.onGraph, status.isExcluded),
      tradeIds = strings(edge.tradeIds),
      edgeFacts = tradeIds.filter((id) => facts[id]).map((id) => facts[id]!);
    if (edgeFacts.length) for (const fact of edgeFacts) applySummaryFact(item, fact, direction);
    else applySummaryEdge(item, edge, direction);
    item.tradeIds = uniq([...item.tradeIds, ...tradeIds]);
    items.set(counterpartyId, item);
  }
  return sortSummaryItems([...items.values()]);
}

function summaryItemsFromGlobalCandidates(currentGraph: R, candidates: unknown[]) {
  const identity = existingNodeIdentityIndex(currentGraph),
    currentNodes = new Map(
      array(currentGraph.nodes)
        .filter(isRec)
        .map((node) => [text(node.id), rec(node)]),
    ),
    items = new Map<string, SummaryItem>();
  for (const value of candidates) {
    if (!isRec(value)) continue;
    const candidate = rec(value),
      node = summaryCandidateNode(candidate),
      rawId = text(candidate.nodeId || node.id);
    if (!rawId) continue;
    const id = canonicalNodeId(node, identity) || rawId,
      display = currentNodes.get(id) || node,
      status = summaryStatus(currentGraph, id, display),
      item = items.get(id) || summaryItem(id, display, status.onGraph, status.isExcluded);
    item.receivedAmount += finite(candidate.receivedAmount) || 0;
    item.receivedCount += Math.trunc(finite(candidate.receivedCount) || 0);
    item.paidAmount += finite(candidate.paidAmount) || 0;
    item.paidCount += Math.trunc(finite(candidate.paidCount) || 0);
    item.totalAmount = item.receivedAmount + item.paidAmount;
    item.netAmount = item.receivedAmount - item.paidAmount;
    const min = finite(candidate.minAmount), max = finite(candidate.maxAmount);
    if (min !== null) item.minAmount = item.minAmount === null ? min : Math.min(item.minAmount, min);
    if (max !== null) item.maxAmount = item.maxAmount === null ? max : Math.max(item.maxAmount, max);
    updateSummaryTime(item, candidate.startTime);
    updateSummaryTime(item, candidate.endTime);
    item.tradeIds = uniq([...item.tradeIds, ...strings(candidate.tradeIds)]);
    item.accounts = uniqAccounts([
      ...item.accounts,
      ...normalizeAccounts(candidate.accounts),
    ]);
    item.accountText = uniq([
      ...item.accounts.map((account) => text(account.accountId)),
      ...item.accounts.map((account) => text(account.tradeCard)),
    ]).filter(Boolean).join("、");
    items.set(id, item);
  }
  return sortSummaryItems([...items.values()]);
}
