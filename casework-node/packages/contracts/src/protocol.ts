export type TurnPhase =
  | "idle"
  | "streaming"
  | "running_tools"
  | "finalizing"
  | "completed";

export interface ClientAttachment {
  path: string;
  name: string;
  mime: string;
}

export type ClientCommand =
  | { type: "message.send"; content: string; attachments?: ClientAttachment[] }
  | { type: "message.cancel" }
  | { type: "session.new" }
  | { type: "session.switch"; chatId: string };

export interface MediaItem {
  url: string;
  name: string;
  mime?: string;
}

export interface ToolCallStart {
  name: string;
  args: Record<string, unknown>;
  hint: string;
}

export interface ToolCallResult {
  name: string;
  status: "ok" | "error";
  detail: string;
}

export type HistoryMessage =
  | { id?: string; type: "user"; content: string; media?: MediaItem[] }
  | { id?: string; type: "assistant"; content: string; buttons?: string[][] }
  | {
      id?: string;
      type: "tools";
      tools: Array<{
        name: string;
        args: Record<string, unknown>;
        result: string;
        status: "ok" | "error";
      }>;
    }
  | { id?: string; type: "outbound"; content: string; media: MediaItem[] };

export type ServerEvent =
  | { type: "session.init"; chatId: string; sessionId: string }
  | { type: "session.history"; chatId: string; messages: HistoryMessage[] }
  | { type: "session.deleted"; chatId: string }
  | {
      type: "turn.phase";
      chatId: string;
      phase: TurnPhase;
      streamId?: string;
      resuming?: boolean;
    }
  | { type: "turn.delta"; chatId: string; delta: string; streamId?: string }
  | { type: "tools.started"; chatId: string; tools: ToolCallStart[] }
  | {
      type: "tools.finished";
      chatId: string;
      durationMs: number;
      results: ToolCallResult[];
    }
  | {
      type: "turn.completed";
      chatId: string;
      content?: string;
      media?: MediaItem[];
      buttons?: string[][];
      streamId?: string;
    }
  | { type: "error"; code: string; message: string; chatId?: string };

export function parseClientCommand(raw: string): ClientCommand | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "message.cancel" || value.type === "session.new")
    return { type: value.type };
  if (value.type === "session.switch") {
    const chatId = text(value.chatId);
    return chatId ? { type: "session.switch", chatId } : null;
  }
  if (value.type !== "message.send") return null;
  const content = text(value.content);
  const attachments: ClientAttachment[] = [];
  if (value.attachments !== undefined) {
    if (!Array.isArray(value.attachments)) return null;
    for (const item of value.attachments) {
      if (!isRecord(item)) return null;
      const path = text(item.path);
      if (!path) return null;
      attachments.push({ path, name: text(item.name), mime: text(item.mime) });
    }
  }
  if (!content && attachments.length === 0) return null;
  return attachments.length
    ? { type: "message.send", content, attachments }
    : { type: "message.send", content };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string"
    ? value.trim()
    : value == null
      ? ""
      : String(value).trim();
}
