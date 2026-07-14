import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MediaItem } from "@casework/contracts";

export interface WorkspaceFile extends MediaItem {
  id: string;
  delivered_at: string;
}

interface ChatWorkspace {
  chat_id: string;
  updated_at: string | null;
  files: WorkspaceFile[];
}

export class WorkspaceService {
  constructor(private readonly root: string) {}
  private path(id: string) {
    return join(
      this.root,
      `${createHash("sha1").update(id).digest("hex")}.json`,
    );
  }
  async load(id: string): Promise<ChatWorkspace> {
    try {
      const x = JSON.parse(
        await readFile(this.path(id), "utf8"),
      ) as Partial<ChatWorkspace>;
      return {
        chat_id: String(x.chat_id || id),
        updated_at: x.updated_at || null,
        files: Array.isArray(x.files) ? x.files : [],
      };
    } catch {
      return { chat_id: id, updated_at: null, files: [] };
    }
  }
  async record(
    id: string,
    media: Array<MediaItem & { delivered_at?: string }>,
  ): Promise<ChatWorkspace> {
    const x = await this.load(id),
      m = new Map(
        x.files.map((file) => [[file.url, file.name].join("\0"), file]),
      ),
      now = new Date().toISOString();
    for (const f of media) {
      if (!f.url || !f.name) continue;
      const digest = createHash("sha1")
        .update(`${f.url}\0${f.name}`)
        .digest("hex")
        .slice(0, 16);
      m.set([f.url, f.name].join("\0"), {
        id: `file_${digest}`,
        name: f.name,
        url: f.url,
        mime: f.mime || "",
        delivered_at: f.delivered_at || now,
      });
    }
    const out = {
      chat_id: id,
      updated_at: now,
      files: [...m.values()].sort((left, right) =>
        right.delivered_at.localeCompare(left.delivered_at),
      ),
    };
    await mkdir(this.root, { recursive: true });
    const tmp = `${this.path(id)}.tmp`;
    await writeFile(tmp, JSON.stringify(out, null, 2));
    await rename(tmp, this.path(id));
    return out;
  }
}
