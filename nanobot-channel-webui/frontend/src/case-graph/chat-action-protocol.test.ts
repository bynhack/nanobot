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
});
