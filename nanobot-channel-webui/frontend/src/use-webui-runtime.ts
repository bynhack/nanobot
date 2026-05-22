import {
  type AppendMessage,
  type AttachmentAdapter,
  type CompleteAttachment,
  type PendingAttachment,
  type ExternalStoreAdapter,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import {
  attachmentTypeForFile,
  extractTextInput,
  extractUploadedAttachments,
  historyMessageToThreadMessage,
  RuntimeMessageSource,
  uploadedToCompleteAttachment,
} from './app-helpers';
import { appStore, bootstrap, useAppSelector } from './app-state';
import { buildExternalThreadListAdapter, buildThreadSuggestions } from './assistant-ui-runtime';
import { findPendingAskUserPrompt } from './ask-user';
import { uploadFiles } from './api';
import { messageContentWithSelectedSkill } from './skill-quick-select';

const EMPTY_MESSAGES: readonly RuntimeMessageSource[] = [];

export function useWebuiRuntime({
  showFlash,
  actions,
}: {
  showFlash: (message: string) => void;
  actions: {
    sendMessage: (payload: {
      content: string;
      attachments: Array<{ path: string; name: string; mime?: string }>;
    }) => void;
    switchThread: (threadId: string) => void;
    createThread: () => void;
    deleteThread: (threadId: string) => Promise<void>;
    ensureThread: () => Promise<string | null>;
    createServerThread: () => Promise<string | null>;
    cancelTurn: () => void;
  };
}) {
  const { sendMessage, switchThread, createThread, deleteThread, ensureThread, cancelTurn } = actions;
  const authToken = useAppSelector((state) => state.authToken);
  const connectionState = useAppSelector((state) => state.connectionState);
  const currentChatId = useAppSelector((state) => state.currentChatId);
  const sessions = useAppSelector((state) => state.sessions);
  const currentMessages = useAppSelector((state) => {
    if (!state.currentChatId) {
      return EMPTY_MESSAGES;
    }
    return state.messagesByChat[state.currentChatId] ?? EMPTY_MESSAGES;
  });
  const activeTurn = useAppSelector((state) => {
    if (!state.currentChatId) {
      return null;
    }
    return state.activeTurns[state.currentChatId] ?? null;
  });

  // 稳定 convertMessage / onCancel 的引用,避免 useExternalStoreRuntime 每次渲染都
  // 因为 oldStore.convertMessage !== store.convertMessage 触发 ThreadMessageConverter
  // 缓存清空 + 全量转换 + 广播,从而在 IME 合成期间把 textarea 的 value 强行同步回 DOM,
  // 打断中文输入(英文偶尔能挤进去是因为合成期极短)。
  const currentChatIdRef = useRef(currentChatId);
  const activeTurnRef = useRef(activeTurn);
  useEffect(() => {
    currentChatIdRef.current = currentChatId;
    activeTurnRef.current = activeTurn;
  }, [activeTurn, currentChatId]);

  const convertMessage = useCallback(
    (message: RuntimeMessageSource, index: number) => {
      const chatId = currentChatIdRef.current;
      if (!chatId) {
        throw new Error('缺少当前会话 ID');
      }
      return historyMessageToThreadMessage(
        message,
        chatId,
        index,
        activeTurnRef.current,
      );
    },
    [],
  );

  const handleCancel = useCallback(async () => {
    cancelTurn();
  }, [cancelTurn]);

  const threadSuggestions = useMemo(() => buildThreadSuggestions(), []);
  const activeSession = useMemo(
    () => sessions.find((session) => session.chat_id === currentChatId) ?? null,
    [currentChatId, sessions],
  );
  const sessionsById = useMemo(
    () => new Map(sessions.map((session) => [session.chat_id, session])),
    [sessions],
  );
  const isReadOnlySession = Boolean(activeSession?.read_only);
  const pendingAskUserPrompt = useMemo(
    () => findPendingAskUserPrompt(currentMessages),
    [currentMessages],
  );
  const isRunning = Boolean(activeTurn?.waiting);

  const webuiAttachmentAdapter = useMemo<AttachmentAdapter>(
    () => ({
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
        const authToken = appStore.getState().authToken;
        const chatId = await ensureThread();
        if (!chatId) {
          throw new Error('缺少当前会话，无法上传附件');
        }
        const uploadedFiles = await uploadFiles(chatId, [attachment.file], authToken);
        const uploaded = uploadedFiles[0];
        if (!uploaded) {
          throw new Error('上传结果为空');
        }
        return uploadedToCompleteAttachment(attachment, uploaded);
      },
    }),
    [ensureThread],
  );

  const handleNewMessage = useCallback(async (message: AppendMessage) => {
    const content = extractTextInput(message);
    const uploadedAttachments = extractUploadedAttachments(message);
    const sendContent = messageContentWithSelectedSkill(content, message.runConfig);
    if (!sendContent && !uploadedAttachments.length) {
      showFlash('请输入消息或添加附件');
      return;
    }

    if (appStore.getState().connectionState !== 'connected') {
      showFlash('连接尚未建立，请稍后重试');
      return;
    }
    const chatId = await ensureThread();
    if (!chatId) {
      showFlash('创建会话失败，请稍后重试');
      return;
    }
    const session = appStore.getState().sessions.find((item) => item.chat_id === chatId);
    if (session?.read_only) {
      showFlash('当前会话来自其他渠道，仅支持查看历史');
      return;
    }

    appStore.dispatch({
      type: 'local.user_message',
      chatId,
      content: sendContent,
      media: uploadedAttachments.map(({ url, name, mime }) => ({ url, name, mime })),
    });
    appStore.dispatch({ type: 'local.turn_started', chatId });
    sendMessage({
      content: sendContent,
      attachments: uploadedAttachments.map(({ path, name, mime }) => ({ path, name, mime })),
    });
  }, [ensureThread, sendMessage, showFlash]);

  const threadListAdapter = useMemo(
    () =>
      buildExternalThreadListAdapter(sessions, currentChatId, {
        onSwitchToThread: switchThread,
        onSwitchToNewThread: createThread,
        onDeleteThread: deleteThread,
      }),
    [createThread, currentChatId, deleteThread, sessions, switchThread],
  );

  const externalStoreAdapter = useMemo<ExternalStoreAdapter<RuntimeMessageSource>>(() => ({
    messages: currentMessages,
    isRunning,
    isDisabled:
      (bootstrap.authRequired && !authToken) ||
      connectionState !== 'connected' ||
      isReadOnlySession ||
      Boolean(pendingAskUserPrompt),
    adapters: {
      attachments: webuiAttachmentAdapter,
      threadList: threadListAdapter,
    },
    suggestions: threadSuggestions,
    onNew: handleNewMessage,
    onCancel: handleCancel,
    convertMessage,
  }), [
    convertMessage,
    handleCancel,
    handleNewMessage,
    authToken,
    connectionState,
    currentMessages,
    isReadOnlySession,
    isRunning,
    pendingAskUserPrompt,
    threadListAdapter,
    threadSuggestions,
    webuiAttachmentAdapter,
  ]);

  const runtime = useExternalStoreRuntime<RuntimeMessageSource>(externalStoreAdapter);

  return {
    runtime,
    activeSession,
    sessionsById,
    isReadOnlySession,
    pendingAskUserPrompt,
    activeTurn,
    isRunning,
    sendAppendMessage: handleNewMessage,
  };
}
