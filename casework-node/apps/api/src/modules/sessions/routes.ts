import type { FastifyInstance } from "fastify";
import type { SessionStore, WorkspaceService } from "@casework/persistence";
import type { AccessControl } from "../auth/access.js";
import type { ConnectionRegistry } from "../chat/connection-registry.js";
import type { AgentRuntime } from "@casework/agent-runtime";

export function registerSessionRoutes(
  server: FastifyInstance,
  dependencies: {
    access: AccessControl;
    sessions: SessionStore;
    workspaces: WorkspaceService;
    connections: ConnectionRegistry;
    agent: AgentRuntime;
  },
) {
  const { access, sessions, workspaces, connections, agent } = dependencies;
  server.get("/sessions", async (request) => {
    await access.authorize(request);
    return sessions.list();
  });

  server.get<{ Params: { chat_id: string } }>(
    "/api/workspaces/:chat_id",
    async (request, reply) => {
      await access.authorize(request);
      const workspace = await workspaces.load(request.params.chat_id);
      return { ...workspace, file_count: workspace.files.length };
    },
  );

  server.delete<{ Params: { chat_id: string } }>(
    "/sessions/:chat_id",
    async (request, reply) => {
      await access.authorize(request);
      const session = await sessions.get(request.params.chat_id);
      if (!session)
        return reply.code(404).send({ error: "会话不存在或无权删除" });
      connections.deleteChat(request.params.chat_id);
      await agent.abort(request.params.chat_id);
      if (!(await sessions.delete(request.params.chat_id)))
        return reply.code(404).send({ error: "会话不存在" });
      return { ok: true };
    },
  );
}
