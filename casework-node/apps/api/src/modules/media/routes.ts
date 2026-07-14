import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../auth/access.js";
import { MediaService, mimeType } from "../media.js";

export function registerMediaRoutes(
  server: FastifyInstance,
  dependencies: {
    access: AccessControl;
    media: MediaService;
    uploadsRoot: string;
  },
) {
  const { access, media, uploadsRoot } = dependencies;
  server.post<{ Params: { chat_id: string } }>(
    "/uploads/:chat_id",
    async (request) => {
      await access.authorize(request);
      const uploadRoot = join(uploadsRoot, safeSegment(request.params.chat_id));
      await mkdir(uploadRoot, { recursive: true });
      const files = [];
      for await (const part of request.files()) {
        const name = basename(part.filename || "file");
        const target = join(uploadRoot, `${Date.now()}-${safeSegment(name)}`);
        await pipeline(part.file, createWriteStream(target));
        files.push({ ...media.item(target), path: target });
      }
      return { files };
    },
  );

  server.get<{ Params: { token: string } }>(
    "/media/:token",
    async (request, reply) => {
      await access.authorize(request);
      const path = await media.resolve(request.params.token);
      if (!path)
        return reply.code(404).send({ error: "文件不存在或链接已失效" });
      return reply.type(mimeType(path)).send(createReadStream(path));
    },
  );
}

function safeSegment(value: string): string {
  return (
    value.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "") ||
    "unknown"
  );
}
