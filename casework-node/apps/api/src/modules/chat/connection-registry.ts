import type { ServerEvent } from "@casework/contracts";

export interface EventSocket {
  readonly readyState: number;
  send(data: string): void;
}

export class ConnectionRegistry {
  private readonly chatConnections = new Map<string, Set<EventSocket>>();
  private readonly socketChats = new Map<EventSocket, string>();
  private readonly blockedChats = new Set<string>();

  subscribe(socket: EventSocket, chatId: string): void {
    this.unsubscribe(socket);
    const connections = this.chatConnections.get(chatId) ?? new Set();
    connections.add(socket);
    this.chatConnections.set(chatId, connections);
    this.socketChats.set(socket, chatId);
  }

  unsubscribe(socket: EventSocket): void {
    const chatId = this.socketChats.get(socket);
    if (!chatId) return;
    this.socketChats.delete(socket);
    const connections = this.chatConnections.get(chatId);
    connections?.delete(socket);
    if (!connections?.size) this.chatConnections.delete(chatId);
  }

  markActive(chatId: string): void {
    this.blockedChats.delete(chatId);
  }

  isBlocked(chatId: string): boolean {
    return this.blockedChats.has(chatId);
  }

  send(socket: EventSocket, event: ServerEvent): boolean {
    if (socket.readyState !== 1) {
      this.unsubscribe(socket);
      return false;
    }
    try {
      socket.send(JSON.stringify(event));
      return true;
    } catch {
      this.unsubscribe(socket);
      return false;
    }
  }

  broadcast(chatId: string, event: ServerEvent): void {
    if (this.blockedChats.has(chatId)) return;
    for (const socket of this.chatConnections.get(chatId) ?? [])
      this.send(socket, event);
  }

  deleteChat(chatId: string): void {
    this.blockedChats.add(chatId);
    const event: ServerEvent = { type: "session.deleted", chatId };
    for (const socket of [...(this.chatConnections.get(chatId) ?? [])]) {
      this.send(socket, event);
      this.unsubscribe(socket);
    }
  }

  snapshot() {
    const chatConnections = Object.fromEntries(
      [...this.chatConnections]
        .filter(([, sockets]) => sockets.size > 0)
        .map(([chatId, sockets]) => [chatId, sockets.size]),
    );
    return {
      active_chat_count: Object.keys(chatConnections).length,
      active_connection_count: this.socketChats.size,
      blocked_chat_count: this.blockedChats.size,
      chat_connections: chatConnections,
    };
  }
}
