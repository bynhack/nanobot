import { describe, expect, it } from 'vitest';

import {
  caseGraphActionSummary,
  caseGraphActionTitle,
  parseCaseGraphChatActionsFromText,
} from './chat-action-protocol';

describe('case graph chat action protocol', () => {
  it('parses hidden filter actions from assistant replies', () => {
    const actions = parseCaseGraphChatActionsFromText(
      '建议先看大额交易。\n<!-- 图谱动作 {"type":"filter","filters":{"minAmount":10000,"endTime":"2026-05-01"}} -->',
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'filter',
      filters: {
        minAmount: '10000',
        endTime: '2026-05-01',
      },
      all: false,
    });
    expect(caseGraphActionTitle(actions[0]!)).toBe('应用图谱筛选');
    expect(caseGraphActionSummary(actions[0]!)).toContain('最小金额 10000');
  });

  it('normalizes Chinese operation names and node targets', () => {
    const actions = parseCaseGraphChatActionsFromText(
      '<!-- 图谱动作 {"操作":"上钻","主体":{"name":"伍华中"},"理由":"继续看资金来源"} -->',
    );

    expect(actions[0]).toMatchObject({
      type: 'drill',
      direction: 'in',
      nodeQuery: '伍华中',
      nodeName: '伍华中',
      reason: '继续看资金来源',
      all: false,
    });
    expect(caseGraphActionTitle(actions[0]!)).toBe('执行上钻');
  });

  it('ignores malformed action comments', () => {
    expect(parseCaseGraphChatActionsFromText('<!-- 图谱动作 不是 JSON -->')).toEqual([]);
  });

  it('falls back to visible confirmation copy for amount filters', () => {
    const actions = parseCaseGraphChatActionsFromText(`
建议执行的图谱操作如下：

操作名称：资金线金额筛选
操作内容：将当前图中资金线按金额过滤，仅保留单条金额不少于 10000 元的资金线，其余金额低于 10000 元的资金线从当前视图中移除。
请确认是否执行该操作。
    `);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'filter',
      label: '资金线金额筛选',
      filters: {
        minAmount: '10000',
      },
      all: false,
    });
    expect(actions[0]?.filters).not.toHaveProperty('maxAmount');
  });

  it('does not turn ordinary investigation suggestions into actions', () => {
    const actions = parseCaseGraphChatActionsFromText(
      '建议下一步优先核实伍华中，并重点关注金额不少于 10000 元的资金线。',
    );

    expect(actions).toEqual([]);
  });

  it('falls back to visible confirmation copy for restoring all excluded subjects', () => {
    const actions = parseCaseGraphChatActionsFromText(`
已收到，你是要恢复全部已取消上图的主体。

如果你是想让我继续把这 5 个主体全部恢复回来，可以点击图谱操作执行。
    `);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'restore_node',
      label: '恢复全部主体',
      reason: '恢复全部已取消上图的主体',
      all: true,
    });
  });

  it('parses trade exclusion actions with party scope and filters', () => {
    const actions = parseCaseGraphChatActionsFromText(
      '<!-- 图谱动作 {"type":"exclude_trades","scope":{"from":"冯燕青","to":"蔡兆东"},"filters":{"maxAmount":1000},"reason":"排除冯燕青和蔡兆东之间小于 1000 元的交易流水"} -->',
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'exclude_trades',
      fromQuery: '冯燕青',
      toQuery: '蔡兆东',
      filters: {
        maxAmount: '1000',
      },
      reason: '排除冯燕青和蔡兆东之间小于 1000 元的交易流水',
    });
    expect(caseGraphActionTitle(actions[0]!)).toBe('排除交易流水');
  });

  it('parses keep-trade actions as excluding outside the matched range', () => {
    const actions = parseCaseGraphChatActionsFromText(
      '<!-- 图谱动作 {"type":"exclude_trades","nodeQuery":"冯燕青","direction":"out","selection":"outside","filters":{"minAmount":1000}} -->',
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'exclude_trades',
      nodeQuery: '冯燕青',
      direction: 'out',
      selection: 'outside',
      filters: {
        minAmount: '1000',
      },
    });
    expect(caseGraphActionTitle(actions[0]!)).toBe('保留交易流水');
    expect(caseGraphActionSummary(actions[0]!)).toContain('保留符合条件的交易流水');
  });

  it('parses clue extension actions with amount and trade count filters', () => {
    const actions = parseCaseGraphChatActionsFromText(
      '<!-- 图谱动作 {"type":"extend_clues","nodeQuery":"冯燕青","direction":"out","filters":{"minAmount":10000,"minTradeCount":3},"reason":"把冯燕青下游金额大于 1 万、交易次数超过 3 次的候选主体加入图"} -->',
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'extend_clues',
      nodeQuery: '冯燕青',
      direction: 'out',
      filters: {
        minAmount: '10000',
        minTradeCount: '3',
      },
    });
    expect(caseGraphActionTitle(actions[0]!)).toBe('综合筛选上图');
    expect(caseGraphActionSummary(actions[0]!)).toContain('综合筛选主体');
  });

  it('does not normalize clue extension wording to drill', () => {
    const actions = parseCaseGraphChatActionsFromText(
      '<!-- 图谱动作 {"type":"扩展","nodeQuery":"冯燕青","direction":"out","filters":{"minAmount":10000,"minTradeCount":3},"reason":"把冯燕青下游金额大于 1 万、交易次数超过 3 次的候选主体加入图"} -->',
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'extend_clues',
      direction: 'out',
      nodeQuery: '冯燕青',
    });
    expect(caseGraphActionTitle(actions[0]!)).toBe('综合筛选上图');
  });

  it('corrects drill actions when the business intent is clue extension', () => {
    const actions = parseCaseGraphChatActionsFromText(
      '<!-- 图谱动作 {"type":"drill","nodeQuery":"冯燕青","direction":"out","filters":{"minAmount":10000,"minTradeCount":3},"reason":"把冯燕青下游金额大于 1 万、交易次数超过 3 次的候选主体加入图"} -->',
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'extend_clues',
      direction: 'out',
      nodeQuery: '冯燕青',
    });
    expect(caseGraphActionTitle(actions[0]!)).toBe('综合筛选上图');
  });

  it('falls back to visible clue extension confirmation copy', () => {
    const actions = parseCaseGraphChatActionsFromText(
      '已为你准备把冯燕青下游中满足条件的候选主体加入当前图：金额大于 1 万、交易次数超过 3 次。待你在图谱界面确认后即可执行。',
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'extend_clues',
      nodeQuery: '冯燕青',
      direction: 'out',
      filters: {
        minAmount: '10000',
        minTradeCount: '3',
      },
    });
  });

  it('parses manual subject creation actions', () => {
    const actions = parseCaseGraphChatActionsFromText(
      '<!-- 图谱动作 {"type":"create_subject","subjectName":"张三","subjectTradeCard":"622200001111","discoveryReason":"审讯发现","sourceNote":"询问笔录","note":"现金收款人"} -->',
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'create_subject',
      subjectName: '张三',
      subjectTradeCard: '622200001111',
      discoveryReason: '审讯发现',
      sourceNote: '询问笔录',
      note: '现金收款人',
    });
    expect(caseGraphActionTitle(actions[0]!)).toBe('创建交易主体');
    expect(caseGraphActionSummary(actions[0]!)).toContain('主体：张三');
  });

  it('parses manual trade actions with a new counterparty', () => {
    const actions = parseCaseGraphChatActionsFromText(
      '<!-- 图谱动作 {"type":"add_manual_trade","payer":{"name":"张三","createNew":true,"tradeCard":"现金"},"payee":"伍华中","amount":"20万","tradeTime":"2026-01-10 12:00","method":"现金","sourceNote":"审讯发现","summary":"现金交付"} -->',
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'add_manual_trade',
      payerQuery: '张三',
      payerTradeCard: '现金',
      payerCreateNew: true,
      payeeQuery: '伍华中',
      amount: '20万',
      tradeTime: '2026-01-10 12:00',
      method: '现金',
      sourceNote: '审讯发现',
      summary: '现金交付',
    });
    expect(caseGraphActionTitle(actions[0]!)).toBe('补充资金往来');
    expect(caseGraphActionSummary(actions[0]!)).toContain('张三 → 伍华中');
  });

  it('parses reality relation actions', () => {
    const actions = parseCaseGraphChatActionsFromText(
      '<!-- 图谱动作 {"type":"add_reality_relation","source":"冯燕青","target":"冯光彩","relationType":"母女","note":"户籍信息确认"} -->',
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'add_reality_relation',
      sourceNodeQuery: '冯燕青',
      targetNodeQuery: '冯光彩',
      relationType: '母女',
      note: '户籍信息确认',
    });
    expect(caseGraphActionTitle(actions[0]!)).toBe('标注现实关系');
    expect(caseGraphActionSummary(actions[0]!)).toContain('冯燕青 与 冯光彩');
  });
});
