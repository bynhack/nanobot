import { mkdir, readFile, readdir, rename, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export class SkillManagement {
  constructor(private readonly root: string) {}
  async list() {
    await mkdir(this.root, { recursive: true });
    const names = await readdir(this.root);
    const out: SkillSummary[] = [];
    for (const name of names.sort()) {
      const dir = join(this.root, name);
      if (!(await stat(dir)).isDirectory()) continue;
      const enabled = join(dir, "SKILL.md"),
        disabled = join(dir, "SKILL.disabled.md");
      let path = "",
        on = false;
      try {
        await stat(enabled);
        path = enabled;
        on = true;
      } catch {
        try {
          await stat(disabled);
          path = disabled;
        } catch {
          continue;
        }
      }
      const text = await safeRead(path, 120000),
        info = await stat(path);
      out.push({
        name,
        source: "workspace",
        path,
        updated_at: info.mtime.toISOString(),
        description: description(text),
        enabled: on,
        can_toggle: true,
      });
    }
    return out;
  }
  async detail(name: string) {
    const item = (await this.list()).find((x) => x.name === name);
    if (!item) return null;
    const root = dirname(item.path),
      files: SkillFileMeta[] = [];
    for (const path of await walk(root)) {
      const s = await stat(path);
      files.push({
        path,
        relative_path: relative(root, path),
        name: basename(path),
        size: s.size,
      });
    }
    return { ...item, files };
  }
  async file(name: string, filePath: string) {
    const d = await this.detail(name);
    if (!d) return null;
    const root = resolve(dirname(d.path)),
      path = resolve(
        filePath.startsWith("/") ? filePath : join(root, filePath),
      );
    if (path !== join(root, "SKILL.md") && !path.startsWith(root + sep))
      return null;
    try {
      return {
        name: basename(path),
        path,
        content: await safeRead(path, 500000),
        is_markdown: [".md", ".markdown"].some((x) =>
          path.toLowerCase().endsWith(x),
        ),
      };
    } catch {
      return null;
    }
  }
  async toggle(name: string, enabled: boolean) {
    const d = await this.detail(name);
    if (!d) return null;
    const root = dirname(d.path),
      on = join(root, "SKILL.md"),
      off = join(root, "SKILL.disabled.md");
    if (enabled && !d.enabled) await rename(off, on);
    if (!enabled && d.enabled) await rename(on, off);
    return this.detail(name);
  }
}
async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(root, { withFileTypes: true })) {
    const p = join(root, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out.sort();
}
async function safeRead(path: string, limit: number) {
  return (await readFile(path, "utf8")).slice(0, limit);
}
function description(s: string) {
  const fm = s.match(/^---\n([\s\S]*?)\n---\n?/),
    m = (fm?.[1] ?? "").match(/^description:\s*(.*)$/m);
  if (m) return (m[1] ?? "").trim().replace(/^['"]|['"]$/g, "");
  const body = (fm ? s.slice((fm[0] ?? "").length) : s).trim();
  return text(body.split("\n").find((x) => x.trim()) || "")
    .replace(/^#+\s*/, "")
    .slice(0, 160);
}
function text(v: unknown) {
  return v == null ? "" : String(v).trim();
}

interface SkillSummary {
  name: string;
  source: "workspace";
  path: string;
  updated_at: string;
  description: string;
  enabled: boolean;
  can_toggle: true;
}

interface SkillFileMeta {
  path: string;
  relative_path: string;
  name: string;
  size: number;
}
