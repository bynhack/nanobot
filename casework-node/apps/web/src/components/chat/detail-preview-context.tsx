import { createContext } from 'react';

import type { MediaItem } from '../../types';

export type ToolDetailPayload = {
  args: Record<string, unknown>;
  result?: string;
  status?: string;
  durationMs?: number;
};

export type DetailActions = {
  openMedia: (item: MediaItem) => void;
  openTool: (title: string, payload: ToolDetailPayload) => void;
};

export const DetailPreviewContext = createContext<DetailActions>({
  openMedia: () => undefined,
  openTool: () => undefined,
});
