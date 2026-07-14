import * as React from 'react';
import { createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { WorkspacePanel } from './workspace-panel';
import type { SessionWorkspace, SessionWorkspaceFile } from '../../types';

const file: SessionWorkspaceFile = {
  id: 'file-1',
  name: 'final-report.md',
  url: '/api/workspaces/chat-1/files/file-1',
  mime: 'text/markdown',
  deliveredAt: '2026-05-13T08:01:00.000Z',
};

function workspace(files: SessionWorkspaceFile[]): SessionWorkspace {
  return {
    chatId: 'chat-1',
    updatedAt: null,
    files,
  };
}

describe('WorkspacePanel', () => {
  it('renders workspace files with file metadata', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspacePanel, {
        open: true,
        loading: false,
        error: null,
        workspace: workspace([file]),
        onClose: vi.fn(),
        onOpenFile: vi.fn(),
      }),
    );

    expect(html).toContain('final-report.md');
    expect(html).toContain('text/markdown');
    expect(html).toContain('2026');
  });

  it('renders an empty state when there are no delivered files', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspacePanel, {
        open: true,
        loading: false,
        error: null,
        workspace: workspace([]),
        onClose: vi.fn(),
        onOpenFile: vi.fn(),
      }),
    );

    expect(html).toContain('当前会话还没有最终交付文件');
  });

  it('calls the preview callback when a file is opened', () => {
    const onOpenFile = vi.fn();
    const element = WorkspacePanel({
      open: true,
      loading: false,
      error: null,
      workspace: workspace([file]),
      onClose: vi.fn(),
      onOpenFile,
    });

    const button = findFileButton(element, file.name);
    expect(button).not.toBeNull();
    button?.props.onClick();

    expect(onOpenFile).toHaveBeenCalledWith(file);
  });
});

function findFileButton(element: React.ReactNode, fileName: string): React.ReactElement<{ onClick: () => void }> | null {
  if (!isValidElement(element)) {
    return null;
  }
  const reactElement = element as React.ReactElement<{ children?: React.ReactNode; onClick?: () => void }>;
  if (reactElement.type === 'button' && containsText(reactElement.props.children, fileName) && reactElement.props.onClick) {
    return reactElement as React.ReactElement<{ onClick: () => void }>;
  }
  const children = React.Children.toArray(reactElement.props.children);
  for (const child of children) {
    const found = findFileButton(child, fileName);
    if (found) {
      return found;
    }
  }
  return null;
}

function containsText(node: React.ReactNode, text: string): boolean {
  if (typeof node === 'string') {
    return node.includes(text);
  }
  if (Array.isArray(node)) {
    return node.some((child) => containsText(child, text));
  }
  if (node && typeof node === 'object' && 'props' in node) {
    return containsText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children, text);
  }
  return false;
}
