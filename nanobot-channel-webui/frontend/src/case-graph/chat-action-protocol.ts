export type CaseGraphChatActionType =
  | 'filter'
  | 'reset_filter'
  | 'drill'
  | 'exclude_node'
  | 'restore_node'
  | 'complete_relation';

export type CaseGraphChatActionDirection = 'in' | 'out' | 'both';

export type CaseGraphChatActionFilters = {
  minAmount?: string;
  maxAmount?: string;
  startTime?: string;
  endTime?: string;
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
  const type = normalizeActionType(rawType);
  if (!type) {
    return null;
  }
  const target = readRecord(value, ['target', 'node', '主体', '节点']) ?? {};
  const filters = normalizeFilters(readRecord(value, ['filters', '筛选', '筛选条件']) ?? value);
  const direction = normalizeDirection(readString(value, ['direction', '方向']) || rawType);
  const action: CaseGraphChatAction = {
    type,
    all: readBoolean(value, ['all', '全部']),
  };
  const label = readString(value, ['label', 'title', '名称', '标题']);
  const reason = readString(value, ['reason', '理由', '说明']);
  const nodeId = readString(value, ['nodeId', 'node_id', '主体编号', '节点编号']) || readString(target, ['id', 'nodeId', 'node_id']);
  const nodeQuery =
    readString(value, ['nodeQuery', 'query', 'keyword', '关键词', '主体', '账号'])
    || readString(target, ['query', 'keyword', 'name', 'label', 'accountName', 'tradeCard', '关键词']);
  const nodeName = readString(value, ['nodeName', 'name', '主体名称', '姓名']) || readString(target, ['name', 'label', 'accountName']);
  if (label) action.label = label;
  if (reason) action.reason = reason;
  if (nodeId) action.nodeId = nodeId;
  if (nodeQuery) action.nodeQuery = nodeQuery;
  if (nodeName) action.nodeName = nodeName;
  if (Object.keys(filters).length) {
    action.filters = filters;
  }
  if (direction) {
    action.direction = direction;
  }
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
    case 'complete_relation':
      return '补全图上关系';
    default:
      return '执行图谱操作';
  }
}

export function caseGraphActionSummary(action: CaseGraphChatAction): string {
  if (action.reason) return action.reason;
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
  const nodeText = action.nodeName || action.nodeQuery || action.nodeId;
  if (nodeText) {
    return `目标主体：${nodeText}`;
  }
  if (action.type === 'complete_relation') {
    return '核查当前图上主体之间是否还存在未连上的资金往来';
  }
  return '将对当前图谱执行该操作';
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
    /建议执行的图谱操作|请确认是否执行|需要我确认执行|确认后执行|已收到，你是要|你是要/.test(text)
    && /图谱操作|操作名称|操作内容|筛选|过滤|补全关系|清空筛选|重置筛选|恢复全部|全部恢复|已取消上图/.test(text)
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
  const parts = [
    filters.minAmount ? `只保留金额不少于 ${filters.minAmount} 元的资金线` : '',
    filters.maxAmount ? `只保留金额不超过 ${filters.maxAmount} 元的资金线` : '',
  ].filter(Boolean);
  return parts.length ? parts.join('，') : '按助手建议筛选当前图谱';
}

function normalizeActionType(value: string): CaseGraphChatActionType | null {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!normalized) return null;
  if (['filter', 'applyfilter', '筛选', '应用筛选', '图谱筛选'].includes(normalized)) return 'filter';
  if (['resetfilter', 'clearfilter', '清空筛选', '重置筛选', '清除筛选条件'].includes(normalized)) return 'reset_filter';
  if (['drill', 'drilldown', 'drillup', '上钻', '下钻', '双向钻取', '钻取', '扩展'].includes(normalized)) return 'drill';
  if (['excludenode', 'exclude', '取消上图', '排除', '排除主体', '取消主体上图'].includes(normalized)) return 'exclude_node';
  if (['restorenode', 'restore', '恢复', '恢复主体', '恢复上图'].includes(normalized)) return 'restore_node';
  if (['completerelation', 'relation', '补全关系', '关系分析', '分析关系', '补关系'].includes(normalized)) return 'complete_relation';
  return null;
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
  const filters: CaseGraphChatActionFilters = {};
  if (minAmount) filters.minAmount = minAmount;
  if (maxAmount) filters.maxAmount = maxAmount;
  if (startTime) filters.startTime = startTime;
  if (endTime) filters.endTime = endTime;
  return filters;
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
