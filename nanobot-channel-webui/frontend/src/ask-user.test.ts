import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { findPendingAskUserPrompt } from './ask-user';
import { AskUserPromptCard, normalizeAskUserQuestionMarkdown } from './ask-user-prompt';
import type { HistoryMessage } from './types';

describe('findPendingAskUserPrompt', () => {
  it('returns the last assistant message with buttons when no later user reply exists', () => {
    const messages: HistoryMessage[] = [
      { type: 'assistant', content: '上一步', buttons: [['忽略']] },
      { type: 'assistant', content: '请确认本次操作：更新员工信息', buttons: [['确认', '取消']] },
    ];

    expect(findPendingAskUserPrompt(messages)).toEqual({
      question: '请确认本次操作：更新员工信息',
      buttons: [['确认', '取消']],
      kind: 'confirm',
    });
  });

  it('returns null after the user has replied', () => {
    const messages: HistoryMessage[] = [
      { type: 'assistant', content: '请确认本次操作：更新员工信息', buttons: [['确认', '取消']] },
      { type: 'user', content: '确认' },
    ];

    expect(findPendingAskUserPrompt(messages)).toBeNull();
  });

  it('ignores assistant messages without buttons', () => {
    const messages: HistoryMessage[] = [
      { type: 'assistant', content: '普通回复' },
    ];

    expect(findPendingAskUserPrompt(messages)).toBeNull();
  });

  it('treats non-confirm buttons as selection prompts', () => {
    const messages: HistoryMessage[] = [
      { type: 'assistant', content: '请选择环境', buttons: [['预发', '生产']] },
    ];

    expect(findPendingAskUserPrompt(messages)).toEqual({
      question: '请选择环境',
      buttons: [['预发', '生产']],
      kind: 'select',
    });
  });

  it('renders markdown question content in the prompt card', () => {
    const html = renderToStaticMarkup(
      createElement(AskUserPromptCard, {
        prompt: {
          question: '# 更新说明\n- 更新姓名\n- 更新手机号',
          buttons: [['确认', '取消']],
          kind: 'confirm',
        },
      }),
    );

    expect(html).toContain('<h1>更新说明</h1>');
    expect(html).toContain('<li>更新姓名</li>');
    expect(html).toContain('确认');
    expect(html).toContain('取消');
  });

  it('restores flattened markdown questions into block structure', () => {
    expect(
      normalizeAskUserQuestionMarkdown('# 更新说明 - 更新姓名 - 更新手机号 **确认后继续执行，取消则停止。**'),
    ).toBe('# 更新说明\n- 更新姓名\n- 更新手机号\n\n**确认后继续执行，取消则停止。**');
  });
});
