import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AgentRuntime } from "@casework/agent-runtime";
import type { CaseworkConfig } from "@casework/contracts";
import type { RuntimePaths, SessionStore } from "@casework/persistence";
import {
  AccessError,
  type AccessControl,
  type CurrentUser,
} from "../auth/access.js";
import type { ConnectionRegistry } from "../chat/connection-registry.js";
import type { TurnCoordinator } from "../chat/turn-coordinator.js";
import { jsonObject, text } from "../http/route-utils.js";
import type { SkillManagement } from "../management.js";

export interface SettingsRouteDependencies {
  access: AccessControl;
  config: CaseworkConfig;
  configPath: string;
  paths: RuntimePaths;
  sessions: SessionStore;
  skills: SkillManagement;
  connections: ConnectionRegistry;
  turns: TurnCoordinator;
  agent: AgentRuntime;
}

export function registerSettingsRoutes(
  server: FastifyInstance,
  dependencies: SettingsRouteDependencies,
) {
  const { access, config, configPath, paths, sessions, skills } = dependencies;
  server.get("/api/settings/skills", async (request) => {
    await requireAdmin(access, request);
    return { skills: await skills.list() };
  });
  server.get<{ Params: { name: string } }>(
    "/api/settings/skills/:name",
    async (request, reply) => {
      await requireAdmin(access, request);
      const value = await skills.detail(request.params.name);
      return value ?? reply.code(404).send({ error: "技能不存在" });
    },
  );
  server.get<{ Params: { name: string } }>(
    "/api/settings/skills/:name/file",
    async (request, reply) => {
      await requireAdmin(access, request);
      const value = await skills.file(
        request.params.name,
        text(jsonObject(request.query).path),
      );
      return value ?? reply.code(404).send({ error: "技能文件不存在" });
    },
  );
  server.post<{ Params: { name: string } }>(
    "/api/settings/skills/:name/toggle",
    async (request, reply) => {
      await requireAdmin(access, request);
      const body = jsonObject(request.body);
      if (!("enabled" in body))
        return reply.code(400).send({ error: "缺少 enabled 参数" });
      const value = await skills.toggle(
        request.params.name,
        Boolean(body.enabled),
      );
      return value ?? reply.code(404).send({ error: "技能不存在或不支持开关" });
    },
  );

  server.get("/api/settings/config", async (request) => {
    await requireAdmin(access, request);
    return configSnapshot(config, configPath, paths.workspace);
  });
  server.post("/api/settings/config", async (request, reply) => {
    await requireAdmin(access, request);
    const raw = text(jsonObject(request.body).raw);
    if (!raw) return reply.code(400).send({ error: "配置内容不能为空" });
    const next = JSON.parse(raw) as CaseworkConfig;
    await writeFile(configPath, raw.endsWith("\n") ? raw : `${raw}\n`, "utf8");
    return configSnapshot(next, configPath, paths.workspace);
  });

  server.get("/api/settings/runtime", async (request) => {
    const user = await access.authorize(request);
    const isAdmin = user == null || user.role === "admin";
    const [recentLogs, recentStateFiles, recentPlans] = await Promise.all([
      collectRecent(paths.logs, () => true),
      collectRecent(paths.sessions, (name) => /\.(json|jsonl)$/.test(name)),
      collectRecent(join(paths.workspace, "memory"), (name) =>
        /\.(md|plan)$/.test(name),
      ),
    ]);
    return {
      workspace: isAdmin ? paths.workspace : "",
      session_count: await sessions.count(),
      metrics: {
        connections: dependencies.connections.snapshot(),
        turns: dependencies.turns.snapshot(),
        agent: dependencies.agent.snapshot(),
      },
      live_runtime: {
        channel: {
          name: "webui_plugin",
          streaming_enabled: config.channels.webui_plugin.streaming,
          runtime_attached: true,
          runtime_attach_warned: false,
        },
        runtime: {
          loop_found: true,
          runtime_attached: true,
          hook_count: 1,
          attach_state: {
            is_wrapped: false,
            wrapper_name: "AgentHarness",
            wrap_count: dependencies.agent.snapshot().harness_count,
            hook_registered: true,
          },
        },
        connections: dependencies.connections.snapshot(),
        turns: dependencies.turns.snapshot(),
        agent: dependencies.agent.snapshot(),
      },
      recent_logs: recentLogs,
      recent_state_files: recentStateFiles,
      recent_plans: recentPlans,
      latest_log_preview: await latestLogPreview(recentLogs[0]?.path),
    };
  });
}

async function requireAdmin(
  access: AccessControl,
  request: Parameters<AccessControl["authorize"]>[0],
): Promise<CurrentUser | null> {
  const user = await access.authorize(request);
  if (user && user.role !== "admin")
    throw new AccessError(403, "当前账号无权访问此功能");
  return user;
}

function configSnapshot(
  config: CaseworkConfig,
  configPath: string,
  workspace: string,
) {
  return {
    workspace,
    config_path: configPath,
    config_exists: true,
    raw: `${JSON.stringify(config, null, 2)}\n`,
    sections: Object.keys(config).sort(),
    parsed: config,
    omx_files: [],
  };
}

interface FileMeta {
  name: string;
  path: string;
  updated_at: string;
  size: number;
}

async function collectRecent(
  root: string,
  include: (name: string) => boolean,
): Promise<FileMeta[]> {
  const output: FileMeta[] = [];
  async function walk(path: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const target = join(path, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (include(entry.name)) {
        const info = await stat(target);
        output.push({
          name: basename(target),
          path: target,
          updated_at: info.mtime.toISOString(),
          size: info.size,
        });
      }
    }
  }
  await walk(root);
  return output
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
    .slice(0, 12);
}

async function latestLogPreview(path?: string): Promise<string> {
  if (!path) return "";
  try {
    return (await readFile(path, "utf8")).split("\n").slice(-50).join("\n");
  } catch {
    return "";
  }
}
