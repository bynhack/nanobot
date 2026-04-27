import type { InteractiveCommand, ServerEvent } from './types';

interface WebSocketClientOptions {
  getAuthToken: () => string;
  getChatId: () => string | null;
  onEvent: (event: ServerEvent) => void;
  onConnectionState: (state: 'connecting' | 'connected' | 'disconnected') => void;
}

export class WebSocketClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private shouldReconnect = true;
  private readonly options: WebSocketClientOptions;

  constructor(options: WebSocketClientOptions) {
    this.options = options;
  }

  connect(): void {
    this.disposeTimer();
    this.shouldReconnect = true;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.options.onConnectionState('connecting');

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = new URL(`${proto}://${window.location.host}/ws`);
    const chatId = this.options.getChatId();
    const token = this.options.getAuthToken();
    if (chatId) {
      url.searchParams.set('chat_id', chatId);
    }
    if (token) {
      url.searchParams.set('auth_token', token);
    }

    this.socket = new WebSocket(url);
    this.socket.addEventListener('open', () => {
      this.options.onConnectionState('connected');
    });
    this.socket.addEventListener('close', () => {
      this.options.onConnectionState('disconnected');
      this.socket = null;
      if (this.shouldReconnect) {
        this.reconnectTimer = window.setTimeout(() => this.connect(), 2000);
      }
    });
    this.socket.addEventListener('error', () => {
      this.socket?.close();
    });
    this.socket.addEventListener('message', ({ data }) => {
      try {
        const parsed = JSON.parse(String(data)) as ServerEvent;
        this.options.onEvent(parsed);
      } catch {
        // Ignore malformed payloads.
      }
    });
  }

  send(command: Record<string, unknown> | InteractiveCommand): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      this.socket.send(JSON.stringify(command));
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.disposeTimer();
    this.shouldReconnect = false;
    this.socket?.close();
    this.socket = null;
  }

  private disposeTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
