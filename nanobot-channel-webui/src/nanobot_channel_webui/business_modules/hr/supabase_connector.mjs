import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

export function loadSupabaseConfig() {
  const configPath = process.env.NANOBOT_CONFIG || path.join(process.env.HOME || "", ".nanobot", "config.json");
  const payload = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const webui = payload?.channels?.webui_plugin ?? payload?.channels?.webuiPlugin ?? {};
  const url = clean(webui.hrSupabaseUrl || webui.hr_supabase_url);
  const serviceKey = clean(
    webui.hrSupabaseServiceRoleKey
    || webui.hrSupabaseServiceKey
    || webui.hr_supabase_service_role_key
    || webui.hr_supabase_service_key
  );
  if (!url) throw new Error("channels.webui_plugin.hrSupabaseUrl is missing from ~/.nanobot/config.json");
  if (!serviceKey) throw new Error("channels.webui_plugin.hrSupabaseServiceRoleKey is missing from ~/.nanobot/config.json");
  return { url, serviceKey, source: configPath };
}

export class SupabaseConnector {
  constructor() {
    this._client = null;
    this._config = null;
  }

  get config() {
    if (!this._config) this._config = loadSupabaseConfig();
    return this._config;
  }

  get client() {
    if (!this._client) {
      const { url, serviceKey } = this.config;
      this._client = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      });
    }
    return this._client;
  }

  from(tableName) {
    return this.client.from(tableName);
  }

  schema(schemaName) {
    return this.client.schema(schemaName);
  }

  rpc(functionName, params = {}) {
    return this.client.rpc(functionName, params);
  }
}

export function createSupabaseConnector() {
  return new SupabaseConnector();
}

export function createSupabaseClient() {
  return createSupabaseConnector().client;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
