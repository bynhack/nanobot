import {
  AssistantRuntimeProvider,
  type AttachmentAdapter,
  ComposerPrimitive,
  MessagePrimitive,
  type PendingAttachment,
  type CompleteAttachment,
  ThreadPrimitive,
  useExternalStoreRuntime,
  useMessage,
  useThreadComposerAttachment,
  useThreadComposerAttachmentRuntime,
  type AppendMessage,
  type EmptyMessagePartProps,
  type FileMessagePartProps,
  type ImageMessagePartProps,
  type TextMessagePartProps,
  type ThreadMessageLike,
  type ToolCallMessagePartProps,
} from '@assistant-ui/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';

import { deleteSession, loadSessions, uploadFiles, withAuthQuery } from './api';
import { enhanceMarkdownHost, renderMarkdownHtml } from './markdown';
import { MediaPreviewController } from './media-preview';
import { SettingsScreen, type ThemePreference } from './settings-page';
import { STORAGE_KEYS, createInitialState, createStore } from './store';
import './styles.css';
import type {
  AppState,
  ActiveTurnState,
  HistoryMessage,
  MediaItem,
  PendingToolBlock,
  TurnPhase,
  ToolHistoryItem,
  UploadedAttachment,
} from './types';
import { WebSocketClient } from './ws-client';
import {
  bootstrapConfig,
  connectionStatusText,
  detectMime,
  fileTypeIcon,
  fileTypeLabel,
  formatDate,
  mediaPreviewUrl,
  shortChatId,
} from './ui-utils';

const bootstrap = bootstrapConfig();
const appStore = createStore(
  createInitialState(
    bootstrap,
    window.localStorage.getItem(STORAGE_KEYS.authToken) ?? '',
    window.localStorage.getItem(STORAGE_KEYS.chatId),
  ),
);

const ASSISTANT_COMPLETE_STATUS = { type: 'complete', reason: 'stop' } as const;
const ASSISTANT_RUNNING_STATUS = { type: 'running' } as const;

const attachmentTypeForFile = (file: File): 'image' | 'document' | 'file' => {
  const mime = file.type.toLowerCase();
  if (mime.startsWith('image/')) {
    return 'image';
  }
  if (mime === 'application/pdf' || mime.includes('officedocument') || mime.startsWith('text/')) {
    return 'document';
  }
  return 'file';
};

const webuiAttachmentAdapter: AttachmentAdapter = {
  accept: '*',
  async add({ file }): Promise<PendingAttachment> {
    return {
      id: `${file.name}-${file.size}-${file.lastModified}`,
      type: attachmentTypeForFile(file),
      name: file.name,
      contentType: file.type,
      file,
      status: { type: 'requires-action', reason: 'composer-send' },
    };
  },
  async remove(): Promise<void> {
    return;
  },
  async send(attachment): Promise<CompleteAttachment> {
    return {
      ...attachment,
      status: { type: 'complete' },
      file: attachment.file,
      content: [],
    };
  },
};

type AppView = 'chat' | 'settings';

type ToolDetailPayload = {
  args: Record<string, unknown>;
  result?: string;
  status?: string;
  durationMs?: number;
};

type DetailActions = {
  openMedia: (item: MediaItem) => void;
  openTool: (title: string, payload: ToolDetailPayload) => void;
};

type PendingPreviewRequest =
  | { type: 'media'; item: MediaItem }
  | { type: 'tool'; title: string; payload: ToolDetailPayload };

const DetailPreviewContext = createContext<DetailActions>({
  openMedia: () => undefined,
  openTool: () => undefined,
});

function useAppState(): AppState {
  return useSyncExternalStore(
    (onChange) => appStore.subscribe(() => onChange()),
    () => appStore.getState(),
    () => appStore.getState(),
  );
}

function showToolResult(result: unknown): string {
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

function toolStatusText(status?: string): string {
  if (status === 'error') {
    return '失败';
  }
  if (status === 'ok') {
    return '成功';
  }
  return '执行中';
}

function formatElapsedMs(value: number): string {
  const totalSeconds = Math.max(0, Math.round(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}分${seconds.toString().padStart(2, '0')}秒` : `${seconds}秒`;
}

function turnPhaseText(phase: TurnPhase): string {
  if (phase === 'idle') {
    return '准备中';
  }
  if (phase === 'streaming') {
    return '思考中';
  }
  if (phase === 'running_tools') {
    return '调用工具中';
  }
  if (phase === 'finalizing') {
    return '整理结果中';
  }
  if (phase === 'completed') {
    return '本轮完成';
  }
  return '处理中';
}

function readThemePreference(): ThemePreference {
  const stored = window.localStorage.getItem(STORAGE_KEYS.theme);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  return 'system';
}

function mediaToParts(media: MediaItem[]): Array<ThreadMessageLike['content'][number]> {
  return media.map((item) => {
    const mime = detectMime(item);
    // 统一使用 file 类型，包括图片
    return {
      type: 'file' as const,
      data: item.url,
      filename: item.name,
      mimeType: mime,
      rawUrl: item.url,
      rawMime: mime,
    } as ThreadMessageLike['content'][number];
  });
}

function mediaToAttachments(media: MediaItem[]) {
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
      content:
        type === 'image'
          ? [{ type: 'image' as const, image: item.url }]
          : [{ type: 'file' as const, data: item.url, filename: item.name, mimeType: mime }],
    };
  });
}

function toolToPart(
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

function pendingToolsToItems(pendingTools: PendingToolBlock): ToolHistoryItem[] {
  return pendingTools.tools.map((tool, index) => ({
    name: tool.name,
    args: tool.args,
    result: pendingTools.results?.[index]?.detail ?? '',
    status: pendingTools.results?.[index]?.status ?? 'ok',
  }));
}

function historyMessageToThreadMessage(
  message: HistoryMessage,
  chatId: string,
  index: number,
): ThreadMessageLike {
  const id = message.id ?? `${chatId}-history-${index}`;

  if (message.type === 'user') {
    return {
      id,
      role: 'user',
      content: [{ type: 'text', text: message.content }],
      attachments: message.media?.length ? mediaToAttachments(message.media) : [],
    };
  }

  if (message.type === 'assistant') {
    return {
      id,
      role: 'assistant',
      status: ASSISTANT_COMPLETE_STATUS,
      content: [{ type: 'text', text: message.content }],
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
      status: ASSISTANT_COMPLETE_STATUS,
      content,
    };
  }

  return {
    id,
    role: 'assistant',
    status: ASSISTANT_COMPLETE_STATUS,
    content: message.tools.map((tool, toolIndex) => toolToPart(tool, id, toolIndex)) as ThreadMessageLike['content'],
  };
}

function activeTurnToThreadMessage(
  chatId: string,
  activeTurn: AppState['activeTurns'][string],
): ThreadMessageLike | null {
  if (!activeTurn?.waiting) {
    return null;
  }

  const content = [
    ...(activeTurn.streamBuffer ? [{ type: 'text' as const, text: activeTurn.streamBuffer }] : []),
    ...(activeTurn.pendingTools 
      ? pendingToolsToItems(activeTurn.pendingTools).map((tool, index) => 
          toolToPart(tool, `${chatId}-active`, index, activeTurn.pendingTools?.durationMs)
        )
      : []
    )
  ] as const as ThreadMessageLike['content'];

  return {
    id: activeTurn.messageId ?? `${chatId}-active`,
    role: 'assistant',
    status: ASSISTANT_RUNNING_STATUS,
    content,
  };
}

type ActiveTurnMessageSource = {
  kind: 'active-turn';
  chatId: string;
  turn: ActiveTurnState;
};

type RuntimeMessageSource = HistoryMessage | ActiveTurnMessageSource;

function isActiveTurnMessageSource(message: RuntimeMessageSource): message is ActiveTurnMessageSource {
  return 'kind' in message && message.kind === 'active-turn';
}

function buildRuntimeMessages(state: AppState): readonly RuntimeMessageSource[] {
  const chatId = state.currentChatId;
  if (!chatId) {
    return [];
  }

  const history = state.messagesByChat[chatId] ?? [];
  const active = state.activeTurns[chatId];
  if (!active?.waiting) {
    return history;
  }

  return [
    ...history,
    {
      kind: 'active-turn',
      chatId,
      turn: active,
    },
  ];
}

function ImageThumbnail({ url, alt }: { url: string; alt: string }) {
  const [imageSrc, setImageSrc] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;
    let blobUrl: string | null = null;

    async function loadImage() {
      try {
        // 远程 URL 直接使用
        if (url.startsWith('http://') || url.startsWith('https://')) {
          if (mounted) {
            setImageSrc(url);
            setLoading(false);
          }
          return;
        }

        // 本地文件通过 fetchArrayBuffer 下载
        const token = window.localStorage.getItem(STORAGE_KEYS.authToken) ?? '';
        const arrayBuffer = await fetch(withAuthQuery(url, token)).then(r => r.arrayBuffer());
        const blob = new Blob([arrayBuffer], { type: 'image/*' });
        blobUrl = URL.createObjectURL(blob);

        if (mounted) {
          setImageSrc(blobUrl);
          setLoading(false);
        }
      } catch (err) {
        console.error('Failed to load image:', err);
        if (mounted) {
          setError(true);
          setLoading(false);
        }
      }
    }

    loadImage();

    return () => {
      mounted = false;
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [url]);

  if (loading) {
    return <div className="media-thumb-loading">加载中...</div>;
  }

  if (error) {
    return <div className="media-thumb-error">加载失败</div>;
  }

  return <img src={imageSrc} alt={alt} className="media-thumb-image" />;
}

function extractTextInput(message: AppendMessage): string {
  return message.content
    .filter((part): part is Extract<AppendMessage['content'][number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function extractAttachmentFiles(message: AppendMessage): File[] {
  return (message.attachments ?? [])
    .map((attachment) => attachment.file)
    .filter((file): file is File => file instanceof File);
}

function MarkdownPart({ text }: { text: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const html = useMemo(() => renderMarkdownHtml(text), [text]);

  useEffect(() => {
    if (hostRef.current) {
      enhanceMarkdownHost(hostRef.current);
    }
  }, [html]);

  return (
    <div className="message-markdown">
      <div ref={hostRef} className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function UserTextPart({ text }: TextMessagePartProps) {
  return <MarkdownPart text={text} />;
}

function AssistantTextPart({ text }: TextMessagePartProps) {
  return <MarkdownPart text={text} />;
}

function AssistantEmptyPart(_props: EmptyMessagePartProps) {
  return null;
}

function MediaInline({ children }: PropsWithChildren) {
  return <span className="media-inline">{children}</span>;
}

function AssistantImagePart(props: ImageMessagePartProps & { rawUrl?: string; rawMime?: string }) {
  const { openMedia } = useContext(DetailPreviewContext);
  const item: MediaItem = {
    url: props.rawUrl ?? props.image,
    name: props.filename ?? '图片',
    mime: props.rawMime ?? 'image/*',
  };

  return (
    <MediaInline>
      <button type="button" className="media-thumb" onClick={() => openMedia(item)}>
        <img src={props.image} alt={props.filename ?? '图片'} className="media-thumb-image" />
        <span className="media-thumb-overlay">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </span>
      </button>
    </MediaInline>
  );
}

function AssistantFilePart(props: FileMessagePartProps & { rawUrl?: string; rawMime?: string }) {
  const { openMedia } = useContext(DetailPreviewContext);
  const mime = props.rawMime ?? props.mimeType;
  const item: MediaItem = {
    url: props.rawUrl ?? props.data,
    name: props.filename ?? '附件',
    mime,
  };

  // 图片类型显示缩略图
  if (mime.startsWith('image/')) {
    return (
      <MediaInline>
        <button type="button" className="media-thumb" onClick={() => openMedia(item)}>
          <ImageThumbnail url={item.url} alt={item.name} />
          <span className="media-thumb-overlay">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
        </button>
      </MediaInline>
    );
  }

  // 其他文件类型显示文件卡片
  return (
    <MediaInline>
      <button type="button" className="media-card" onClick={() => openMedia(item)}>
        <span className="media-card-icon" dangerouslySetInnerHTML={{ __html: fileTypeIcon(mime) }} />
        <span className="media-card-content">
          <span className="media-card-name">{item.name}</span>
          <span className="media-kind">{fileTypeLabel(mime)}</span>
        </span>
      </button>
    </MediaInline>
  );
}

function ToolGroup({ children }: PropsWithChildren<{ startIndex: number; endIndex: number }>) {
  const message = useMessage();
  const isRunning = message.status?.type === 'running';
  const title = isRunning ? '正在调用工具' : '工具调用';
  
  return (
    <div className="tool-group">
      <div className="tool-group-header">
        <svg className="tool-group-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-7.952m2.073-5.509l3.27.808a2.652 2.652 0 012.01 3.248l-.79 3.218" />
        </svg>
        <span>{title}</span>
      </div>
      <div className="tool-list">{children}</div>
    </div>
  );
}

function ToolCallPart(
  props: ToolCallMessagePartProps<Record<string, unknown>, unknown> & { durationMs?: number },
) {
  const { openTool } = useContext(DetailPreviewContext);
  const pending = props.status.type === 'running' || props.result === undefined;
  const status = pending ? 'pending' : props.isError ? 'error' : 'ok';
  const icon =
    status === 'pending'
      ? '<span class="tool-icon spinner"></span>'
      : status === 'ok'
        ? '<svg class="tool-icon success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>'
        : '<svg class="tool-icon error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>';

  return (
    <button
      type="button"
      className="tool-row"
      onClick={() =>
        openTool(props.toolName, {
          args: props.args,
          result: showToolResult(props.result),
          status: props.isError ? 'error' : pending ? undefined : 'ok',
          durationMs: props.durationMs,
        })
      }
    >
      <span className="tool-left" dangerouslySetInnerHTML={{ __html: `${icon}<strong>${props.toolName}</strong>` }} />
      <span className="tool-hint">{`(${JSON.stringify(props.args)})`}</span>
      <span className="tool-row-status">
        {props.durationMs && !pending ? `${props.durationMs} 毫秒 · ${toolStatusText(props.isError ? 'error' : 'ok')}` : toolStatusText(pending ? undefined : props.isError ? 'error' : 'ok')}
      </span>
    </button>
  );
}

function MessageAttachmentChip({
  attachment,
}: {
  attachment: {
    type: string;
    name: string;
    contentType?: string;
    content?: ReadonlyArray<{ type: string; image?: string; data?: string }>;
  };
}) {
  const { openMedia } = useContext(DetailPreviewContext);
  const mime = attachment.contentType ?? 'application/octet-stream';
  const firstPart = attachment.content?.[0];
  const url = firstPart?.type === 'image' ? firstPart.image : firstPart?.type === 'file' ? firstPart.data : '';
  const item: MediaItem = { url: url ?? '', name: attachment.name, mime };

  if (mime.startsWith('image/') && item.url) {
    return (
      <button type="button" className="composer-media-thumb readonly" onClick={() => openMedia(item)}>
        <ImageThumbnail url={item.url} alt={item.name} />
      </button>
    );
  }

  return (
    <button type="button" className="composer-attachment-chip readonly" onClick={() => openMedia(item)}>
      <span className="composer-attachment-icon" dangerouslySetInnerHTML={{ __html: fileTypeIcon(mime) }} />
      <span className="composer-attachment-label">{item.name}</span>
    </button>
  );
}

function ComposerAttachmentChip() {
  const attachment = useThreadComposerAttachment();
  const attachmentRuntime = useThreadComposerAttachmentRuntime();
  const previewUrl = useMemo(() => {
    if (!attachment.file || !(attachment.contentType ?? '').startsWith('image/')) {
      return '';
    }
    return URL.createObjectURL(attachment.file);
  }, [attachment]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  if ((attachment.contentType ?? '').startsWith('image/') && previewUrl) {
    return (
      <div className="composer-media-thumb-shell">
        <img src={previewUrl} alt={attachment.name} className="composer-media-thumb-image" />
        <button
          type="button"
          className="composer-attachment-remove"
          onClick={() => void attachmentRuntime.remove()}
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="composer-attachment-chip">
      <span className="composer-attachment-icon" dangerouslySetInnerHTML={{ __html: fileTypeIcon(attachment.contentType ?? '') }} />
      <span className="composer-attachment-label">{attachment.name}</span>
      <button
        type="button"
        className="composer-attachment-remove inline"
        onClick={() => void attachmentRuntime.remove()}
      >
        ×
      </button>
    </div>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="message-row user">
      <div className="bubble user">
        <MessagePrimitive.Attachments>
          {({ attachment }) => <MessageAttachmentChip attachment={attachment} />}
        </MessagePrimitive.Attachments>
        <MessagePrimitive.Parts components={{ Text: UserTextPart }} />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="message-row assistant">
      <div className="assistant-stack">
        <div className="bubble assistant">
          <MessagePrimitive.Parts
            components={{
              Text: AssistantTextPart,
              Image: AssistantImagePart,
              File: AssistantFilePart,
              Empty: AssistantEmptyPart,
              tools: { Fallback: ToolCallPart },
              ToolGroup,
            }}
          />
          <MessagePrimitive.Error>
            <div className="tool-meta">发生错误</div>
          </MessagePrimitive.Error>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function Composer({ isRunning }: { isRunning: boolean }) {
  return (
    <ComposerPrimitive.Root className="composer-surface">
      <ComposerPrimitive.AddAttachment className="composer-attach" aria-label="添加附件">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
        </svg>
      </ComposerPrimitive.AddAttachment>
      <div className="composer-main">
        <div className="composer-attachments-row mt-1">
          <ComposerPrimitive.Attachments>
            {() => <ComposerAttachmentChip />}
          </ComposerPrimitive.Attachments>
        </div>
      <ComposerPrimitive.Input
        className="composer-input"
        placeholder="发送消息…"
        submitMode="enter"
        rows={1}
        unstable_focusOnRunStart={false}
        unstable_focusOnScrollToBottom={false}
        unstable_focusOnThreadSwitched={false}
      />
      </div>
      {isRunning ? (
        <ComposerPrimitive.Cancel className="composer-cancel">
          <span className="composer-stop-glyph" />
        </ComposerPrimitive.Cancel>
      ) : (
        <ComposerPrimitive.Send className="composer-send">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 11L12 6L17 11M12 18V7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </ComposerPrimitive.Send>
      )}
    </ComposerPrimitive.Root>
  );
}


export function App() {
  const state = useAppState();
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(bootstrap.authRequired && !state.authToken);
  const [draftToken, setDraftToken] = useState(state.authToken);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [appView, setAppView] = useState<AppView>('chat');
  const [panelOpen, setPanelOpen] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => readThemePreference());
  const [nowMs, setNowMs] = useState(() => Date.now());

  const flashTimerRef = useRef<number | null>(null);
  const authTokenRef = useRef(state.authToken);
  const chatIdRef = useRef(state.currentChatId);
  const wsClientRef = useRef<WebSocketClient | null>(null);
  const previewRef = useRef<MediaPreviewController | null>(null);
  const pendingPreviewRef = useRef<PendingPreviewRequest | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const panelTitleRef = useRef<HTMLHeadingElement | null>(null);
  const panelBodyRef = useRef<HTMLDivElement | null>(null);
  const panelDownloadRef = useRef<HTMLAnchorElement | null>(null);
  const panelCloseRef = useRef<HTMLButtonElement | null>(null);

  const showFlash = useCallback((message: string) => {
    setFlashMessage(message);
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current);
    }
    flashTimerRef.current = window.setTimeout(() => {
      setFlashMessage(null);
    }, 3500);
  }, []);

  const refreshSessions = useCallback(async () => {
    if (bootstrap.authRequired && !authTokenRef.current) {
      appStore.dispatch({ type: 'sessions.loaded', sessions: [] });
      return;
    }
    try {
      const sessions = await loadSessions(authTokenRef.current);
      appStore.dispatch({ type: 'sessions.loaded', sessions });
    } catch (error) {
      showFlash(error instanceof Error ? error.message : '加载会话失败');
    }
  }, [showFlash]);

  useEffect(() => {
    document.title = bootstrap.title;
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themePreference;
    window.localStorage.setItem(STORAGE_KEYS.theme, themePreference);
  }, [themePreference]);

  useEffect(() => {
    authTokenRef.current = state.authToken;
    chatIdRef.current = state.currentChatId;
  }, [state.authToken, state.currentChatId]);

  useEffect(() => {
    setDraftToken(state.authToken);
  }, [state.authToken]);

  useEffect(() => {
    if (bootstrap.authRequired && !state.authToken) {
      setAuthModalOpen(true);
    }
  }, [state.authToken]);

  useEffect(() => {
    const syncResponsiveSidebar = () => {
      setSidebarCollapsed(window.innerWidth <= 860);
    };
    syncResponsiveSidebar();
    window.addEventListener('resize', syncResponsiveSidebar);
    return () => window.removeEventListener('resize', syncResponsiveSidebar);
  }, []);

  useEffect(() => {
    const client = new WebSocketClient({
      getAuthToken: () => authTokenRef.current,
      getChatId: () => chatIdRef.current,
      onConnectionState: (connectionState) => {
        appStore.dispatch({ type: 'connection.set', connectionState });
        if (connectionState === 'connected') {
          void refreshSessions();
        }
      },
      onEvent: (event) => {
        if (event.type === 'session.init') {
          window.localStorage.setItem(STORAGE_KEYS.chatId, event.chatId);
          void refreshSessions();
        }
        if (event.type === 'session.deleted' && appStore.getState().currentChatId === event.chatId) {
          window.localStorage.removeItem(STORAGE_KEYS.chatId);
        }
        if (event.type === 'error') {
          showFlash(event.message);
        }
        appStore.dispatch({ type: 'server.event', event });
      },
    });

    wsClientRef.current = client;
    return () => {
      client.close();
      wsClientRef.current = null;
    };
  }, [refreshSessions, showFlash]);

  useEffect(() => {
    const client = wsClientRef.current;
    if (!client) {
      return;
    }
    if (bootstrap.authRequired && !state.authToken) {
      client.close();
      appStore.dispatch({ type: 'connection.set', connectionState: 'auth_required' });
      appStore.dispatch({ type: 'sessions.loaded', sessions: [] });
      return;
    }

    client.connect();
    return () => client.close();
  }, [state.authToken]);

  useEffect(() => {
    if (appView !== 'chat') {
      previewRef.current?.close();
      previewRef.current = null;
      return;
    }

    if (!panelRef.current || !panelTitleRef.current || !panelBodyRef.current || !panelDownloadRef.current || !panelCloseRef.current) {
      return;
    }

    previewRef.current?.close();
    previewRef.current = new MediaPreviewController({
      panel: panelRef.current,
      title: panelTitleRef.current,
      body: panelBodyRef.current,
      downloadLink: panelDownloadRef.current,
      closeButton: panelCloseRef.current,
      getToken: () => authTokenRef.current,
      onClose: () => setPanelOpen(false),
    });

    if (pendingPreviewRef.current) {
      const pending = pendingPreviewRef.current;
      pendingPreviewRef.current = null;
      if (pending.type === 'media') {
        void previewRef.current.openMedia(pending.item);
      } else {
        previewRef.current.openTool(pending.title, pending.payload);
      }
    }

    return () => {
      previewRef.current?.close();
      previewRef.current = null;
    };
  }, [appView]);

  useEffect(() => {
    if (!panelOpen) {
      previewRef.current?.close();
    }
  }, [panelOpen]);

  useEffect(() => {
    if (!state.currentChatId) {
      return;
    }
    const turn = state.activeTurns[state.currentChatId];
    if (!(turn?.waiting && turn.startedAtMs)) {
      return;
    }
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state.currentChatId, state.activeTurns]);

  const openMedia = useCallback((item: MediaItem) => {
    setPanelOpen(true);
    if (previewRef.current) {
      void previewRef.current.openMedia(item);
      return;
    }
    pendingPreviewRef.current = { type: 'media', item };
  }, []);

  const openTool = useCallback((title: string, payload: ToolDetailPayload) => {
    setPanelOpen(true);
    if (previewRef.current) {
      previewRef.current.openTool(title, payload);
      return;
    }
    pendingPreviewRef.current = { type: 'tool', title, payload };
  }, []);

  const previewActions = useMemo<DetailActions>(
    () => ({ openMedia, openTool }),
    [openMedia, openTool],
  );

  const runtimeMessages = useMemo(() => buildRuntimeMessages(state), [state]);
  const activeTurn = state.currentChatId ? state.activeTurns[state.currentChatId] : null;
  
  // 基于最后一条消息的状态判断是否正在运行
  const isRunning = Boolean(activeTurn?.waiting);
  const turnElapsedMs = activeTurn?.waiting && activeTurn.startedAtMs
    ? Math.max(0, nowMs - activeTurn.startedAtMs)
    : activeTurn?.lastDurationMs ?? null;
  const turnStatusText = activeTurn?.startedAtMs && turnElapsedMs !== null
    ? `${turnPhaseText(activeTurn.phase)} · ${formatElapsedMs(turnElapsedMs)}`
    : null;

  const handleNewMessage = useCallback(
    async (message: AppendMessage) => {
      const content = extractTextInput(message);
      const files = extractAttachmentFiles(message);
      if (!content && !files.length) {
        showFlash('请输入消息或添加附件');
        return;
      }

      const chatId = appStore.getState().currentChatId;
      if (!chatId || appStore.getState().connectionState !== 'connected') {
        showFlash('连接尚未建立，请稍后重试');
        return;
      }

      let uploadedFiles: UploadedAttachment[] = [];
      if (files.length) {
        try {
          uploadedFiles = await uploadFiles(chatId, files, authTokenRef.current);
        } catch (error) {
          showFlash(error instanceof Error ? error.message : '上传文件失败');
          return;
        }
      }

      appStore.dispatch({
        type: 'local.user_message',
        chatId,
        content,
        media: uploadedFiles.map(({ url, name, mime }) => ({ url, name, mime })),
      });
      appStore.dispatch({ type: 'local.turn_started', chatId });
      wsClientRef.current?.send({
        type: 'message.send',
        content,
        attachments: uploadedFiles.map(({ path, name, mime }) => ({ path, name, mime })),
      });
    },
    [showFlash],
  );

  const runtime = useExternalStoreRuntime<RuntimeMessageSource>({
    messages: runtimeMessages,
    isRunning,
    isDisabled:
      (bootstrap.authRequired && !state.authToken) ||
      state.connectionState !== 'connected' ||
      !state.currentChatId,
    adapters: {
      attachments: webuiAttachmentAdapter,
    },
    onNew: handleNewMessage,
    onCancel: async () => {
      wsClientRef.current?.send({ type: 'message.cancel' });
    },
    convertMessage: (message, index) => {
      if (isActiveTurnMessageSource(message)) {
        return activeTurnToThreadMessage(message.chatId, message.turn) as ThreadMessageLike;
      }

      const chatId = state.currentChatId;
      if (!chatId) {
        throw new Error('缺少当前会话 ID');
      }

      return historyMessageToThreadMessage(message, chatId, index);
    },
  });

  return (
    <DetailPreviewContext.Provider value={previewActions}>
      <div className="shell">
        <aside className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
          <div className="sidebar-header">
            <div className="brand">
              <div className="brand-mark">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2c0 0 1.2 5.4 6 6-4.8 1.2-6 6-6 6s-1.2-5.4-6-6c4.8-1.2 6-6 6-6z" />
                  <path d="M19.5 15c0 0 .6 2.7 2.5 3-1.9.6-2.5 3-2.5 3s-.6-2.7-2.5-3c1.9-.6 2.5-3 2.5-3z" opacity=".72" />
                  <path d="M4.5 4c0 0 .4 1.8 1.5 2-1.1.4-1.5 2-1.5 2s-.4-1.8-1.5-2c1.1-.4 1.5-2 1.5-2z" opacity=".48" />
                </svg>
              </div>
              <div>
                <div className="brand-title">{bootstrap.title}</div>
                <div className="brand-subtitle">{shortChatId(state.currentChatId)}</div>
              </div>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="新对话"
              onClick={() => wsClientRef.current?.send({ type: 'session.new' })}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
          <div className="sessions-list">
              {state.sessions.length ? (
                state.sessions.map((session) => (
                  <div
                    key={session.chat_id}
                    className={`session-item${session.chat_id === state.currentChatId ? ' active' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (session.chat_id !== state.currentChatId) {
                        wsClientRef.current?.send({ type: 'session.switch', chatId: session.chat_id });
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        if (session.chat_id !== state.currentChatId) {
                          wsClientRef.current?.send({ type: 'session.switch', chatId: session.chat_id });
                        }
                      }
                    }}
                  >
                    <div className="session-meta">
                      <span>{formatDate(session.last_ts || session.created_at)}</span>
                      <span>{session.message_count} 条</span>
                    </div>
                    <p>{session.preview}</p>
                    <button
                      type="button"
                      className="delete-pill"
                      aria-label="删除会话"
                      onClick={async (event) => {
                        event.stopPropagation();
                        try {
                          await deleteSession(session.chat_id, state.authToken);
                          if (state.currentChatId === session.chat_id) {
                            wsClientRef.current?.send({ type: 'session.new' });
                          }
                          await refreshSessions();
                        } catch (error) {
                          showFlash(error instanceof Error ? error.message : '删除会话失败');
                        }
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))
              ) : (
                <div className="empty-sessions">暂无历史对话</div>
              )}
            </div>
            <div className="sidebar-footer">
              <div className={`status-badge ${state.connectionState}`}>
                <span className="status-dot" />
                <span>{connectionStatusText(state.connectionState)}</span>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="打开设置"
                onClick={() => {
                  setPanelOpen(false);
                  setAppView('settings');
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15.5A3.5 3.5 0 1012 8.5a3.5 3.5 0 000 7z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1.03 1.56V21a2 2 0 01-4 0v-.09A1.7 1.7 0 008.98 19.35a1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.7 1.7 0 004.63 15a1.7 1.7 0 00-1.56-1.03H3a2 2 0 010-4h.09A1.7 1.7 0 004.65 8.98a1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 012.83-2.83l.06.06A1.7 1.7 0 008.98 4.65 1.7 1.7 0 0010.01 3.09V3a2 2 0 014 0v.09a1.7 1.7 0 001.03 1.56 1.7 1.7 0 001.87-.34l.06-.06a2 2 0 012.83 2.83l-.06.06A1.7 1.7 0 0019.35 8.98c.2.63.81 1.05 1.47 1.03H21a2 2 0 010 4h-.09A1.7 1.7 0 0019.4 15z" />
                </svg>
              </button>
            </div>
          </aside>
          <main className="chat">
            <div className="chat-top-controls">
                <button
                  className="icon-button mobile-sidebar-toggle"
                  type="button"
                  aria-label="切换侧边栏"
                  onClick={() => setSidebarCollapsed((value) => !value)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
            </div>
            {flashMessage ? <div className="flash">{flashMessage}</div> : null}
            <AssistantRuntimeProvider runtime={runtime}>
              <ThreadPrimitive.Root className="thread-root">
                <ThreadPrimitive.Viewport className="messages">
                  <ThreadPrimitive.Empty>
                    <div className="hero-welcome">
                      <div className="hero-logo">
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M12 2c0 0 1.2 5.4 6 6-4.8 1.2-6 6-6 6s-1.2-5.4-6-6c4.8-1.2 6-6 6-6z" />
                          <path d="M19.5 15c0 0 .6 2.7 2.5 3-1.9.6-2.5 3-2.5 3s-.6-2.7-2.5-3c1.9-.6 2.5-3 2.5-3z" opacity=".72" />
                          <path d="M4.5 4c0 0 .4 1.8 1.5 2-1.1.4-1.5 2-1.5 2s-.4-1.8-1.5-2c1.1-.4 1.5-2 1.5-2z" opacity=".48" />
                        </svg>
                      </div>
                      <div className="hero-title">有什么我可以帮您的？</div>
                    </div>
                  </ThreadPrimitive.Empty>
                  <ThreadPrimitive.Messages
                    components={{
                      UserMessage,
                      AssistantMessage,
                    }}
                  />
                  <ThreadPrimitive.ViewportFooter className="thread-footer">
                    {turnStatusText ? <div className="turn-status-line">{turnStatusText}</div> : null}
                    <ThreadPrimitive.ScrollToBottom className="thread-scroll-bottom">
                      ↓
                    </ThreadPrimitive.ScrollToBottom>
                    <Composer isRunning={isRunning} />
                  </ThreadPrimitive.ViewportFooter>
                </ThreadPrimitive.Viewport>
              </ThreadPrimitive.Root>
            </AssistantRuntimeProvider>
          </main>
          <section
            ref={panelRef}
            className={`detail-panel${panelOpen ? '' : ' hidden'}`}
          >
            <div className="detail-header">
              <div>
                <div className="detail-kicker">查看器</div>
                <h3 ref={panelTitleRef}>详情</h3>
              </div>
              <div className="detail-actions">
                <a ref={panelDownloadRef} className="ghost-button hidden" href="#">
                  下载
                </a>
                <button
                  ref={panelCloseRef}
                  className="ghost-button"
                  type="button"
                  onClick={() => setPanelOpen(false)}
                >
                  关闭
                </button>
              </div>
            </div>
            <div ref={panelBodyRef} className="detail-body" />
          </section>
            {appView === 'settings' ? (
              <SettingsScreen
                authRequired={bootstrap.authRequired}
                connectionState={state.connectionState}
                currentChatId={state.currentChatId}
                onBack={() => setAppView('chat')}
                onOpenAuth={() => setAuthModalOpen(true)}
                themePreference={themePreference}
                onThemeChange={setThemePreference}
                token={state.authToken}
              />
            ) : null}
        <div className={`auth-modal${authModalOpen ? '' : ' hidden'}`}>
          <div className="auth-card">
            <h2>需要认证</h2>
            <p>请输入当前配置的访问令牌。</p>
            <input
              type="password"
              placeholder="请输入访问令牌"
              value={draftToken}
              onChange={(event) => setDraftToken(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  const token = draftToken.trim();
                  window.localStorage.setItem(STORAGE_KEYS.authToken, token);
                  appStore.dispatch({ type: 'auth.set', token });
                  setAuthModalOpen(false);
                }
              }}
            />
            <div className="auth-actions">
              <button
                id="auth-save"
                type="button"
                onClick={() => {
                  const token = draftToken.trim();
                  window.localStorage.setItem(STORAGE_KEYS.authToken, token);
                  appStore.dispatch({ type: 'auth.set', token });
                  setAuthModalOpen(false);
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      </div>
    </DetailPreviewContext.Provider>
  );
}
