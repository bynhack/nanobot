export type CaseGraphChatActionType =
  | 'filter'
  | 'reset_filter'
  | 'drill'
  | 'exclude_node'
  | 'restore_node'
  | 'exclude_trades'
  | 'restore_trades'
  | 'extend_clues'
  | 'complete_relation'
  | 'create_subject'
  | 'add_manual_trade'
  | 'add_reality_relation';

export type CaseGraphChatActionDirection = 'in' | 'out' | 'both';
export type CaseGraphChatActionTradeSelection = 'matching' | 'outside';

export type CaseGraphChatActionFilters = {
  minAmount?: string;
  maxAmount?: string;
  startTime?: string;
  endTime?: string;
  keyword?: string;
  minTradeCount?: string;
  maxTradeCount?: string;
};

export type CaseGraphChatAction = {
  type: CaseGraphChatActionType;
  label?: string;
  reason?: string;
  filters?: CaseGraphChatActionFilters;
  direction?: CaseGraphChatActionDirection;
  nodeId?: string;
  nodeQuery?: string;
  nodeName?: string;
  fromQuery?: string;
  toQuery?: string;
  counterpartyQuery?: string;
  selection?: CaseGraphChatActionTradeSelection;
  clueScope?: 'node' | 'global';
  subjectName?: string;
  subjectTradeCard?: string;
  discoveryReason?: string;
  sourceNote?: string;
  note?: string;
  payerQuery?: string;
  payeeQuery?: string;
  payerTradeCard?: string;
  payeeTradeCard?: string;
  payerCreateNew?: boolean;
  payeeCreateNew?: boolean;
  amount?: string;
  tradeTime?: string;
  method?: string;
  summary?: string;
  sourceNodeQuery?: string;
  targetNodeQuery?: string;
  relationType?: string;
  all?: boolean;
};

const ACTION_COMMENT_RE = /<!--\s*(?:图谱动作|case-graph-action)\s*[:：]?\s*([\s\S]*?)\s*-->/g;

export function parseCaseGraphChatActionsFromText(text: string): CaseGraphChatAction[] {
  const actions: CaseGraphChatAction[] = [];
  for (const match of text.matchAll(ACTION_COMMENT_RE)) {
    const payload = match[1]?.trim();
    if (!payload) continue;
    const parsed = parseActionPayload(payload);
    if (!parsed) continue;
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const action = normalizeCaseGraphChatAction(item);
        if (action) actions.push(action);
      }
      continue;
    }
    const action = normalizeCaseGraphChatAction(parsed);
    if (action) actions.push(action);
  }
  if (actions.length) {
    return actions;
  }
  return parseVisibleActionConfirmation(text);
}

export function normalizeCaseGraphChatAction(value: unknown): CaseGraphChatAction | null {
  if (!isRecord(value)) {
    return null;
  }
  const rawType = readString(value, ['type', 'action', '动作', '操作']);
  let type = normalizeActionType(rawType);
  if (!type) {
    return null;
  }
  const target = readRecord(value, ['target', 'node', '主体', '节点']) ?? {};
  const scope = readRecord(value, ['scope', '范围', '交易范围']) ?? {};
  const subject = readRecord(value, ['subject', '主体', '交易主体', 'newSubject', '新增主体']) ?? {};
  const payer = readRecord(value, ['payer', '付款方', '转出方', 'from']) ?? {};
  const payee = readRecord(value, ['payee', '收款方', '转入方', 'to']) ?? {};
  const source = readRecord(value, ['source', 'sourceNode', 'sourceSubject', '来源主体', '一方']) ?? {};
  const relationTarget = readRecord(value, ['relationTarget', 'targetNode', 'targetSubject', '目标主体', '对方']) ?? {};
  const filters = normalizeFilters(readRecord(value, ['filters', '筛选', '筛选条件']) ?? value);
  const direction = normalizeDirection(readString(value, ['direction', '方向']) || rawType);
  const selection = normalizeTradeSelection(readString(value, ['selection', 'match', 'effect', 'mode', '保留方式', '筛选方式']));
  const label = readString(value, ['label', 'title', '名称', '标题']);
  const reason = readString(value, ['reason', '理由', '说明']);
  if (type === 'drill' && isClueExtensionActionIntent(rawType, label, reason)) {
    type = 'extend_clues';
  }
  const action: CaseGraphChatAction = {
    type,
    all: readBoolean(value, ['all', '全部']),
  };
  const nodeId = readString(value, ['nodeId', 'node_id', '主体编号', '节点编号']) || readString(target, ['id', 'nodeId', 'node_id']);
  const nodeQuery =
    readString(value, ['nodeQuery', 'query', 'keyword', '关键词', '主体', '账号'])
    || readString(target, ['query', 'keyword', 'name', 'label', 'accountName', 'tradeCard', '关键词']);
  const nodeName = readString(value, ['nodeName', 'name', '主体名称', '姓名']) || readString(target, ['name', 'label', 'accountName']);
  const fromQuery = readString(value, ['fromQuery', 'from', 'payer', '付款方', '转出方', '来源主体'])
    || readString(scope, ['fromQuery', 'from', 'payer', '付款方', '转出方', '来源主体']);
  const toQuery = readString(value, ['toQuery', 'to', 'payee', '收款方', '转入方', '去向主体'])
    || readString(scope, ['toQuery', 'to', 'payee', '收款方', '转入方', '去向主体']);
  const counterpartyQuery = readString(value, ['counterpartyQuery', 'counterparty', '对手方', '交易对手'])
    || readString(scope, ['counterpartyQuery', 'counterparty', '对手方', '交易对手']);
  const clueScope = normalizeClueScope(readString(value, ['clueScope', 'scope', '范围', '线索范围']));
  const subjectName =
    readString(value, ['subjectName', 'name', 'label', '主体名称', '交易主体', '新增主体', '新主体'])
    || readString(subject, ['name', 'label', 'accountName', '主体名称', '交易主体', '新增主体']);
  const subjectTradeCard =
    readString(value, ['subjectTradeCard', 'tradeCard', 'card', 'account', '银行卡号', '账号', '卡号'])
    || readString(subject, ['tradeCard', 'card', 'account', '银行卡号', '账号', '卡号']);
  const discoveryReason = readString(value, ['discoveryReason', 'reasonFound', '发现原因', '发现方式']);
  const sourceNote = readString(value, ['sourceNote', 'sourceMaterial', 'material', '来源材料', '材料来源', '证据来源']);
  const note = readString(value, ['note', 'remark', 'remarks', '说明', '备注', '情况说明']);
  const payerQuery =
    readString(value, ['payerQuery', 'payerName', 'payer', '付款方', '转出方', '来源主体'])
    || readString(payer, ['query', 'name', 'label', 'accountName', 'tradeCard', '付款方', '转出方', '来源主体']);
  const payeeQuery =
    readString(value, ['payeeQuery', 'payeeName', 'payee', '收款方', '转入方', '去向主体'])
    || readString(payee, ['query', 'name', 'label', 'accountName', 'tradeCard', '收款方', '转入方', '去向主体']);
  const payerTradeCard =
    readString(value, ['payerTradeCard', 'payerCard', '付款方账号', '付款方卡号', '转出方账号'])
    || readString(payer, ['tradeCard', 'card', 'account', '银行卡号', '账号', '卡号']);
  const payeeTradeCard =
    readString(value, ['payeeTradeCard', 'payeeCard', '收款方账号', '收款方卡号', '转入方账号'])
    || readString(payee, ['tradeCard', 'card', 'account', '银行卡号', '账号', '卡号']);
  const payerCreateNew =
    readBoolean(value, ['payerCreateNew', 'createPayer', '付款方新建', '新建付款方'])
    || readBoolean(payer, ['createNew', 'isNew', '新建', '新增']);
  const payeeCreateNew =
    readBoolean(value, ['payeeCreateNew', 'createPayee', '收款方新建', '新建收款方'])
    || readBoolean(payee, ['createNew', 'isNew', '新建', '新增']);
  const amount = readString(value, ['amount', 'tradeAmount', '交易金额', '金额']);
  const tradeTime = readString(value, ['tradeTime', 'time', '交易时间', '时间']);
  const method = readString(value, ['method', 'tradeMethod', '方式', '交易方式', '资金方式']);
  const actionSummary = readString(value, ['summary', 'tradeSummary', '交易摘要', '摘要']);
  const sourceNodeQuery =
    readString(value, ['sourceNodeQuery', 'sourceQuery', 'sourceName', 'source', '一方', '主体一'])
    || readString(source, ['query', 'name', 'label', 'accountName', 'tradeCard']);
  const targetNodeQuery =
    readString(value, ['targetNodeQuery', 'targetQuery', 'targetName', 'target', '另一方', '主体二', '对方'])
    || readString(relationTarget, ['query', 'name', 'label', 'accountName', 'tradeCard']);
  const relationType = readString(value, ['relationType', 'relationship', 'relation', '关系类型', '现实关系']);
  if (label) action.label = label;
  if (reason) action.reason = reason;
  if (nodeId) action.nodeId = nodeId;
  if (nodeQuery) action.nodeQuery = nodeQuery;
  if (nodeName) action.nodeName = nodeName;
  if (fromQuery) action.fromQuery = fromQuery;
  if (toQuery) action.toQuery = toQuery;
  if (counterpartyQuery) action.counterpartyQuery = counterpartyQuery;
  if (Object.keys(filters).length) {
    action.filters = filters;
  }
  if (direction) {
    action.direction = direction;
  }
  if (selection) {
    action.selection = selection;
  }
  if (clueScope) {
    action.clueScope = clueScope;
  }
  if (subjectName) action.subjectName = subjectName;
  if (subjectTradeCard) action.subjectTradeCard = subjectTradeCard;
  if (discoveryReason) action.discoveryReason = discoveryReason;
  if (sourceNote) action.sourceNote = sourceNote;
  if (note) action.note = note;
  if (payerQuery) action.payerQuery = payerQuery;
  if (payeeQuery) action.payeeQuery = payeeQuery;
  if (payerTradeCard) action.payerTradeCard = payerTradeCard;
  if (payeeTradeCard) action.payeeTradeCard = payeeTradeCard;
  if (payerCreateNew) action.payerCreateNew = true;
  if (payeeCreateNew) action.payeeCreateNew = true;
  if (amount) action.amount = amount;
  if (tradeTime) action.tradeTime = tradeTime;
  if (method) action.method = method;
  if (actionSummary) action.summary = actionSummary;
  if (sourceNodeQuery) action.sourceNodeQuery = sourceNodeQuery;
  if (targetNodeQuery) action.targetNodeQuery = targetNodeQuery;
  if (relationType) action.relationType = relationType;
  return action;
}

export function caseGraphActionTitle(action: CaseGraphChatAction): string {
  if (action.label) return action.label;
  switch (action.type) {
    case 'filter':
      return '应用图谱筛选';
    case 'reset_filter':
      return '清空筛选条件';
    case 'drill':
      if (action.direction === 'in') return '执行上钻';
      if (action.direction === 'out') return '执行下钻';
      return '执行双向钻取';
    case 'exclude_node':
      return '取消主体上图';
    case 'restore_node':
      return action.all ? '恢复全部主体' : '恢复主体上图';
    case 'exclude_trades':
      return action.selection === 'outside' ? '保留交易流水' : '排除交易流水';
    case 'restore_trades':
      return '恢复交易流水';
    case 'extend_clues':
      return '综合筛选上图';
    case 'complete_relation':
      return '补全图上关系';
    case 'create_subject':
      return '创建交易主体';
    case 'add_manual_trade':
      return '补充资金往来';
    case 'add_reality_relation':
      return '标注现实关系';
    default:
      return '执行图谱操作';
  }
}

export function caseGraphActionSummary(action: CaseGraphChatAction): string {
  if (action.reason) return normalizeCaseGraphActionCopy(action.reason);
  if (action.type === 'filter') {
    const filters = action.filters ?? {};
    const parts = [
      filters.minAmount ? `最小金额 ${filters.minAmount}` : '',
      filters.maxAmount ? `最大金额 ${filters.maxAmount}` : '',
      filters.startTime ? `开始时间 ${filters.startTime}` : '',
      filters.endTime ? `结束时间 ${filters.endTime}` : '',
    ].filter(Boolean);
    return parts.length ? parts.join('，') : '按对话中给出的条件筛选当前图';
  }
  if (action.type === 'exclude_trades' || action.type === 'restore_trades') {
    const scopeText = buildTradeScopeText(action);
    const filtersText = buildFilterSummaryParts(action.filters ?? {}).join('，');
    if (action.type === 'exclude_trades' && action.selection === 'outside') {
      return `${scopeText}，保留符合条件的交易流水，排除范围内其余流水${filtersText ? `：${filtersText}` : ''}`;
    }
    return `${scopeText}，${action.type === 'restore_trades' ? '恢复' : '排除'}符合条件的交易流水${filtersText ? `：${filtersText}` : ''}`;
  }
  if (action.type === 'extend_clues') {
    const scopeText = action.clueScope === 'global' || action.all ? '案件全局' : buildTradeScopeText(action);
    const filtersText = buildFilterSummaryParts(action.filters ?? {}).join('，');
    return `${scopeText}综合筛选可加入图的主体${filtersText ? `：${filtersText}` : ''}`;
  }
  if (action.type === 'create_subject') {
    const parts = [
      action.subjectName ? `主体：${action.subjectName}` : '',
      action.subjectTradeCard ? `账号：${action.subjectTradeCard}` : '',
      action.discoveryReason ? `发现原因：${action.discoveryReason}` : '',
      action.sourceNote ? `来源材料：${action.sourceNote}` : '',
    ].filter(Boolean);
    return parts.length ? parts.join('，') : '在当前图上创建一个办案过程中发现的交易主体';
  }
  if (action.type === 'add_manual_trade') {
    const parties = `${action.payerQuery || '付款方'} → ${action.payeeQuery || '收款方'}`;
    const parts = [
      parties,
      action.amount ? `金额 ${action.amount} 元` : '',
      action.tradeTime ? `时间 ${action.tradeTime}` : '',
      '方式 现金交易',
    ].filter(Boolean);
    return parts.join('，');
  }
  if (action.type === 'add_reality_relation') {
    const parties = `${action.sourceNodeQuery || '一方主体'} 与 ${action.targetNodeQuery || '另一方主体'}`;
    return `${parties} 标注为${action.relationType ? `“${action.relationType}”` : '现实关系'}`;
  }
  const nodeText = action.nodeName || action.nodeQuery || action.nodeId;
  if (nodeText) {
    return `目标主体：${nodeText}`;
  }
  if (action.type === 'complete_relation') {
    return '核查当前图上主体之间是否还存在未连上的资金往来';
  }
  return '将对当前图谱执行该操作';
}

function normalizeCaseGraphActionCopy(text: string): string {
  return text
    .replace(/候选主体/g, '综合筛选主体')
    .replace(/候选线索/g, '综合筛选线索');
}

function parseActionPayload(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    const start = payload.indexOf('{');
    const end = payload.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(payload.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function parseVisibleActionConfirmation(text: string): CaseGraphChatAction[] {
  if (!isLikelyVisibleActionConfirmation(text)) {
    return [];
  }

  const filterAction = parseVisibleFilterAction(text);
  if (filterAction) {
    return [filterAction];
  }

  const clueExtensionAction = parseVisibleClueExtensionAction(text);
  if (clueExtensionAction) {
    return [clueExtensionAction];
  }

  if (/(恢复|还原).{0,8}(全部|所有).{0,12}(取消上图|已取消上图|排除|已排除).{0,8}(主体|节点|对象)/.test(text)) {
    return [{
      type: 'restore_node',
      label: '恢复全部主体',
      reason: '恢复全部已取消上图的主体',
      all: true,
    }];
  }

  if (/(清空|重置|清除).{0,8}筛选/.test(text)) {
    return [{ type: 'reset_filter', label: '清空筛选条件', all: false }];
  }

  if (/(补全|核查|分析).{0,12}(关系|资金关系)/.test(text)) {
    return [{ type: 'complete_relation', label: '补全图上关系', all: false }];
  }

  return [];
}

function isLikelyVisibleActionConfirmation(text: string): boolean {
  return (
    /建议执行的图谱操作|请确认是否执行|需要我确认执行|确认后执行|已收到，你是要|你是要|已为你准备|待你.*确认后/.test(text)
    && /图谱操作|操作名称|操作内容|筛选|过滤|补全关系|清空筛选|重置筛选|恢复全部|全部恢复|已取消上图|综合筛选|候选主体|候选线索|加入当前图|加入图/.test(text)
  );
}

function parseVisibleFilterAction(text: string): CaseGraphChatAction | null {
  if (!/(筛选|过滤)/.test(text) || !/(金额|资金线|交易)/.test(text)) {
    return null;
  }
  const filters: CaseGraphChatActionFilters = {};
  const minAmount = extractVisibleAmount(text, [
    /(?:不少于|不低于|大于等于|高于等于|最低金额|金额下限|只保留金额不少于|单条金额不少于)\s*([0-9][0-9,，.]*)\s*(万?元|万元|万)?/,
    /(?:大于|高于|超过)\s*([0-9][0-9,，.]*)\s*(万?元|万元|万)?/,
  ]);
  const maxAmount = extractVisibleAmount(text, [
    /(?:不超过|不高于|小于等于|低于等于|最高金额|金额上限)\s*([0-9][0-9,，.]*)\s*(万?元|万元|万)?/,
  ]);
  if (minAmount) filters.minAmount = minAmount;
  if (maxAmount) filters.maxAmount = maxAmount;
  if (!Object.keys(filters).length) {
    return null;
  }
  return {
    type: 'filter',
    label: '资金线金额筛选',
    filters,
    reason: buildVisibleFilterReason(filters),
    all: false,
  };
}

function parseVisibleClueExtensionAction(text: string): CaseGraphChatAction | null {
  if (!/(综合筛选|候选主体|候选线索)/.test(text) || !/(加入当前图|加入图|上图|补充到当前图)/.test(text)) {
    return null;
  }
  const filters: CaseGraphChatActionFilters = {};
  const minAmount = extractVisibleAmount(text, [
    /金额(?:大于|高于|超过|不少于|不低于|大于等于)\s*([0-9][0-9,，.]*)\s*(万?元|万元|万)?/,
    /(?:大于|高于|超过|不少于|不低于|大于等于)\s*([0-9][0-9,，.]*)\s*(万?元|万元|万)?/,
  ]);
  const minTradeCount = extractVisibleCount(text, [
    /交易次数(?:超过|大于|不少于|不低于|大于等于)\s*([0-9][0-9,，]*)\s*(次|笔)?/,
    /(?:超过|大于|不少于|不低于|大于等于)\s*([0-9][0-9,，]*)\s*(次|笔)/,
  ]);
  if (minAmount) filters.minAmount = minAmount;
  if (minTradeCount) filters.minTradeCount = minTradeCount;
  const nodeQuery = extractVisibleNodeQuery(text);
  const direction = /下游|去向|转出/.test(text) ? 'out' : /上游|来源|来款|转入/.test(text) ? 'in' : undefined;
  const action: CaseGraphChatAction = {
    type: 'extend_clues',
    reason: text.split('\n').find((line) => /(综合筛选|候选主体|候选线索).*(加入当前图|加入图|上图)/.test(line))?.trim() || '把符合条件的主体加入当前图',
    all: false,
  };
  if (nodeQuery) action.nodeQuery = nodeQuery;
  if (direction) action.direction = direction;
  if (Object.keys(filters).length) action.filters = filters;
  if (!nodeQuery && /全局|案件/.test(text)) {
    action.clueScope = 'global';
  }
  return action;
}

function extractVisibleCount(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const count = (match[1] ?? '').replace(/[，,]/g, '').trim();
    if (/^\d+$/.test(count)) return count;
  }
  return '';
}

function extractVisibleNodeQuery(text: string): string {
  const match =
    text.match(/(?:把|从)\s*([^，。；\s]+?)\s*(?:的)?(?:上游|下游|去向|来源|转出|转入)/)
    ?? text.match(/([^，。；\s]{2,40})\s*(?:的)?(?:上游|下游|去向|来源|转出|转入)/);
  return match?.[1]?.trim() ?? '';
}

function extractVisibleAmount(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const amount = normalizeVisibleAmount(match[1] ?? '', match[2] ?? '');
    if (amount) return amount;
  }
  return '';
}

function normalizeVisibleAmount(rawAmount: string, rawUnit: string): string {
  const numericText = rawAmount.replace(/[，,]/g, '').trim();
  if (!numericText) return '';
  const numeric = Number(numericText);
  if (!Number.isFinite(numeric)) return '';
  const value = rawUnit.includes('万') ? numeric * 10000 : numeric;
  return Number.isInteger(value) ? String(value) : String(value);
}

function buildVisibleFilterReason(filters: CaseGraphChatActionFilters): string {
  const parts = buildFilterSummaryParts(filters).map((part) => part.replace(/^金额/, '只保留金额'));
  return parts.length ? parts.join('，') : '按助手建议筛选当前图谱';
}

function normalizeActionType(value: string): CaseGraphChatActionType | null {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!normalized) return null;
  if (['filter', 'applyfilter', '筛选', '应用筛选', '图谱筛选'].includes(normalized)) return 'filter';
  if (['resetfilter', 'clearfilter', '清空筛选', '重置筛选', '清除筛选条件'].includes(normalized)) return 'reset_filter';
  if (['drill', 'drilldown', 'drillup', '上钻', '下钻', '双向钻取', '钻取'].includes(normalized)) return 'drill';
  if (['excludenode', 'exclude', '取消上图', '排除', '排除主体', '取消主体上图'].includes(normalized)) return 'exclude_node';
  if (['restorenode', 'restore', '恢复', '恢复主体', '恢复上图'].includes(normalized)) return 'restore_node';
  if (['excludetrades', 'excludetrade', 'exclude流水', '排除流水', '排除交易', '排除交易流水', '过滤流水'].includes(normalized)) return 'exclude_trades';
  if (['restoretrades', 'restoretrade', '恢复流水', '恢复交易', '恢复交易流水'].includes(normalized)) return 'restore_trades';
  if (['extendclues', 'clueextension', 'summaryanalysis', '扩展', '线索扩展', '扩展线索', '综合筛选', '综合筛选上图', '候选主体上图', '加入候选主体', '补充线索'].includes(normalized)) return 'extend_clues';
  if (['completerelation', 'relation', '补全关系', '关系分析', '分析关系', '补关系'].includes(normalized)) return 'complete_relation';
  if (['createsubject', 'createnode', 'manualnode', 'addmanualnode', '创建交易主体', '新增交易主体', '新建交易主体', '创建主体', '新增主体', '新建主体'].includes(normalized)) return 'create_subject';
  if (['addmanualtrade', 'manualtrade', 'addtrade', '补充资金往来', '补充交易', '人工补充交易', '新增交易流水', '新增资金往来', '手动交易', '手动资金往来'].includes(normalized)) return 'add_manual_trade';
  if (['addrealityrelation', 'realityrelation', 'relationship', '标注现实关系', '标注显示关系', '新增现实关系', '添加现实关系', '现实关系', '标注关系'].includes(normalized)) return 'add_reality_relation';
  return null;
}

function isClueExtensionActionIntent(...parts: string[]): boolean {
  const text = parts.filter(Boolean).join(' ');
  return /(线索扩展|扩展线索|综合筛选|候选主体|候选对象|加入图|加入当前图|补充到当前图|补充进图|上图)/.test(text);
}

function normalizeDirection(value: string): CaseGraphChatActionDirection | undefined {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!normalized) return undefined;
  if (['in', 'up', 'drillup', '上钻', '来源', '来款', '上游'].includes(normalized)) return 'in';
  if (['out', 'down', 'drilldown', '下钻', '去向', '出款', '下游'].includes(normalized)) return 'out';
  if (['both', '双向', '双向钻取', '钻取', '扩展'].includes(normalized)) return 'both';
  return undefined;
}

function normalizeFilters(value: Record<string, unknown>): CaseGraphChatActionFilters {
  const minAmount = readString(value, ['minAmount', 'min_amount', 'minimumAmount', '最小金额', '最低金额', '金额下限']);
  const maxAmount = readString(value, ['maxAmount', 'max_amount', 'maximumAmount', '最大金额', '最高金额', '金额上限']);
  const startTime = readString(value, ['startTime', 'start_time', '开始时间', '起始时间']);
  const endTime = readString(value, ['endTime', 'end_time', '结束时间', '截止时间']);
  const keyword = readString(value, ['keyword', 'query', '摘要', '备注', '关键词']);
  const minTradeCount = readString(value, ['minTradeCount', 'min_count', 'minCount', 'minTrades', '最小交易次数', '最小流水数', '交易次数下限', '最低笔数']);
  const maxTradeCount = readString(value, ['maxTradeCount', 'max_count', 'maxCount', 'maxTrades', '最大交易次数', '最大流水数', '交易次数上限', '最高笔数']);
  const filters: CaseGraphChatActionFilters = {};
  if (minAmount) filters.minAmount = minAmount;
  if (maxAmount) filters.maxAmount = maxAmount;
  if (startTime) filters.startTime = startTime;
  if (endTime) filters.endTime = endTime;
  if (keyword) filters.keyword = keyword;
  if (minTradeCount) filters.minTradeCount = minTradeCount;
  if (maxTradeCount) filters.maxTradeCount = maxTradeCount;
  return filters;
}

function normalizeTradeSelection(value: string): CaseGraphChatActionTradeSelection | undefined {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!normalized) return undefined;
  if (['outside', 'nonmatching', 'unmatched', 'keep', 'retain', '保留', '保留符合条件', '排除不符合条件'].includes(normalized)) {
    return 'outside';
  }
  if (['matching', 'matched', 'exclude', 'restore', '排除', '恢复', '符合条件'].includes(normalized)) {
    return 'matching';
  }
  return undefined;
}

function normalizeClueScope(value: string): 'node' | 'global' | undefined {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!normalized) return undefined;
  if (['global', 'all', '全局', '全图', '案件', '案件全局'].includes(normalized)) return 'global';
  if (['node', 'subject', '主体', '节点', '当前主体'].includes(normalized)) return 'node';
  return undefined;
}

function buildTradeScopeText(action: CaseGraphChatAction): string {
  if (action.fromQuery && action.toQuery) {
    return `${action.fromQuery} 和 ${action.toQuery} 之间`;
  }
  const nodeText = action.nodeName || action.nodeQuery || action.nodeId;
  if (nodeText) {
    if (action.direction === 'in') return `${nodeText} 的上游交易`;
    if (action.direction === 'out') return `${nodeText} 的下游交易`;
    return `${nodeText} 的关联交易`;
  }
  return '当前图谱范围内';
}

function buildFilterSummaryParts(filters: CaseGraphChatActionFilters): string[] {
  return [
    filters.minAmount ? `金额不少于 ${filters.minAmount} 元` : '',
    filters.maxAmount ? `金额不超过 ${filters.maxAmount} 元` : '',
    filters.startTime ? `开始时间 ${filters.startTime}` : '',
    filters.endTime ? `结束时间 ${filters.endTime}` : '',
    filters.keyword ? `包含“${filters.keyword}”` : '',
    filters.minTradeCount ? `交易次数不少于 ${filters.minTradeCount} 笔` : '',
    filters.maxTradeCount ? `交易次数不超过 ${filters.maxTradeCount} 笔` : '',
  ].filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readRecord(value: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const found = value[key];
    if (isRecord(found)) return found;
  }
  return null;
}

function readString(value: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const found = value[key];
    if (typeof found === 'string' && found.trim()) return found.trim();
    if (typeof found === 'number' && Number.isFinite(found)) return String(found);
  }
  return '';
}

function readBoolean(value: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const found = value[key];
    if (typeof found === 'boolean') return found;
    if (typeof found === 'string') {
      const normalized = found.trim().toLowerCase();
      if (['true', 'yes', '1', '是', '全部'].includes(normalized)) return true;
    }
  }
  return false;
}
