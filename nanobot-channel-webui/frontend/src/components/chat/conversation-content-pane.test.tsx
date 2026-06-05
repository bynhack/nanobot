import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ConversationContentPane } from './conversation-content-pane';

describe('ConversationContentPane', () => {
  it('renders a close action for the content panel itself', () => {
    const html = renderToStaticMarkup(
      <ConversationContentPane
        detailView={null}
        open={true}
        immersive={false}
        width={390}
        token="token"
        workspaceAvailable={true}
        workspaceOpen={false}
        workspaceLoading={false}
        workspaceError={null}
        workspace={null}
        workspaceFileCount={0}
        onOpenWorkspace={vi.fn()}
        onCloseWorkspace={vi.fn()}
        onOpenWorkspaceFile={vi.fn()}
        onCloseDetail={vi.fn()}
        onClosePanel={vi.fn()}
        onResizeStart={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="关闭内容区"');
  });
});
