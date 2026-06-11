import { ensureOk } from './api';
import { STORAGE_KEYS } from './store';
import type { ServerEvent } from './types';

interface WebSocketClientOptions {
  getAuthToken: () => string;
  onEvent: (event: ServerEvent) => void;
  onConnectionState: (state: 'connecting' | 'connected' | 'disconnected') => void;
  upstreamBootstrapUrl: string;
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
      debugWebSocket('open', { url });
      this.options.onConnectionState('connected');
    });
    this.socket.addEventListener('close', () => {
      debugWebSocket('close', {});
      this.options.onConnectionState('disconnected');
      this.socket = null;
      if (this.shouldReconnect) {
        this.reconnectTimer = window.setTimeout(() => this.connect(), 2000);
      }
    });
    this.socket.addEventListener('error', () => {
      debugWebSocket('error', {});
      this.socket?.close();
    });
    this.socket.addEventListener('message', ({ data }) => {
      try {
        const parsed = JSON.parse(String(data)) as ServerEvent;
        debugWebSocket('message', parsed);
        this.options.onEvent(parsed);
      } catch {
        // Ignore malformed payloads.
      }
    });
  }

  private async resolveSocketUrl(): Promise<string> {
    const response = await fetch(this.options.upstreamBootstrapUrl, {
      headers: this.options.getAuthToken()
        ? { Authorization: `Bearer ${this.options.getAuthToken()}` }
        : {},
    });
    await ensureOk(response, `上游 WebSocket 初始化失败（${response.status}）`);
    const boot = (await response.json()) as { token?: string; ws_url?: string; ws_path?: string };
    const rawUrl = boot.ws_url || `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${boot.ws_path || '/'}`;
    const url = new URL(rawUrl, window.location.href);
    if (url.protocol === 'http:') {
      url.protocol = 'ws:';
    }
    if (url.protocol === 'https:') {
      url.protocol = 'wss:';
    }
    if (boot.token) {
      url.searchParams.set('token', boot.token);
    }
    const authToken = this.options.getAuthToken();
    if (authToken && url.host === window.location.host) {
      url.searchParams.set('webui_token', authToken);
    }
    url.searchParams.set('client_id', 'nanobot-channel-webui');
    return url.toString();
  }

  send(command: Record<string, unknown>): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      debugWebSocket('send_failed', command);
      return false;
    }
    try {
      debugWebSocket('send', command);
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

function debugWebSocket(event: string, payload: unknown): void {
  if (
    typeof window === 'undefined'
    || (
      window.localStorage.getItem(STORAGE_KEYS.debugState) !== 'true'
      && new URLSearchParams(window.location.search).get('debug_state') !== '1'
    )
  ) {
    return;
  }
  console.debug('[nanobot-debug] websocket', { event, payload });
}
