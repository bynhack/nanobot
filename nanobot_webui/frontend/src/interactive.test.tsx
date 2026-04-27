import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { InteractiveBlock } from './interactive';

describe('InteractiveBlock', () => {
  it('renders pending confirm actions inline', () => {
    const html = renderToStaticMarkup(
      <InteractiveBlock
        interaction={{
          id: 'int_confirm',
          kind: 'confirm',
          payload: {
            title: '确认部署',
            message: '继续发布到生产环境？',
            confirm_text: '继续',
            cancel_text: '停止',
          },
          status: 'pending',
        }}
        onResolve={vi.fn()}
      />,
    );

    expect(html).toContain('确认部署');
    expect(html).toContain('继续发布到生产环境？');
    expect(html).toContain('继续');
    expect(html).toContain('停止');
  });

  it('renders completed select results read-only', () => {
    const html = renderToStaticMarkup(
      <InteractiveBlock
        interaction={{
          id: 'int_select',
          kind: 'select',
          payload: {
            title: '选择环境',
            options: [
              { label: '预发', value: 'staging' },
              { label: '生产', value: 'prod' },
            ],
          },
          status: 'ok',
          result: { selected: ['prod'] },
        }}
      />,
    );

    expect(html).toContain('选择环境');
    expect(html).toContain('已完成');
    expect(html).toContain('生产');
  });

  it('renders cancelled input state without edit controls', () => {
    const html = renderToStaticMarkup(
      <InteractiveBlock
        interaction={{
          id: 'int_input',
          kind: 'input',
          payload: {
            title: '输入变更说明',
            placeholder: '请填写',
          },
          status: 'cancelled',
        }}
      />,
    );

    expect(html).toContain('输入变更说明');
    expect(html).toContain('已取消');
    expect(html).toContain('用户已取消该交互');
    expect(html).not.toContain('textarea');
    expect(html).not.toContain('提交输入');
  });
});
