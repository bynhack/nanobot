import type { ServerEvent } from './types';

interface WebSocketClientOptions {
  getAuthToken: () => string;
  getChatId: () => string | null;
  onEvent: (event: ServerEvent) => void;
  onConnectionState: (state: 'connecting' | 'connected' | 'disconnected') => void;
  upstreamBootstrapUrl?: string;
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

    void this.openSocket();
  }

  private async openSocket(): Promise<void> {
    const url = await this.resolveSocketUrl();
    if (!this.shouldReconnect) {
      return;
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

  private async resolveSocketUrl(): Promise<string> {
    if (this.options.upstreamBootstrapUrl) {
      const response = await fetch(this.options.upstreamBootstrapUrl, {
        headers: this.options.getAuthToken()
          ? { Authorization: `Bearer ${this.options.getAuthToken()}` }
          : {},
      });
      if (!response.ok) {
        throw new Error(`上游 WebSocket 初始化失败（${response.status}）`);
      }
      const boot = (await response.json()) as { token?: string; ws_url?: string; ws_path?: string };
      const rawUrl = boot.ws_url || `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${boot.ws_path || '/'}`;
      const url = new URL(rawUrl);
      if (boot.token) {
        url.searchParams.set('token', boot.token);
      }
      url.searchParams.set('client_id', 'nanobot-channel-webui');
      return url.toString();
    }

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
    return url.toString();
  }

  send(command: Record<string, unknown>): boolean {
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
