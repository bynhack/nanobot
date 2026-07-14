import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../auth/access.js";

export function registerWebRoutes(
  server: FastifyInstance,
  options: { access: AccessControl; title: string },
) {
  server.get("/", async (_request, reply) => {
    const html = await readFile(resolve("apps/web/dist/index.html"), "utf8");
    const bootstrap = JSON.stringify({
      title: options.title,
      authRequired: options.access.required,
      authMode: options.access.mode,
    });
    return reply
      .type("text/html")
      .send(
        html
          .replace('"__WEBUI_BOOTSTRAP__"', bootstrap)
          .replace(
            "<title>Nanobot</title>",
            `<title>${escapeHtml(options.title)}</title>`,
          ),
      );
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
