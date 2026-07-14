import { mkdir, readFile, cp } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import { loadConfig, configPath, runtimeRoot, type CaseworkConfig } from '../config/config.js';
import { AccessControl, AccessError, type CurrentUser } from '../auth/access.js';
import { runtimePaths } from '../persistence/paths.js';
import { SessionStore } from '../persistence/session-store.js';
import { MediaService, mimeType } from '../services/media.js';
import { parseClientCommand, type ServerEvent } from '../contracts/protocol.js';
import { CaseGraphStorage } from '../case-graph/case-graph-storage.js';
import { GraphStateService } from '../case-graph/graph-state-service.js';
import { RelationGraphStorage } from '../case-graph/relation-storage.js';
import { RelationGraphService } from '../case-graph/relation-service.js';
import { CaseGraphService } from '../case-graph/case-graph-service.js';
import { MySqlCaseGraphQueryClient } from '../case-graph/mysql-client.js';
import { UnconfiguredCaseGraphQueryClient } from '../case-graph/query-client.js';
import { CaseAuditStorage } from '../case-audit/storage.js';
import { CaseAuditService } from '../case-audit/service.js';
import { registerBusinessRoutes } from './business-routes.js';
import { SkillManagement } from '../services/management.js';
import { WorkspaceService } from '../services/workspace.js';
import { AgentRuntime } from '../agent/runtime.js';

export async function buildServer() {
  const config = await loadConfig();
  const paths = runtimePaths(runtimeRoot, config.agents.defaults.workspace);
  await Promise.all(Object.values(paths).map((path) => mkdir(path, { recursive: true })));
  await cp(resolve('skills'), paths.skills, { recursive: true, force: false, errorOnExist: false });
  const sessions = new SessionStore(paths.sessions);
  const access = new AccessControl(config);
  const webui = config.channels.webui_plugin;
  const media = new MediaService(webui.mediaSigningSecret || webui.authToken, webui.mediaTokenTtlSeconds);
  const server = Fastify({ logger: true, bodyLimit: 8 * 1024 * 1024 });

  await server.register(websocket, { options: { maxPayload: 2 * 1024 * 1024 } });
  await server.register(multipart, { limits: { files: 20, fileSize: 100 * 1024 * 1024 } });
  await server.register(staticPlugin, { root: resolve('static/assets'), prefix: '/assets/', decorateReply: false });

  const query = webui.caseGraphDbHost && webui.caseGraphDbUser && webui.caseGraphDbName
    ? new MySqlCaseGraphQueryClient({ host: webui.caseGraphDbHost, port: webui.caseGraphDbPort, user: webui.caseGraphDbUser, password: webui.caseGraphDbPassword, database: webui.caseGraphDbName })
    : new UnconfiguredCaseGraphQueryClient();
  const graphs = new CaseGraphStorage(paths.caseGraphs, paths.caseGraphContexts);
  const graphState = new GraphStateService(paths.caseGraphs, paths.caseGraphContexts);
  const graphService = new CaseGraphService(graphs, query);
  const relations = new RelationGraphService(query, new RelationGraphStorage(paths.caseGraphs), graphs);
  const audits = new CaseAuditStorage(paths.caseAudits);
  const auditService = new CaseAuditService(query);
  const agent = new AgentRuntime(config, paths, graphState, query);
  const skills = new SkillManagement(paths.skills);
  const workspaces = new WorkspaceService(paths.chatWorkspaces);
  registerBusinessRoutes(server, { access, graphs, graphService, graphState, relations, audits, auditService });

  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof AccessError) return reply.code(error.status).send({ error: error.message });
    server.log.error(error);
    return reply.code(500).send({ error: error instanceof Error ? error.message : '服务器内部错误' });
  });

  server.get('/', async (_request, reply) => {
    const html = await readFile(resolve('static/index.html'), 'utf8');
    const bootstrap = JSON.stringify({ title: webui.title, authRequired: access.required, authMode: access.mode });
    return reply.type('text/html').send(html.replace('"__WEBUI_BOOTSTRAP__"', bootstrap).replace('<title>Nanobot</title>', `<title>${escapeHtml(webui.title)}</title>`));
  });

  server.post('/api/auth/login', async (request, reply) => {
    const body = record(request.body);
    const identity = text(body.identity);
    const password = text(body.password);
    if (!identity || !password) return reply.code(400).send({ error: '邮箱和密码不能为空' });
    const user = await access.login(identity, password);
    return { token: user.token, user: publicUser(user) };
  });
  server.post('/api/auth/logout', async () => ({ ok: true }));
  server.get('/api/auth/me', async (request) => {
    const user = await access.authorize(request);
    return { token: user?.token || '', user: user ? publicUser(user) : null };
  });

  server.get('/sessions', async (request) => {
    const user = await access.authorize(request);
    return sessions.list(access.mode === 'pocketbase' ? user?.id : '');
  });

  server.get<{ Params: { chat_id: string } }>('/api/workspaces/:chat_id', async (request, reply) => {
    const user = await access.authorize(request);
    const session = await sessions.get(request.params.chat_id);
    if (access.mode === 'pocketbase' && (!session || session.owner_id !== user?.id)) return reply.code(404).send({ error: '无权访问此会话' });
    const workspace = await workspaces.load(request.params.chat_id);
    return { ...workspace, file_count: workspace.files.length };
  });

  server.get('/api/settings/skills', async (request) => { await requireAdmin(access, request); return { skills: await skills.list() }; });
  server.get<{ Params: { name: string } }>('/api/settings/skills/:name', async (request, reply) => { await requireAdmin(access, request); const value = await skills.detail(request.params.name); return value ?? reply.code(404).send({ error: '技能不存在' }); });
  server.get<{ Params: { name: string } }>('/api/settings/skills/:name/file', async (request, reply) => { await requireAdmin(access, request); const value = await skills.file(request.params.name, text(record(request.query).path)); return value ?? reply.code(404).send({ error: '技能文件不存在' }); });
  server.post<{ Params: { name: string } }>('/api/settings/skills/:name/toggle', async (request, reply) => { await requireAdmin(access, request); const body = record(request.body); if (!('enabled' in body)) return reply.code(400).send({ error: '缺少 enabled 参数' }); const value = await skills.toggle(request.params.name, Boolean(body.enabled)); return value ?? reply.code(404).send({ error: '技能不存在或不支持开关' }); });
  server.delete<{ Params: { chat_id: string } }>('/sessions/:chat_id', async (request, reply) => {
    const user = await access.authorize(request);
    const session = await sessions.get(request.params.chat_id);
    if (!session || (access.mode === 'pocketbase' && session.owner_id !== user?.id)) return reply.code(404).send({ error: '会话不存在或无权删除' });
    return await sessions.delete(request.params.chat_id) ? { ok: true } : reply.code(404).send({ error: '会话不存在' });
  });

  server.post<{ Params: { chat_id: string } }>('/uploads/:chat_id', async (request) => {
    const user = await access.authorize(request);
    const session = await sessions.get(request.params.chat_id);
    if (access.mode === 'pocketbase' && (!session || session.owner_id !== user?.id)) throw new AccessError(404, '无权访问此会话');
    const uploadRoot = join(paths.uploads, safeSegment(request.params.chat_id));
    await mkdir(uploadRoot, { recursive: true });
    const files = [];
    for await (const part of request.files()) {
      const name = basename(part.filename || 'file');
      const target = join(uploadRoot, `${Date.now()}-${safeSegment(name)}`);
      await pipeline(part.file, createWriteStream(target));
      files.push({ ...media.item(target), path: target });
    }
    return { files };
  });

  server.get<{ Params: { token: string } }>('/media/:token', async (request, reply) => {
    await access.authorize(request);
    const path = await media.resolve(request.params.token);
    if (!path) return reply.code(404).send({ error: '文件不存在或链接已失效' });
    return reply.type(mimeType(path)).send(createReadStream(path));
  });

  server.get('/api/settings/config', async (request) => {
    await requireAdmin(access, request);
    return configSnapshot(config, paths.workspace);
  });
  server.post('/api/settings/config', async (request, reply) => {
    await requireAdmin(access, request);
    const raw = text(record(request.body).raw);
    if (!raw) return reply.code(400).send({ error: '配置内容不能为空' });
    JSON.parse(raw);
    await import('node:fs/promises').then(({ writeFile }) => writeFile(configPath, raw.endsWith('\n') ? raw : `${raw}\n`, 'utf8'));
    return configSnapshot(JSON.parse(raw) as CaseworkConfig, paths.workspace);
  });
  server.get('/api/settings/runtime', async (request) => {
    const user = await access.authorize(request);
    const isAdmin = user == null || user.role === 'admin';
    return {
      workspace: isAdmin ? paths.workspace : '',
      session_count: await sessions.count(),
      metrics: {},
      live_runtime: { channel: { name: 'webui_plugin', streaming_enabled: webui.streaming, runtime_attached: true, runtime_attach_warned: false }, runtime: { loop_found: true, runtime_attached: true, hook_count: 1, attach_state: { is_wrapped: false, wrapper_name: 'AgentHarness', wrap_count: 1, hook_registered: true } }, connections: { active_chat_count: 0, active_connection_count: 0, blocked_chat_count: 0, chat_connections: {} }, turns: { active_turn_count: 0, turns: {} } },
      recent_logs: [], recent_state_files: [], recent_plans: [], latest_log_preview: '',
    };
  });

  server.get('/ws', { websocket: true }, (socket, request) => {
    let chatId = text(record(request.query).chat_id);
    const authPromise = access.authorize(request);
    const send = (event: ServerEvent) => socket.send(JSON.stringify(event));
    void (async () => {
      try {
        const user = await authPromise;
        const session = chatId ? await sessions.get(chatId) : null;
        if (!session || (access.mode === 'pocketbase' && session.owner_id !== user?.id)) {
          const created = await sessions.create(access.mode === 'pocketbase' ? user?.id : '');
          chatId = created.chat_id;
        }
        const active = await sessions.get(chatId);
        send({ type: 'session.init', chatId, sessionId: chatId.slice(0, 8) });
        send({ type: 'session.history', chatId, messages: active?.messages ?? [] });
      } catch (error) {
        send({ type: 'error', code: 'unauthorized', message: error instanceof Error ? error.message : '认证失败' });
        socket.close(1008);
      }
    })();
    socket.on('message', async (raw) => {
      try {
        const user = await authPromise;
        const command = parseClientCommand(raw.toString());
        if (!command) return send({ type: 'error', code: 'bad_request', message: '无效的消息格式', chatId });
        if (command.type === 'session.new') {
          const created = await sessions.create(access.mode === 'pocketbase' ? user?.id : '');
          chatId = created.chat_id;
          send({ type: 'session.init', chatId, sessionId: chatId.slice(0, 8) });
          return send({ type: 'session.history', chatId, messages: [] });
        }
        if (command.type === 'session.switch') {
          const target = await sessions.get(command.chatId);
          if (!target || (access.mode === 'pocketbase' && target.owner_id !== user?.id)) return send({ type: 'error', code: 'not_found', message: '会话不存在', chatId: command.chatId });
          chatId = command.chatId;
          send({ type: 'session.init', chatId, sessionId: chatId.slice(0, 8) });
          return send({ type: 'session.history', chatId, messages: target.messages });
        }
        if (command.type === 'message.cancel') { await agent.abort(chatId); return send({ type: 'turn.phase', chatId, phase: 'completed' }); }
        const mediaItems = command.attachments?.map((item) => ({ url: item.path, name: item.name, mime: item.mime }));
        await sessions.append(chatId, mediaItems?.length ? { type: 'user', content: command.content, media: mediaItems } : { type: 'user', content: command.content }, access.mode === 'pocketbase' ? user?.id : '');
        send({ type: 'turn.phase', chatId, phase: 'streaming' });
        const toolStartedAt = new Map<string, number>();
        const content = await agent.prompt(chatId, attachmentPrompt(command.content, command.attachments), {
          delta: (delta) => send({ type: 'turn.delta', chatId, delta }),
          toolStart: (name, args) => { toolStartedAt.set(name, Date.now()); send({ type: 'turn.phase', chatId, phase: 'running_tools' }); send({ type: 'tools.started', chatId, tools: [{ name, args, hint: toolHint(name) }] }); },
          toolEnd: (name, status, detail) => { send({ type: 'tools.finished', chatId, durationMs: Date.now() - (toolStartedAt.get(name) || Date.now()), results: [{ name, status: status === 'error' ? 'error' : 'ok', detail }] }); send({ type: 'turn.phase', chatId, phase: 'streaming' }); },
        });
        await sessions.append(chatId, { type: 'assistant', content });
        send({ type: 'turn.completed', chatId, content });
        send({ type: 'turn.phase', chatId, phase: 'completed' });
      } catch (error) {
        send({ type: 'error', code: 'internal_error', message: error instanceof Error ? error.message : '处理消息失败', chatId });
      }
    });
  });

  return { server, config, paths, sessions, access, media, graphs, graphState, graphService, relations, audits, auditService, agent };
}

async function requireAdmin(access: AccessControl, request: Parameters<AccessControl['authorize']>[0]): Promise<CurrentUser | null> {
  const user = await access.authorize(request);
  if (user && user.role !== 'admin') throw new AccessError(403, '当前账号无权访问此功能');
  return user;
}

function configSnapshot(config: CaseworkConfig, workspace: string) {
  return { workspace, config_path: configPath, config_exists: true, raw: `${JSON.stringify(config, null, 2)}\n`, sections: Object.keys(config).sort(), parsed: config, omx_files: [] };
}

function publicUser(user: CurrentUser) { return { id: user.id, email: user.email, role: user.role }; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown): string { return value == null ? '' : String(value).trim(); }
function safeSegment(value: string): string { return value.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '') || 'unknown'; }
function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
function attachmentPrompt(content: string, attachments?: Array<{ path: string; name: string; mime: string }>): string { const lines = attachments?.map((item) => `附件：${item.name || '文件'}（${item.mime || '未知类型'}），本地路径 ${item.path}`) ?? []; return [content, ...lines].filter(Boolean).join('\n\n'); }
function toolHint(name: string): string { return ({ read_case_graph_context: '正在读取图谱事实', build_case_graph_action: '正在生成图谱操作', query_case_funds: '正在查询资金流水' } as Record<string, string>)[name] || `正在执行 ${name}`; }
