import type { FastifyInstance } from "fastify";
import type { AgentRuntime } from "@casework/agent-runtime";
import type {
  ClientAttachment,
  HistoryMessage,
  ServerEvent,
} from "@casework/contracts";
import type { SessionStore, WorkspaceService } from "@casework/persistence";
import type { AccessControl } from "../auth/access.js";
import { jsonObject, text } from "../http/route-utils.js";
import { ConnectionRegistry, type EventSocket } from "./connection-registry.js";
import { ChatBusyError, TurnCoordinator } from "./turn-coordinator.js";
import { parseClientCommand } from "@casework/contracts";

export interface ChatRouteDependencies {
  access: AccessControl;
  sessions: SessionStore;
  workspaces: WorkspaceService;
  agent: AgentRuntime;
  connections: ConnectionRegistry;
  turns: TurnCoordinator;
}

export function registerChatRoutes(
  server: FastifyInstance,
  dependencies: ChatRouteDependencies,
) {
  server.get("/ws", { websocket: true }, (rawSocket, request) => {
    const socket = rawSocket as EventSocket & {
      on(event: "message" | "close", listener: (value: Buffer) => void): void;
    };
    let chatId: string | null = null;
    const direct = (event: ServerEvent) =>
      dependencies.connections.send(socket, event);
    const ready = initialize();

    async function initialize() {
      await dependencies.access.authorize(request);
      const requested = text(jsonObject(request.query).chat_id);
      const session = requested
        ? await dependencies.sessions.get(requested)
        : null;
      if (session) {
        chatId = session.chat_id;
        dependencies.connections.markActive(chatId);
        dependencies.connections.subscribe(socket, chatId);
        direct(sessionInit(chatId));
        direct({
          type: "session.history",
          chatId,
          messages: session.messages,
        });
      } else if (requested) {
        direct({ type: "session.deleted", chatId: requested });
      }
    }

    function createActiveChat(): string {
      chatId = dependencies.sessions.createDraftId();
      dependencies.connections.markActive(chatId);
      dependencies.connections.subscribe(socket, chatId);
      direct(sessionInit(chatId));
      return chatId;
    }

    void ready.catch((error) => {
      direct({
        type: "error",
        code: "unauthorized",
        message: error instanceof Error ? error.message : "认证失败",
      });
      rawSocket.close(1008);
    });

    socket.on("message", (raw) => {
      void handleMessage(raw).catch((error) => {
        const event: ServerEvent = {
          type: "error",
          code: error instanceof ChatBusyError ? "chat_busy" : "internal_error",
          message: error instanceof Error ? error.message : "处理消息失败",
          ...(chatId ? { chatId } : {}),
        };
        if (chatId && !(error instanceof ChatBusyError)) {
          dependencies.connections.broadcast(chatId, event);
          dependencies.connections.broadcast(chatId, {
            type: "turn.phase",
            chatId,
            phase: "completed",
          });
        } else direct(event);
      });
    });
    socket.on("close", () => dependencies.connections.unsubscribe(socket));

    async function handleMessage(raw: Buffer) {
      await ready;
      const command = parseClientCommand(raw.toString());
      if (!command)
        return direct({
          type: "error",
          code: "bad_request",
          message: "无效的消息格式",
          ...(chatId ? { chatId } : {}),
        });

      if (command.type === "session.new") {
        createActiveChat();
        return;
      }
      if (command.type === "session.switch") {
        const target = await dependencies.sessions.get(command.chatId);
        if (!target)
          return direct({
            type: "error",
            code: "not_found",
            message: "会话不存在",
            chatId: command.chatId,
          });
        chatId = target.chat_id;
        dependencies.connections.markActive(chatId);
        dependencies.connections.subscribe(socket, chatId);
        direct(sessionInit(chatId));
        direct({
          type: "session.history",
          chatId,
          messages: target.messages,
        });
        return;
      }

      if (command.type === "message.cancel") {
        if (!chatId)
          return direct({
            type: "error",
            code: "read_only_session",
            message: "当前没有可停止的会话",
          });
        await dependencies.agent.abort(chatId);
        dependencies.connections.broadcast(chatId, {
          type: "turn.phase",
          chatId,
          phase: "completed",
        });
        return;
      }

      const activeChatId = chatId ?? createActiveChat();
      await dependencies.turns.run(activeChatId, async () => {
        const userMedia = command.attachments?.map((item) => ({
          url: item.path,
          name: item.name,
          mime: item.mime,
        }));
        await dependencies.sessions.append(
          activeChatId,
          userMedia?.length
            ? { type: "user", content: command.content, media: userMedia }
            : { type: "user", content: command.content },
        );
        const emit = (event: ServerEvent) =>
          dependencies.connections.broadcast(activeChatId, event);
        emit({ type: "turn.phase", chatId: activeChatId, phase: "streaming" });
        const tools: Extract<HistoryMessage, { type: "tools" }>["tools"] = [];
        const startedAt = new Map<string, number>();
        const response = await dependencies.agent.prompt(
          activeChatId,
          attachmentPrompt(command.content, command.attachments),
          {
            delta: (delta) =>
              emit({ type: "turn.delta", chatId: activeChatId, delta }),
            toolStart: (name, args) => {
              startedAt.set(name, Date.now());
              tools.push({ name, args, result: "", status: "ok" });
              emit({
                type: "turn.phase",
                chatId: activeChatId,
                phase: "running_tools",
              });
              emit({
                type: "tools.started",
                chatId: activeChatId,
                tools: [{ name, args, hint: toolHint(name) }],
              });
            },
            toolEnd: (name, status, detail) => {
              const tool = [...tools]
                .reverse()
                .find((item) => item.name === name);
              if (tool) {
                tool.result = detail;
                tool.status = status === "error" ? "error" : "ok";
              }
              emit({
                type: "tools.finished",
                chatId: activeChatId,
                durationMs: Date.now() - (startedAt.get(name) ?? Date.now()),
                results: [
                  {
                    name,
                    status: status === "error" ? "error" : "ok",
                    detail,
                  },
                ],
              });
              emit({
                type: "turn.phase",
                chatId: activeChatId,
                phase: "streaming",
              });
            },
          },
        );
        if (tools.length)
          await dependencies.sessions.append(activeChatId, {
            type: "tools",
            tools,
          });
        if (response.content || response.buttons?.length)
          await dependencies.sessions.append(activeChatId, {
            type: "assistant",
            content: response.content,
            ...(response.buttons ? { buttons: response.buttons } : {}),
          });
        if (response.media.length) {
          await dependencies.sessions.append(activeChatId, {
            type: "outbound",
            content: "",
            media: response.media,
          });
          await dependencies.workspaces.record(activeChatId, response.media);
        }
        emit({
          type: "turn.completed",
          chatId: activeChatId,
          content: response.content,
          ...(response.media.length ? { media: response.media } : {}),
          ...(response.buttons ? { buttons: response.buttons } : {}),
        });
        emit({ type: "turn.phase", chatId: activeChatId, phase: "completed" });
      });
    }
  });
}

function sessionInit(chatId: string): ServerEvent {
  return { type: "session.init", chatId, sessionId: chatId.slice(0, 8) };
}

function attachmentPrompt(
  content: string,
  attachments?: ClientAttachment[],
): string {
  const lines =
    attachments?.map(
      (item) =>
        `附件：${item.name || "文件"}（${item.mime || "未知类型"}），本地路径 ${item.path}`,
    ) ?? [];
  return [content, ...lines].filter(Boolean).join("\n\n");
}

function toolHint(name: string): string {
  return (
    {
      read_case_graph_context: "正在读取图谱事实",
      build_case_graph_action: "正在生成图谱操作",
      query_case_funds: "正在查询资金流水",
      ask_user: "正在等待用户确认",
    }[name] || `正在执行 ${name}`
  );
}
