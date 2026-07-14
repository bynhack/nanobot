import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import type { CaseGraphQueryClient, JsonRecord as R } from "./query-client.js";

export interface MySqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}
export class MySqlCaseGraphQueryClient implements CaseGraphQueryClient {
  private pool: Pool;
  constructor(c: MySqlConfig) {
    this.pool = mysql.createPool({
      ...c,
      connectionLimit: 8,
      decimalNumbers: true,
      dateStrings: true,
    });
    this.pool.on("connection", (connection) => {
      void connection.query("SET SESSION group_concat_max_len = 16777216");
    });
  }
  async listCases() {
    const rows = await this.q(
      "SELECT id, case_code, case_name, is_current FROM ga_case ORDER BY is_current DESC, update_time DESC, id DESC LIMIT 200",
    );
    return rows
      .filter((r) => text(r.id))
      .map((r) => ({
        id: text(r.id),
        caseCode: text(r.case_code),
        caseName: text(r.case_name || r.case_code || r.id),
        isCurrent: Boolean(r.is_current),
      }));
  }
  async listAccounts(caseId: string, keyword = "") {
    const id = cid(caseId),
      k = keyword.trim(),
      where = k
        ? "WHERE CAST(a.id AS CHAR)=? OR COALESCE(s.suspect_name,'') LIKE ? OR COALESCE(a.account_name,'') LIKE ? OR COALESCE(a.trade_card,'') LIKE ? OR COALESCE(a.trade_account,'') LIKE ?"
        : "",
      params = k ? [k, ...Array(4).fill(`%${k}%`)] : [];
    const rows = await this.q(
      `SELECT
         s.id suspect_id, s.suspect_name, a.id, a.account_name,
         a.trade_card, a.trade_account, a.account_category, a.is_obtain
       FROM ga_account_${id} a
       INNER JOIN ga_suspect_${id} s
         ON (COALESCE(s.suspect_name, '') <> '' AND COALESCE(a.account_name, '') = s.suspect_name)
         OR (COALESCE(s.card_no, '') <> '' AND COALESCE(a.id_number, '') = s.card_no)
       ${where}
       ORDER BY s.id, a.is_obtain DESC, a.id
       LIMIT 300`,
      params,
    );
    const seen = new Set<string>();
    return rows.flatMap((r) => {
      const x = text(r.id);
      if (!x || seen.has(x)) return [];
      seen.add(x);
      return [
        {
          accountId: x,
          tradeCard: text(r.trade_card || r.trade_account),
          accountName: text(r.account_name),
          suspectId: text(r.suspect_id),
          suspectName: text(r.suspect_name || r.account_name),
          accountCategory: r.account_category,
          isObtain: r.is_obtain,
        },
      ];
    });
  }
  async caseAuditOverview(caseId: string) {
    const id = cid(caseId),
      [r = {}] = await this.q(
        `SELECT
           COUNT(*) trade_count,
           COUNT(DISTINCT file_id) source_file_count,
           SUM(CASE WHEN jd_flag = '借' AND payer_trade_balance IS NULL THEN 1 ELSE 0 END) balance_missing_count,
           MIN(trade_time) min_trade_time,
           MAX(trade_time) max_trade_time,
           COALESCE(SUM(trade_amount), 0) total_trade_amount
         FROM ga_trade_${id}`,
      );
    return {
      tradeCount: r.trade_count || 0,
      sourceFileCount: r.source_file_count || 0,
      balanceMissingCount: r.balance_missing_count || 0,
      minTradeTime: r.min_trade_time || "",
      maxTradeTime: r.max_trade_time || "",
      totalTradeAmount: r.total_trade_amount || 0,
    };
  }
  async queryCaseAuditTrades(p: R) {
    const id = cid(p.caseId),
      parts: string[] = [],
      args: unknown[] = [];
    for (const [k, col, op] of [
      ["startTime", "trade_time", ">="],
      ["endTime", "trade_time", "<="],
      ["minAmount", "trade_amount", ">="],
      ["maxAmount", "trade_amount", "<="],
    ] as const)
      if (text(p[k])) {
        parts.push(`${col} ${op} ?`);
        args.push(p[k]);
      }
    const limit = Math.max(1, Math.min(Number(p.limit) || 200000, 500000));
    args.push(limit);
    return this.q(
      `${auditTradeInfoCte(id)} SELECT * FROM audit_trade_info ${parts.length ? "WHERE " + parts.join(" AND ") : ""} ORDER BY trade_time,row_id LIMIT ?`,
      args,
    );
  }
  async queryRelationOneHop(input: {
    caseId: string;
    seedAccounts: R[];
    direction?: string;
    filters?: R;
  }) {
    const id = cid(input.caseId),
      seeds = identities(input.seedAccounts);
    if (!seeds.ids.length && !seeds.cards.length)
      return { nodes: [], edges: [], tradeFacts: {} };
    const dirs =
      input.direction === "in"
        ? ["in"]
        : input.direction === "out"
          ? ["out"]
          : ["in", "out"];
    let rows: R[] = [];
    for (const d of dirs) {
      const [side] = d === "out" ? ["payer"] : ["payee"],
        clauses: string[] = [],
        args: unknown[] = [];
      if (seeds.ids.length) {
        clauses.push(`gt.${side}_account_id IN (${qs(seeds.ids.length)})`);
        args.push(...seeds.ids);
      }
      if (seeds.cards.length) {
        clauses.push(`gt.${side}_pay_account IN (${qs(seeds.cards.length)})`);
        args.push(...seeds.cards);
      }
      const f = filters(input.filters || {}, "gt");
      args.push(...f.args);
      const limit = Math.max(
        1,
        Math.min(
          Number(input.filters?.limit || input.filters?.drillNums) || 10,
          1000,
        ),
      );
      args.push(limit);
      rows.push(
        ...(await this.q(
          `${aggregateSql(id)}
           WHERE (${clauses.join(" OR ")}) ${f.sql}
           GROUP BY gt.payer_account_id, gt.payer_pay_account,
                    gt.payee_account_id, gt.payee_pay_account
           ORDER BY ${Number(input.filters?.drillType) === 2 ? "trade_count DESC, trade_amount DESC" : "trade_amount DESC, trade_count DESC"}
           LIMIT ?`,
          args,
        )),
      );
    }
    return this.graphOneHop(id, dedupe(rows), input.seedAccounts);
  }
  async queryRelationBetweenAccounts(input: {
    caseId: string;
    accounts: R[];
    filters?: R;
  }) {
    const id = cid(input.caseId),
      x = identities(input.accounts);
    if (x.ids.length < 2) return { nodes: [], edges: [], tradeFacts: {} };
    const f = filters(input.filters || {}, "gt"),
      args = [...x.ids, ...x.ids, ...f.args];
    const rows = await this.q(
      `${aggregateSql(id)}
       WHERE gt.payer_account_id IN (${qs(x.ids.length)})
         AND gt.payee_account_id IN (${qs(x.ids.length)}) ${f.sql}
       GROUP BY gt.payer_account_id, gt.payer_pay_account,
                gt.payee_account_id, gt.payee_pay_account
       ORDER BY trade_amount DESC, trade_count DESC
       LIMIT 500`,
      args,
    );
    return this.graph(id, rows);
  }
  async queryRelationGlobalCandidates(input: { caseId: string; filters?: R }) {
    const id = cid(input.caseId),
      f = filters(input.filters || {}, "gt"),
      rows = await this.q(
        `SELECT
           account_id, pay_account, MAX(NULLIF(account_name, '')) account_name,
           SUM(received_amount) received_amount, SUM(received_count) received_count,
           SUM(paid_amount) paid_amount, SUM(paid_count) paid_count,
           SUM(received_amount) + SUM(paid_amount) total_amount,
           MIN(min_amount) min_amount, MAX(max_amount) max_amount,
           MIN(start_time) start_time, MAX(end_time) end_time,
           GROUP_CONCAT(trade_ids ORDER BY end_time DESC SEPARATOR ',') trade_ids
         FROM (
           SELECT
             gt.payer_account_id account_id, gt.payer_pay_account pay_account,
             MAX(COALESCE(NULLIF(gt.payer_account_name, ''), a.account_name, '')) account_name,
             0 received_amount, 0 received_count,
             SUM(gt.trade_amount) paid_amount, COUNT(*) paid_count,
             MIN(gt.trade_amount) min_amount, MAX(gt.trade_amount) max_amount,
             MIN(gt.trade_time) start_time, MAX(gt.trade_time) end_time,
             GROUP_CONCAT(gt.id ORDER BY gt.trade_time DESC, gt.id DESC) trade_ids
           FROM ga_trade_${id} gt
           LEFT JOIN ga_account_${id} a ON gt.payer_account_id = a.id
           WHERE (gt.payer_account_id IS NOT NULL OR COALESCE(gt.payer_pay_account, '') <> '')
             AND gt.data_flag = 0 ${f.sql}
           GROUP BY gt.payer_account_id, gt.payer_pay_account
           UNION ALL
           SELECT
             gt.payee_account_id, gt.payee_pay_account,
             MAX(COALESCE(NULLIF(gt.payee_account_name, ''), a.account_name, '')),
             SUM(gt.trade_amount), COUNT(*), 0, 0,
             MIN(gt.trade_amount), MAX(gt.trade_amount),
             MIN(gt.trade_time), MAX(gt.trade_time),
             GROUP_CONCAT(gt.id ORDER BY gt.trade_time DESC, gt.id DESC)
           FROM ga_trade_${id} gt
           LEFT JOIN ga_account_${id} a ON gt.payee_account_id = a.id
           WHERE (gt.payee_account_id IS NOT NULL OR COALESCE(gt.payee_pay_account, '') <> '')
             AND gt.data_flag = 0 ${f.sql}
           GROUP BY gt.payee_account_id, gt.payee_pay_account
         ) u
         GROUP BY account_id, pay_account
         ORDER BY total_amount DESC`,
        [...f.args, ...f.args],
      );
    return {
      items: rows.map((r) => {
        const n = partyNode(
          {
            payer_account_id: r.account_id,
            payer_pay_account: r.pay_account,
            payer_account_name: r.account_name,
          },
          "payer",
        );
        return {
          nodeId: n.id,
          label: n.label,
          accountText: [text(r.account_id), text(r.pay_account)]
            .filter(Boolean)
            .join("、"),
          accounts: n.accounts,
          receivedAmount: Number(r.received_amount || 0),
          receivedCount: Number(r.received_count || 0),
          paidAmount: Number(r.paid_amount || 0),
          paidCount: Number(r.paid_count || 0),
          totalAmount:
            Number(r.received_amount || 0) + Number(r.paid_amount || 0),
          netAmount:
            Number(r.received_amount || 0) - Number(r.paid_amount || 0),
          minAmount: r.min_amount == null ? null : Number(r.min_amount),
          maxAmount: r.max_amount == null ? null : Number(r.max_amount),
          startTime: r.start_time || "",
          endTime: r.end_time || "",
          tradeIds: tradeIds(r.trade_ids),
        };
      }),
    };
  }
  async queryGraph(p: R) {
    const seeds = Array.isArray(p.tradeCards) ? p.tradeCards : [],
      g = await this.queryRelationOneHop({
        caseId: text(p.caseId),
        seedAccounts: seeds,
        direction: "both",
        filters: p,
      });
    return {
      nodes: g.nodes,
      money: g.edges,
      phone: [],
      excludedTrades: Array.isArray(p.excludedTrades) ? p.excludedTrades : [],
      groups: {},
      sourceSelectId: seeds.map((x: R) => text(x.accountId)).filter(Boolean),
      tradeCards: seeds,
      tradeFacts: g.tradeFacts,
    };
  }
  async drillDown(p: R) {
    return this.drillDirection(p, "out");
  }
  async drillUp(p: R) {
    return this.drillDirection(p, "in");
  }
  async drill(p: R) {
    return this.drillDirection(p, "both");
  }
  async targetDetail(p: R) {
    const id = cid(p.caseId),
      payer = identities(p.payerCards || []),
      payee = identities(p.payeeCards || []),
      parts: string[] = [],
      args: unknown[] = [];
    if (payer.ids.length) {
      parts.push(`gt.payer_account_id IN (${qs(payer.ids.length)})`);
      args.push(...payer.ids);
    } else if (payer.cards.length) {
      parts.push(`gt.payer_pay_account IN (${qs(payer.cards.length)})`);
      args.push(...payer.cards);
    }
    if (payee.ids.length) {
      parts.push(`gt.payee_account_id IN (${qs(payee.ids.length)})`);
      args.push(...payee.ids);
    } else if (payee.cards.length) {
      parts.push(`gt.payee_pay_account IN (${qs(payee.cards.length)})`);
      args.push(...payee.cards);
    }
    const excluded = Array.isArray(p.excludedTrades)
      ? p.excludedTrades.map(text).filter(Boolean)
      : [];
    if (excluded.length) {
      parts.push(`CAST(gt.id AS CHAR) NOT IN (${qs(excluded.length)})`);
      args.push(...excluded);
    }
    const f = filters(p, "gt");
    args.push(...f.args, Math.max(1, Math.min(Number(p.limit) || 1000, 10000)));
    const rows = await this.q(
      `SELECT
         gt.id, gt.serial_number, gt.trade_amount, gt.trade_time,
         gt.trade_abstract, gt.payer_account_id, gt.payer_account_name,
         gt.payer_pay_account, gt.payee_account_id, gt.payee_account_name,
         gt.payee_pay_account
       FROM ga_trade_${id} gt
       WHERE ${parts.length ? parts.join(" AND ") : "1=0"} ${f.sql}
       ORDER BY gt.trade_time DESC, gt.id DESC
       LIMIT ?`,
      args,
    );
    return rows.map((r) => ({
      tradeId: r.id,
      serialNumber: r.serial_number,
      tradeAmount: Number(r.trade_amount || 0),
      tradeTime: r.trade_time || "",
      tradeAbstract: r.trade_abstract || "",
      payerAccountId: r.payer_account_id,
      payerAccountName:
        r.payer_account_name ||
        resolveName(p.payerCards, r.payer_account_id, r.payer_pay_account),
      payerTradeCard: r.payer_pay_account || "",
      payeeAccountId: r.payee_account_id,
      payeeAccountName:
        r.payee_account_name ||
        resolveName(p.payeeCards, r.payee_account_id, r.payee_pay_account),
      payeeTradeCard: r.payee_pay_account || "",
    }));
  }
  private async drillDirection(p: R, d: string) {
    const cards = Array.isArray(p.tradeCard)
        ? p.tradeCard
        : Array.isArray(p.tradeCards)
          ? p.tradeCards
          : [],
      g = await this.queryRelationOneHop({
        caseId: text(p.caseId),
        seedAccounts: cards,
        direction: d,
        filters: p,
      });
    const ids = new Set(cards.map((x: R) => text(x.accountId)));
    return (g.nodes as R[])
      .filter((n) => !ids.has(text(n.accountId)))
      .flatMap((n) => (Array.isArray(n.accounts) ? n.accounts : []));
  }
  private async graph(id: number, rows: R[]) {
    const nodes = new Map<string, R>(),
      edges: R[] = [];
    for (const r of rows) {
      const a = { ...partyNode(r, "payer"), role: "current", depth: 0 },
        b = { ...partyNode(r, "payee"), role: "current", depth: 0 };
      nodes.set(a.id, a);
      nodes.set(b.id, b);
      edges.push({
        id: `money:${a.id}->${b.id}`,
        from: a.id,
        to: b.id,
        source: a.id,
        target: b.id,
        scope: "graph_internal",
        tradeAmount: Number(r.trade_amount || 0),
        tradeCount: Number(r.trade_count || 0),
        startTime: r.start_time || "",
        endTime: r.end_time || "",
        tradeIds: tradeIds(r.trade_ids),
      });
    }
    const facts = await this.facts(id, uniq(edges.flatMap((e) => e.tradeIds)));
    return { nodes: [...nodes.values()], edges, tradeFacts: facts };
  }
  private async graphOneHop(id: number, rows: R[], seeds: R[]) {
    const groups = new Map<string, R[]>();
    for (const a of seeds) {
      const key = text(a.suspectId)
        ? `suspect:${text(a.suspectId)}`
        : text(a.suspectName)
          ? `name:${text(a.suspectName)}`
          : text(a.accountName)
            ? `account-name:${text(a.accountName)}`
            : `account:${text(a.accountId || a.tradeCard)}`;
      groups.set(key, [...(groups.get(key) || []), a]);
    }
    const nodes = new Map<string, R>(),
      accountToSeed = new Map<string, string>(),
      cardToSeed = new Map<string, string>();
    for (const [key, as] of groups) {
      const first = as[0] || {},
        suspectId = text(first.suspectId),
        name = text(first.suspectName || first.accountName),
        sid = suspectId
          ? `subject:suspect:${suspectId}`
          : `subject:${name || text(first.accountId) || "seed"}`,
        accounts = as.map((a) => ({
          accountId: text(a.accountId) || null,
          tradeCard: text(a.tradeCard || a.payAccount),
          accountName: text(a.accountName || name),
        }));
      const n = {
        id: sid,
        type: "subject",
        role: "seed",
        label: name || key,
        suspectId: suspectId || null,
        suspectName: name,
        accountIds: accounts.map((a) => a.accountId).filter(Boolean),
        accounts,
        depth: 0,
      };
      nodes.set(sid, n);
      for (const a of accounts) {
        if (a.accountId) accountToSeed.set(a.accountId, sid);
        if (a.tradeCard) cardToSeed.set(a.tradeCard, sid);
      }
    }
    const edges: R[] = [];
    for (const r of rows) {
      const ps =
          accountToSeed.get(text(r.payer_account_id)) ||
          cardToSeed.get(text(r.payer_pay_account)),
        qs =
          accountToSeed.get(text(r.payee_account_id)) ||
          cardToSeed.get(text(r.payee_pay_account));
      if (ps && qs && ps === qs) continue;
      let source = "",
        target = "";
      if (ps) {
        source = ps;
        const n = partyNode(r, "payee");
        target = n.id;
        nodes.set(n.id, n);
      } else if (qs) {
        target = qs;
        const n = partyNode(r, "payer");
        source = n.id;
        nodes.set(n.id, n);
      } else continue;
      edges.push({
        id: `money:${source}->${target}`,
        from: source,
        to: target,
        source,
        target,
        scope: "seed_to_counterparty",
        tradeAmount: Number(r.trade_amount || 0),
        tradeCount: Number(r.trade_count || 0),
        startTime: r.start_time || "",
        endTime: r.end_time || "",
        tradeIds: tradeIds(r.trade_ids),
      });
    }
    const facts = await this.facts(
      id,
      uniq(rows.flatMap((r) => tradeIds(r.trade_ids))),
    );
    return { nodes: [...nodes.values()], edges, tradeFacts: facts };
  }
  private async facts(id: number, ids: string[]) {
    if (!ids.length) return {};
    const rows = await this.q(
      `SELECT
         gt.id, gt.serial_number, gt.trade_amount, gt.trade_time,
         gt.trade_abstract, gt.remark, gt.jd_flag, gt.trade_type, gt.cash_flag,
         gt.trade_network_name, gt.trade_network_code,
         gt.third_pay_type, gt.third_pay_type_code,
         gt.ip_addr, gt.mac_addr, gt.terminal_no, gt.pos_no,
         gt.trade_device_type, gt.trade_device_no,
         gt.order_no, gt.third_order, gt.outer_serial_number,
         gt.payee_marchant_name, gt.payee_marchant_code, gt.payee_organ_info,
         gt.payer_bank_name, gt.payee_bank_name, gt.payer_account_id,
         COALESCE(NULLIF(gt.payer_account_name, ''), pa.account_name, '') payer_account_name,
         COALESCE(NULLIF(pa.trade_card, ''), gt.payer_pay_account, '') payer_trade_card,
         gt.payee_account_id,
         COALESCE(NULLIF(gt.payee_account_name, ''), qa.account_name, '') payee_account_name,
         COALESCE(NULLIF(qa.trade_card, ''), gt.payee_pay_account, '') payee_trade_card
       FROM ga_trade_${id} gt
       LEFT JOIN ga_account_${id} pa ON gt.payer_account_id = pa.id
       LEFT JOIN ga_account_${id} qa ON gt.payee_account_id = qa.id
       WHERE gt.id IN (${qs(ids.length)})`,
      ids,
    );
    return Object.fromEntries(
      rows.map((r) => {
        const isCash =
          Boolean(r.cash_flag) ||
          /ATM|卡取|卡存|柜台|现金|现金支取|现存|现取|现支|存现|取现|提现|柜面|取款|现金交易/.test(
            [r.trade_type, r.trade_abstract, r.remark].map(text).join(" "),
          );
        const fact = {
          tradeId: text(r.id),
          serialNumber: r.serial_number,
          tradeAmount: Number(r.trade_amount || 0),
          tradeTime: r.trade_time || "",
          tradeAbstract: r.trade_abstract || "",
          remark: r.remark || "",
          debitCreditFlag: r.jd_flag || "",
          tradeType: r.trade_type || "",
          cashFlag: r.cash_flag || "",
          isCash,
          tradeChannel: r.trade_network_name || r.third_pay_type || "",
          tradeChannelCode: r.trade_network_code || r.third_pay_type_code || "",
          thirdPayType: r.third_pay_type || "",
          thirdPayTypeCode: r.third_pay_type_code || "",
          ipAddress: r.ip_addr || "",
          macAddress: r.mac_addr || "",
          terminalNo: r.terminal_no || "",
          posNo: r.pos_no || "",
          deviceType: r.trade_device_type || "",
          deviceNo: r.trade_device_no || "",
          orderNo: r.order_no || "",
          thirdOrderNo: r.third_order || "",
          outerSerialNumber: r.outer_serial_number || "",
          merchantName: r.payee_marchant_name || "",
          merchantCode: r.payee_marchant_code || "",
          counterpartyInstitution: r.payee_organ_info || "",
          payerBankName: r.payer_bank_name || "",
          payeeBankName: r.payee_bank_name || "",
          payerAccountId: r.payer_account_id,
          payerAccountName: r.payer_account_name || "",
          payerTradeCard: r.payer_trade_card || "",
          payeeAccountId: r.payee_account_id,
          payeeAccountName: r.payee_account_name || "",
          payeeTradeCard: r.payee_trade_card || "",
        };
        return [fact.tradeId, fact];
      }),
    );
  }
  private async q(sql: string, args: unknown[] = []): Promise<R[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(sql, args);
    return rows as R[];
  }
}
function aggregateSql(id: number) {
  return `SELECT
    gt.payer_account_id, gt.payer_pay_account,
    MAX(COALESCE(NULLIF(gt.payer_account_name, ''), pa.account_name, '')) payer_account_name,
    gt.payee_account_id, gt.payee_pay_account,
    MAX(COALESCE(NULLIF(gt.payee_account_name, ''), qa.account_name, '')) payee_account_name,
    MAX(NULLIF(gt.cash_flag, '')) cash_flag,
    MAX(NULLIF(gt.trade_type, '')) trade_type,
    MAX(NULLIF(gt.trade_abstract, '')) trade_abstract,
    GROUP_CONCAT(DISTINCT gt.jd_flag ORDER BY gt.jd_flag) jd_flags,
    COUNT(*) trade_count, SUM(gt.trade_amount) trade_amount,
    MIN(gt.trade_time) start_time, MAX(gt.trade_time) end_time,
    GROUP_CONCAT(gt.id ORDER BY gt.trade_time DESC, gt.id DESC) trade_ids
  FROM ga_trade_${id} gt
  LEFT JOIN ga_account_${id} pa ON gt.payer_account_id = pa.id
  LEFT JOIN ga_account_${id} qa ON gt.payee_account_id = qa.id`;
}
function auditTradeInfoCte(id: number) {
  return `WITH suspect_account AS (
 SELECT *,ROW_NUMBER() OVER(PARTITION BY trade_card,account_name,account_time ORDER BY account_category) rn FROM (
  SELECT u.id suspect_id, u.card_no suspect_id_number, u.suspect_name,
         a.id account_id, a.trade_card, a.trade_account, a.account_name,
         a.account_time, a.cancel_time, a.account_category, a.account_bank, a.is_obtain
  FROM ga_suspect_${id} u
  LEFT JOIN ga_account_${id} a ON u.card_no = a.id_number
  WHERE a.id_number IS NOT NULL AND a.id_number <> ''
  UNION
  SELECT u.id, IFNULL(NULLIF(u.card_no, ''), a.id_number), u.suspect_name,
         a.id, a.trade_card, a.trade_account, a.account_name, a.account_time,
         a.cancel_time, a.account_category, a.account_bank, a.is_obtain
  FROM ga_suspect_${id} u
  LEFT JOIN ga_account_${id} a
    ON (u.suspect_name = a.account_name OR u.suspect_name = a.trade_card)
  WHERE (a.id_number IS NULL OR a.id_number = '' OR u.card_no <> a.id_number)
 ) suspect_account_raw
),audit_trade_info AS (
 SELECT COALESCE(NULLIF(CAST(gt.order_no AS CHAR), ''), CAST(gt.id AS CHAR)) id,
        gt.id row_id, gt.file_id,
        COALESCE(NULLIF(fm.original_file_name, ''), NULLIF(fm.file_name, ''), CAST(gt.file_id AS CHAR), '') file_name,
        gt.serial_number, gt.trade_amount, gt.trade_time, gt.jd_flag,
        payee.suspect_id payee_suspect_id,
        COALESCE(NULLIF(gt.payee_account_name, ''), NULLIF(payee.account_name, ''),
                 NULLIF(payee.suspect_name, ''), NULLIF(payee_account.account_name, ''),
                 gt.payee_account_name) payee_account_name,
        IFNULL(NULLIF(payee.trade_card, ''), gt.payee_pay_account) payee_trade_card,
        gt.payee_account_id, payer.suspect_id payer_suspect_id,
        COALESCE(NULLIF(gt.payer_account_name, ''), NULLIF(payer.account_name, ''),
                 NULLIF(payer.suspect_name, ''), NULLIF(payer_account.account_name, ''),
                 gt.payer_account_name) payer_account_name,
        IFNULL(NULLIF(payer.trade_card, ''), gt.payer_pay_account) payer_trade_card,
        gt.payer_account_id, gt.trade_balance, gt.payer_trade_balance
 FROM ga_trade_${id} gt
 LEFT JOIN file_manager fm ON gt.file_id = fm.id
 LEFT JOIN suspect_account payee
   ON gt.payee_account_id = payee.account_id AND payee.rn = 1
 LEFT JOIN ga_account_${id} payee_account
   ON gt.payee_account_id = payee_account.id
 LEFT JOIN suspect_account payer
   ON gt.payer_account_id = payer.account_id AND payer.rn = 1
 LEFT JOIN ga_account_${id} payer_account
   ON gt.payer_account_id = payer_account.id
)`;
}
function filters(p: R, alias: string) {
  const parts: string[] = [],
    args: unknown[] = [];
  for (const [k, col, op] of [
    ["startTime", "trade_time", ">="],
    ["endTime", "trade_time", "<="],
    ["minAmount", "trade_amount", ">="],
    ["maxAmount", "trade_amount", "<="],
  ] as const)
    if (text(p[k])) {
      parts.push(`${alias}.${col}${op}?`);
      args.push(p[k]);
    }
  return { sql: parts.map((x) => ` AND ${x}`).join(""), args };
}
function identities(v: R[]) {
  const ids: string[] = [],
    cards: string[] = [];
  for (const x of v || []) {
    const id = text(x.accountId || x.id),
      card = text(x.tradeCard || x.payAccount || x.accountNo);
    if (/^\d+$/.test(id)) ids.push(id);
    if (card) cards.push(card);
  }
  return { ids: uniq(ids), cards: uniq(cards) };
}
function node(id: unknown, card: unknown, name: unknown) {
  const key = text(id) || text(card),
    label = text(name) || text(card) || text(id) || "未知主体";
  return {
    id: `account:${key}`,
    type: "account",
    role: "counterparty",
    label,
    accountId: text(id) || null,
    accountIds: text(id) ? [text(id)] : [],
    tradeCard: text(card),
    accountName: text(name),
    accounts: [
      {
        accountId: text(id) || null,
        tradeCard: text(card),
        accountName: text(name),
      },
    ],
    depth: 1,
  };
}
function tradeIds(v: unknown) {
  return uniq(text(v).split(",").map(text).filter(Boolean));
}
function cid(v: unknown) {
  const s = text(v);
  if (!/^\d+$/.test(s)) throw new Error("caseId");
  return Number(s);
}
function qs(n: number) {
  return Array(n).fill("?").join(",");
}
function text(v: unknown) {
  return v == null ? "" : String(v).trim();
}
function uniq<T>(v: T[]): T[] {
  return [...new Set(v)];
}
function dedupe(rows: R[]) {
  const m = new Map<string, R>();
  for (const r of rows)
    m.set(
      [
        r.payer_account_id,
        r.payer_pay_account,
        r.payee_account_id,
        r.payee_pay_account,
      ].join("|"),
      r,
    );
  return [...m.values()];
}
function resolveName(cards: unknown, id: unknown, card: unknown) {
  for (const x of Array.isArray(cards) ? cards.filter(isRecord) : [])
    if (
      text(x.accountId) === text(id) ||
      text(x.tradeCard || x.payAccount) === text(card)
    )
      return text(x.accountName || x.suspectName);
  return "";
}

function isRecord(value: unknown): value is R {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function partyNode(r: R, prefix: "payer" | "payee") {
  const id = r[`${prefix}_account_id`],
    card = r[`${prefix}_pay_account`],
    name = r[`${prefix}_account_name`],
    party = `${text(card)}${text(name)}`,
    tx = [r.cash_flag, r.trade_type, r.trade_abstract].map(text).join(""),
    cash =
      /ATM|卡取|卡存|柜台|现金|现金支取|现存|现取|现支|存现|取现|提现|柜面|取款|现金交易/.test(
        `${party}${tx}`,
      );
  if (!cash) return node(id, card, name);
  const all = `${party}${tx}`,
    flags = new Set(text(r.jd_flags).split(",").map(text));
  let direction = "";
  if (/存现|现金交易（存现）|现金存入/.test(all)) direction = "deposit";
  else if (/取现|现金交易（取现）|现金取出|取款/.test(all))
    direction = "withdraw";
  else if (prefix === "payer" && (flags.has("贷") || flags.has("D")))
    direction = "deposit";
  else if (prefix === "payee" && (flags.has("借") || flags.has("J")))
    direction = "withdraw";
  else direction = prefix === "payer" ? "deposit" : "withdraw";
  const label = direction === "deposit" ? "现金存入" : "现金取出",
    key = text(id) || text(card) || direction;
  return {
    id: `cash:${direction}:${key}`,
    type: "cash",
    role: "cash",
    label,
    accountId: text(id) || null,
    accountIds: text(id) ? [text(id)] : [],
    tradeCard: text(card) || label,
    accountName: text(name) || label,
    accounts: [
      {
        accountId: text(id) || null,
        tradeCard: text(card) || label,
        accountName: text(name) || label,
      },
    ],
    cashDirection: direction,
    isCash: true,
    depth: 1,
  };
}
