import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@assistant-ui/react', () => ({
  useAuiState: vi.fn(),
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(),
  },
}));

import { useAuiState } from '@assistant-ui/react';

import { MermaidDiagram } from './mermaid-diagram';

describe('assistant-ui mermaid diagram', () => {
  beforeEach(() => {
    vi.mocked(useAuiState).mockReturnValue(false);
  });

  it('renders a placeholder shell for mermaid code blocks', () => {
    const html = renderToStaticMarkup(
      createElement(MermaidDiagram, {
        code: 'graph TD\nA-->B',
        language: 'mermaid',
        components: {
          Pre: 'pre' as never,
          Code: 'code' as never,
        },
      }),
    );

    expect(html).toContain('aui-mermaid-diagram');
    expect(html).toContain('正在绘制图表...');
  });
});
