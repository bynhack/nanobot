import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { CaseworkConfig } from "@casework/contracts";

export type { CaseworkConfig } from "@casework/contracts";

export const runtimeRoot = resolve(
  process.env.CASEWORK_ROOT || join(homedir(), ".casework-node"),
);
export const configPath = resolve(
  process.env.CASEWORK_CONFIG || join(runtimeRoot, "config.json"),
);

export function defaultConfig(): CaseworkConfig {
  return {
    agents: {
      defaults: {
        model: "gpt-5.4-mini",
        provider: "custom",
        timezone: "Asia/Shanghai",
        workspace: join(runtimeRoot, "workspace"),
      },
    },
    providers: { custom: { apiKey: "", apiBase: "" } },
    channels: {
      webui_plugin: {
        enabled: true,
        host: "127.0.0.1",
        port: 8081,
        title: "资金流分析工作台",
        authToken: "",
        mediaSigningSecret: "",
        mediaTokenTtlSeconds: 3600,
        streaming: true,
        pocketbaseUrl: "",
        pocketbaseUsersCollection: "users",
        pocketbaseSessionsCollection: "chat_sessions",
        caseGraphDbHost: "",
        caseGraphDbPort: 3306,
        caseGraphDbUser: "",
        caseGraphDbPassword: "",
        caseGraphDbName: "",
      },
    },
  };
}

export async function loadConfig(): Promise<CaseworkConfig> {
  await mkdir(runtimeRoot, { recursive: true });
  try {
    const parsed = JSON.parse(
      await readFile(configPath, "utf8"),
    ) as Partial<CaseworkConfig>;
    return mergeConfig(defaultConfig(), parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const config = defaultConfig();
    await saveConfig(config);
    return config;
  }
}

export async function saveConfig(config: CaseworkConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function mergeConfig(
  base: CaseworkConfig,
  incoming: Partial<CaseworkConfig>,
): CaseworkConfig {
  const defaults = incoming.agents?.defaults;
  return {
    ...base,
    ...incoming,
    agents: { defaults: { ...base.agents.defaults, ...defaults } },
    providers: { ...base.providers, ...(incoming.providers ?? {}) },
    channels: {
      ...base.channels,
      ...(incoming.channels ?? {}),
      webui_plugin: {
        ...base.channels.webui_plugin,
        ...(incoming.channels?.webui_plugin ?? {}),
      },
    },
  };
}
