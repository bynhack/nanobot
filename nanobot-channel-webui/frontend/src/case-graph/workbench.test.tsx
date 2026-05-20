import * as React from 'react';
import { createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatSidebar } from '../components/chat/sidebar';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('case graph workbench', () => {
  it('opens graph workbench from sidebar entry', async () => {
    const onOpenCaseGraph = () => {};
    const sidebar = ChatSidebar({
      title: 'Nanobot',
      sidebarCollapsed: false,
      activeThreadId: null,
      sessionsById: new Map(),
      connectionState: 'connected',
      onOpenSettings: () => {},
      onOpenCaseGraph,
    });
    const entryButton = findButton(sidebar, '上图');

    expect(entryButton).not.toBeNull();
    expect(entryButton?.props.onClick).toBe(onOpenCaseGraph);

    vi.stubGlobal('window', {
      __NANOBOT_WEBUI_BOOTSTRAP__: { title: 'Nanobot', authRequired: false },
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
      },
    });
    const { CaseGraphWorkbench } = await import('./workbench');
    const html = renderToStaticMarkup(createElement(CaseGraphWorkbench, { token: '', onBack: () => {} }));
    expect(html).toContain('返回');
    expect(html).toContain('案件');
  });
});

function findButton(element: React.ReactNode, label: string): React.ReactElement<{ onClick?: () => void }> | null {
  if (!isValidElement(element)) {
    return null;
  }
  const reactElement = element as React.ReactElement<{ children?: React.ReactNode; onClick?: () => void }>;
  if (typeof reactElement.type === 'function') {
    return findButton(reactElement.type(reactElement.props), label);
  }
  if (reactElement.type === 'button' && containsText(reactElement.props.children, label)) {
    return reactElement as React.ReactElement<{ onClick?: () => void }>;
  }
  const children = React.Children.toArray(reactElement.props.children);
  for (const child of children) {
    const found = findButton(child, label);
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
