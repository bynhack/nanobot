import { createContext } from 'react';

import type { CaseGraphChatAction } from '../../case-graph/chat-action-protocol';

export type CaseGraphActionPreview = {
  title: string;
  summary: string;
  disabledReason?: string;
};

export type CaseGraphActionContextValue = {
  preview: (action: CaseGraphChatAction) => CaseGraphActionPreview;
  execute: (action: CaseGraphChatAction) => Promise<void> | void;
};

export const CaseGraphActionContext = createContext<CaseGraphActionContextValue | null>(null);
