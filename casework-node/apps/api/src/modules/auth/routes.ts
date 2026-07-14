import type { FastifyInstance } from "fastify";
import type { AccessControl, CurrentUser } from "./access.js";
import { jsonObject, text } from "../http/route-utils.js";

export function registerAuthRoutes(
  server: FastifyInstance,
  access: AccessControl,
) {
  server.post("/api/auth/login", async (request, reply) => {
    const body = jsonObject(request.body);
    const identity = text(body.identity);
    const password = text(body.password);
    if (!identity || !password)
      return reply.code(400).send({ error: "邮箱和密码不能为空" });
    const user = await access.login(identity, password);
    return { token: user.token, user: publicUser(user) };
  });
  server.post("/api/auth/logout", async () => ({ ok: true }));
  server.get("/api/auth/me", async (request) => {
    const user = await access.authorize(request);
    return { token: user?.token || "", user: user ? publicUser(user) : null };
  });
}

function publicUser(user: CurrentUser) {
  return { id: user.id, email: user.email, role: user.role };
}
