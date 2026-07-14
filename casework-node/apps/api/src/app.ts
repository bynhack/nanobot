import { mkdir, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import { AgentRuntime } from "@casework/agent-runtime";
import { CaseAuditService, CaseAuditStorage } from "@casework/case-audit";
import {
  CaseGraphService,
  CaseGraphStorage,
  GraphStateService,
  MySqlCaseGraphQueryClient,
  RelationGraphService,
  RelationGraphStorage,
  UnconfiguredCaseGraphQueryClient,
} from "@casework/case-graph";
import {
  runtimePaths,
  SessionStore,
  WorkspaceService,
} from "@casework/persistence";
import { AccessControl, AccessError } from "./modules/auth/access.js";
import {
  configPath,
  loadConfig,
  runtimeRoot,
} from "./modules/config/config.js";
import { registerCaseAuditRoutes } from "./modules/case-audit/routes.js";
import { registerCaseGraphRoutes } from "./modules/case-graph/routes.js";
import { SkillManagement } from "./modules/management.js";
import { MediaService } from "./modules/media.js";
import { ConnectionRegistry } from "./modules/chat/connection-registry.js";
import { registerChatRoutes } from "./modules/chat/routes.js";
import { TurnCoordinator } from "./modules/chat/turn-coordinator.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { registerMediaRoutes } from "./modules/media/routes.js";
import { registerSessionRoutes } from "./modules/sessions/routes.js";
import { registerSettingsRoutes } from "./modules/settings/routes.js";
import { registerWebRoutes } from "./modules/web/routes.js";

export async function buildServer() {
  const config = await loadConfig();
  const paths = runtimePaths(runtimeRoot, config.agents.defaults.workspace);
  await Promise.all(
    Object.values(paths).map((path) => mkdir(path, { recursive: true })),
  );
  await cp(resolve("skills"), paths.skills, {
    recursive: true,
    force: false,
    errorOnExist: false,
  });
  const sessions = new SessionStore(paths.sessions);
  const access = new AccessControl(config);
  const webui = config.channels.webui_plugin;
  const media = new MediaService(
    webui.mediaSigningSecret || webui.authToken,
    webui.mediaTokenTtlSeconds,
  );
  const server = Fastify({ logger: true, bodyLimit: 8 * 1024 * 1024 });

  await server.register(websocket, {
    options: { maxPayload: 2 * 1024 * 1024 },
  });
  await server.register(multipart, {
    limits: { files: 20, fileSize: 100 * 1024 * 1024 },
  });
  const webDist = resolve("apps/web/dist");
  if (existsSync(webDist)) {
    await server.register(staticPlugin, {
      root: resolve(webDist, "assets"),
      prefix: "/assets/",
      decorateReply: false,
    });
  }

  const query =
    webui.caseGraphDbHost && webui.caseGraphDbUser && webui.caseGraphDbName
      ? new MySqlCaseGraphQueryClient({
          host: webui.caseGraphDbHost,
          port: webui.caseGraphDbPort,
          user: webui.caseGraphDbUser,
          password: webui.caseGraphDbPassword,
          database: webui.caseGraphDbName,
        })
      : new UnconfiguredCaseGraphQueryClient();
  const graphs = new CaseGraphStorage(
    paths.caseGraphs,
    paths.caseGraphContexts,
  );
  const graphState = new GraphStateService(
    paths.caseGraphs,
    paths.caseGraphContexts,
  );
  const graphService = new CaseGraphService(graphs, query);
  const relations = new RelationGraphService(
    query,
    new RelationGraphStorage(paths.caseGraphs),
    graphs,
  );
  const audits = new CaseAuditStorage(paths.caseAudits);
  const auditService = new CaseAuditService(query);
  const agent = new AgentRuntime(config, paths, graphState, query);
  const skills = new SkillManagement(paths.skills);
  const workspaces = new WorkspaceService(paths.chatWorkspaces);
  const connections = new ConnectionRegistry();
  const turns = new TurnCoordinator();
  registerCaseGraphRoutes(server, {
    access,
    graphs,
    graphService,
    graphState,
    relations,
  });
  registerCaseAuditRoutes(server, { access, audits, auditService });
  registerChatRoutes(server, {
    access,
    sessions,
    workspaces,
    agent,
    connections,
    turns,
  });
  registerAuthRoutes(server, access);
  registerSessionRoutes(server, {
    access,
    sessions,
    workspaces,
    connections,
    agent,
  });
  registerMediaRoutes(server, {
    access,
    media,
    uploadsRoot: paths.uploads,
  });
  registerSettingsRoutes(server, {
    access,
    config,
    configPath,
    paths,
    sessions,
    skills,
    connections,
    turns,
    agent,
  });
  if (existsSync(webDist)) {
    registerWebRoutes(server, { access, title: webui.title });
  }

  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof AccessError)
      return reply.code(error.status).send({ error: error.message });
    server.log.error(error);
    return reply.code(500).send({
      error: error instanceof Error ? error.message : "服务器内部错误",
    });
  });

  return {
    server,
    config,
    paths,
    sessions,
    access,
    media,
    graphs,
    graphState,
    graphService,
    relations,
    audits,
    auditService,
    agent,
    workspaces,
    connections,
    turns,
  };
}
