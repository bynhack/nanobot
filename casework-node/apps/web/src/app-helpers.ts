import type {
  AppendMessage,
  CompleteAttachment,
  PendingAttachment,
  ThreadMessageLike,
} from '@assistant-ui/react';

import type { AppearanceMode, UiTheme } from './settings-page';
import { STORAGE_KEYS } from './store';
import type {
  AppState,
  HistoryMessage,
  MediaItem,
  PendingToolBlock,
  ToolHistoryItem,
  TurnPhase,
  UploadedAttachment,
} from './types';
import { detectMime } from './ui-utils';

export type RuntimeMessageSource = HistoryMessage;

export type UploadedCompleteAttachment = CompleteAttachment & {
  uploadedAttachment: UploadedAttachment;
};

export function summarizeSkillDescription(description: string): string {
  const compact = description.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return '';
  }
  const sentence = compact.split(/(?<=[.!?。！？])\s/)[0] ?? compact;
  return sentence.length > 88 ? `${sentence.slice(0, 88).trimEnd()}...` : sentence;
}

export function attachmentTypeForFile(file: File): 'image' | 'document' | 'file' {
  const mime = file.type.toLowerCase();
  if (mime.startsWith('image/')) {
    return 'image';
  }
  if (mime === 'application/pdf' || mime.includes('officedocument') || mime.startsWith('text/')) {
    return 'document';
  }
  return 'file';
}

export function uploadedToCompleteAttachment(
  attachment: PendingAttachment,
  uploaded: UploadedAttachment,
): UploadedCompleteAttachment {
  const mime = uploaded.mime ?? attachment.contentType ?? 'application/octet-stream';
  const type =
    mime.startsWith('image/') ? 'image' : attachmentTypeForFile(new File([], uploaded.name, { type: mime }));

  return {
    id: attachment.id,
    type,
    name: uploaded.name,
    contentType: mime,
    status: { type: 'complete' },
    content:
      type === 'image'
        ? [{ type: 'image', image: uploaded.url }]
        : [{ type: 'file', data: uploaded.url, filename: uploaded.name, mimeType: mime }],
    uploadedAttachment: uploaded,
  };
}

export function showToolResult(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }
  if (result == null) {
    return '';
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

export function toolStatusText(status?: string): string {
  if (status === 'error') {
    return '失败';
  }
  if (status === 'ok') {
    return '成功';
  }
  return '执行中';
}

export function formatElapsedMs(value: number): string {
  const totalSeconds = Math.max(0, Math.round(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}分${seconds.toString().padStart(2, '0')}秒` : `${seconds}秒`;
}

export function turnPhaseText(phase: TurnPhase): string {
  if (phase === 'idle') return '准备中';
  if (phase === 'streaming') return '思考中';
  if (phase === 'running_tools') return '调用工具中';
  if (phase === 'finalizing') return '整理结果中';
  if (phase === 'completed') return '本轮完成';
  return '处理中';
}

export function readAppearanceMode(): AppearanceMode {
  const stored = window.localStorage.getItem(STORAGE_KEYS.appearanceMode);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  return 'system';
}

export function readUiTheme(defaultTheme: UiTheme): UiTheme {
  const stored = window.localStorage.getItem(STORAGE_KEYS.uiTheme);
  if (stored === 'hr' || stored === 'business' || stored === 'gov') {
    return stored;
  }
  return defaultTheme;
}

export function mediaToParts(media: MediaItem[]): Array<ThreadMessageLike['content'][number]> {
  return media.map((item) => {
    const mime = detectMime(item);
    if (mime.startsWith('image/') && item.url.startsWith('data:image/')) {
      return {
        type: 'image' as const,
        image: item.url,
        filename: item.name,
      } as ThreadMessageLike['content'][number];
    }
    return {
      type: 'file' as const,
      data: item.url,
      filename: item.name,
      mimeType: mime,
    } as ThreadMessageLike['content'][number];
  });
}

export function mediaToAttachments(media: MediaItem[]) {
  return media.map((item, index) => {
    const mime = detectMime(item);
    const type = mime.startsWith('image/')
      ? 'image'
      : mime === 'application/pdf' || mime.includes('officedocument') || mime.startsWith('text/')
        ? 'document'
        : 'file';

    return {
      id: `attachment-${index}-${item.name}`,
      type,
      name: item.name,
      contentType: mime,
      status: { type: 'complete' as const },
      content:
        type === 'image'
          ? [{ type: 'image' as const, image: item.url }]
          : [{ type: 'file' as const, data: item.url, filename: item.name, mimeType: mime }],
    };
  });
}

export function toolToPart(
  tool: ToolHistoryItem,
  idPrefix: string,
  index: number,
  durationMs?: number,
): ThreadMessageLike['content'][number] {
  return {
    type: 'tool-call',
    toolCallId: `${idPrefix}-tool-${index}`,
    toolName: tool.name,
    args: tool.args,
    argsText: JSON.stringify(tool.args),
    result: tool.result || undefined,
    isError: tool.status === 'error',
    durationMs,
  } as ThreadMessageLike['content'][number];
}

export function pendingToolsToItems(pendingTools: PendingToolBlock): ToolHistoryItem[] {
  return pendingTools.tools.map((tool, index) => ({
    name: tool.name,
    args: tool.args,
    result: pendingTools.results?.[index]?.detail ?? '',
    status: pendingTools.results?.[index]?.status ?? 'ok',
  }));
}

export function historyMessageToThreadMessage(
  message: HistoryMessage,
  chatId: string,
  index: number,
  activeTurn: AppState['activeTurns'][string] | null,
): ThreadMessageLike {
  const id = message.id ?? `${chatId}-history-${index}`;
  const isRunningAssistant =
    message.type === 'assistant' &&
    activeTurn?.waiting &&
    activeTurn.messageId != null &&
    activeTurn.messageId === id;

  if (message.type === 'user') {
    return {
      id,
      role: 'user',
      content: [{ type: 'text', text: message.content }],
      attachments: message.media?.length ? mediaToAttachments(message.media) : [],
    };
  }

  if (message.type === 'assistant') {
    const toolParts = isRunningAssistant && activeTurn?.pendingTools
      ? pendingToolsToItems(activeTurn.pendingTools).map((tool, toolIndex) =>
          toolToPart(tool, id, toolIndex, activeTurn.pendingTools?.durationMs),
        )
      : [];
    return {
      id,
      role: 'assistant',
      status: isRunningAssistant ? { type: 'running' as const } : { type: 'complete' as const, reason: 'stop' as const },
      content: [
        { type: 'text', text: message.content },
        ...toolParts,
      ] as ThreadMessageLike['content'],
    };
  }

  if (message.type === 'outbound') {
    const content = [
      ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
      ...mediaToParts(message.media),
    ] as const as ThreadMessageLike['content'];
    return {
      id,
      role: 'assistant',
      status: { type: 'complete', reason: 'stop' },
      content,
    };
  }

  return {
    id,
    role: 'assistant',
    status: { type: 'complete', reason: 'stop' },
    content: message.tools.map((tool, toolIndex) => toolToPart(tool, id, toolIndex)) as ThreadMessageLike['content'],
  };
}

export function buildRuntimeMessages(state: AppState): readonly RuntimeMessageSource[] {
  const chatId = state.currentChatId;
  if (!chatId) {
    return [];
  }
  return state.messagesByChat[chatId] ?? [];
}

export function extractTextInput(message: AppendMessage): string {
  return message.content
    .filter((part): part is Extract<AppendMessage['content'][number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

export function extractUploadedAttachments(message: AppendMessage): UploadedAttachment[] {
  return (message.attachments ?? [])
    .map((attachment) => (attachment as UploadedCompleteAttachment).uploadedAttachment)
    .filter((attachment): attachment is UploadedAttachment => Boolean(attachment));
}

export function uploadedAttachmentToCompleteAttachment(uploaded: UploadedAttachment): UploadedCompleteAttachment {
  const mime = uploaded.mime ?? 'application/octet-stream';
  const type =
    mime.startsWith('image/')
      ? 'image'
      : mime === 'application/pdf' || mime.includes('officedocument') || mime.startsWith('text/')
        ? 'document'
        : 'file';

  const attachment: CompleteAttachment = {
    id: `${uploaded.path}:${uploaded.name}`,
    type,
    name: uploaded.name,
    contentType: mime,
    status: { type: 'complete' },
    content:
      type === 'image'
        ? [{ type: 'image', image: uploaded.url }]
        : [{ type: 'file', data: uploaded.url, filename: uploaded.name, mimeType: mime }],
  };

  return {
    ...attachment,
    uploadedAttachment: uploaded,
  };
}

export function buildTextAppendMessage(text: string, uploads: UploadedAttachment[] = []): AppendMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    attachments: uploads.map(uploadedAttachmentToCompleteAttachment),
    metadata: { custom: {} },
    createdAt: new Date(),
    parentId: null,
    sourceId: null,
    runConfig: undefined,
  };
}
