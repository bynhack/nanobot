import type { FastifyRequest } from "fastify";
import type { CaseworkConfig } from "@casework/contracts";

export interface CurrentUser {
  id: string;
  email: string;
  role: "admin" | "user";
  token: string;
}

export class AccessControl {
  constructor(private readonly config: CaseworkConfig) {}

  get mode(): "none" | "token" {
    const webui = this.config.channels.webui_plugin;
    if (webui.authToken.trim()) return "token";
    return "none";
  }

  get required(): boolean {
    return this.mode !== "none";
  }

  async authorize(request: FastifyRequest): Promise<CurrentUser | null> {
    const token = bearerToken(request) || queryToken(request);
    if (this.mode === "none") return null;
    if (this.mode === "token") {
      if (token && token === this.config.channels.webui_plugin.authToken) {
        return { id: "local-admin", email: "", role: "admin", token };
      }
      throw new AccessError(401, "认证失败");
    }
    throw new AccessError(401, "认证失败");
  }

  async login(_identity: string, _password: string): Promise<CurrentUser> {
    throw new AccessError(404, "当前版本未接入账号登录");
  }
}

export class AccessError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function bearerToken(request: FastifyRequest): string {
  const value = request.headers.authorization || "";
  return value.toLowerCase().startsWith("bearer ")
    ? value.slice(7).trim()
    : value.trim();
}

function queryToken(request: FastifyRequest): string {
  const query = record(request.query);
  return typeof query.auth_token === "string" ? query.auth_token.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
