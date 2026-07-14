import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "@casework/persistence";
import { ConnectionRegistry } from "../apps/api/src/modules/chat/connection-registry.js";
import {
  ChatBusyError,
  TurnCoordinator,
} from "../apps/api/src/modules/chat/turn-coordinator.js";
import { AccessControl } from "../apps/api/src/modules/auth/access.js";
import { defaultConfig } from "../apps/api/src/modules/config/config.js";

test("PocketBase compatibility fields do not enable an external integration", () => {
  const config = defaultConfig();
  config.channels.webui_plugin.pocketbaseUrl = "http://127.0.0.1:8090";
  const access = new AccessControl(config);
  assert.equal(access.mode, "none");
  assert.equal(access.required, false);
});

test("draft sessions do not appear until their first message", async () => {
  const root = await mkdtemp(join(tmpdir(), "casework-sessions-"));
  const sessions = new SessionStore(root);
  const chatId = sessions.createDraftId();

  assert.equal(await sessions.get(chatId), null);
  assert.deepEqual(await sessions.list(), []);
  assert.deepEqual(await readdir(root), []);

  await sessions.append(chatId, { type: "user", content: "第一条消息" });
  assert.equal((await sessions.get(chatId))?.messages.length, 1);
  assert.equal((await sessions.list()).length, 1);
});

test("connection registry broadcasts and detaches every chat subscriber", () => {
  const registry = new ConnectionRegistry();
  const first = new FakeSocket();
  const second = new FakeSocket();
  registry.subscribe(first, "chat-1");
  registry.subscribe(second, "chat-1");

  registry.broadcast("chat-1", {
    type: "turn.delta",
    chatId: "chat-1",
    delta: "结果",
  });
  assert.equal(first.events[0]?.type, "turn.delta");
  assert.equal(second.events[0]?.type, "turn.delta");
  assert.equal(registry.snapshot().active_connection_count, 2);

  registry.deleteChat("chat-1");
  assert.equal(first.events.at(-1)?.type, "session.deleted");
  assert.equal(second.events.at(-1)?.type, "session.deleted");
  assert.equal(registry.snapshot().active_connection_count, 0);
  assert.equal(registry.isBlocked("chat-1"), true);
});

test("turn coordinator rejects overlapping work for the same chat", async () => {
  const turns = new TurnCoordinator();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const running = turns.run("chat-1", () => gate);

  await assert.rejects(
    turns.run("chat-1", async () => undefined),
    ChatBusyError,
  );
  assert.equal(turns.snapshot().active_turn_count, 1);
  release();
  await running;
  assert.equal(turns.snapshot().active_turn_count, 0);
});

class FakeSocket {
  readonly readyState = 1;
  readonly events: Array<{ type?: string }> = [];

  send(data: string): void {
    this.events.push(JSON.parse(data) as { type?: string });
  }
}
