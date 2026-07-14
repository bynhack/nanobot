import {
  AgentHarness,
  JsonlSessionRepo,
  NodeExecutionEnv,
  type AgentTool,
} from "@earendil-works/pi-agent-core/node";
import {
  Type,
  createModels,
  createProvider,
  type AssistantMessage,
  type ImageContent,
  type Model,
  type TextContent,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { CaseworkConfig, MediaItem } from "@casework/contracts";
import type { RuntimePaths } from "@casework/persistence";
import {
  GraphStateService,
  type CaseGraphQueryClient,
} from "@casework/case-graph";
type JsonObject = Record<string, unknown>;

export type AgentHooks = {
  delta: (s: string) => void;
  toolStart: (name: string, args: Record<string, unknown>) => void;
  toolEnd: (name: string, status: string, detail: string) => void;
};

export interface AgentResponse {
  content: string;
  media: MediaItem[];
  buttons?: string[][];
}
export class AgentRuntime {
  private env: NodeExecutionEnv;
  private repo: JsonlSessionRepo;
  private models: any;
  private model: Model<any>;
  private harnesses = new Map<string, AgentHarness>();
  private activeChats = new Set<string>();
  constructor(
    private config: CaseworkConfig,
    private paths: RuntimePaths,
    private graphState: GraphStateService,
    private query: CaseGraphQueryClient,
  ) {
    this.env = new NodeExecutionEnv({ cwd: paths.workspace });
    this.repo = new JsonlSessionRepo({
      fs: this.env,
      sessionsRoot: `${paths.sessions}/agent-harness`,
    });
    const provider = config.agents.defaults.provider,
      pc = config.providers[provider] || {},
      modelId = config.agents.defaults.model;
    if (pc.apiKey) process.env[envKey(provider)] = pc.apiKey;
    if (pc.apiBase) {
      const apiBase = pc.apiBase;
      this.models = createModels();
      const model: any = {
        id: modelId,
        name: modelId,
        api: "openai-completions",
        provider,
        baseUrl: apiBase,
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 32768,
        compat: { supportsDeveloperRole: false, supportsStrictMode: false },
      };
      this.models.setProvider(
        createProvider({
          id: provider,
          name: provider,
          baseUrl: apiBase,
          auth: {
            apiKey: {
              name: `${provider} API key`,
              resolve: async () =>
                pc.apiKey
                  ? {
                      auth: { apiKey: pc.apiKey, baseUrl: apiBase },
                      source: "config.json",
                    }
                  : undefined,
            },
          },
          models: [model],
          api: openAICompletionsApi(),
        }),
      );
      this.model = model;
    } else {
      this.models = builtinModels();
      this.model =
        this.models.getModel(provider, modelId) ||
        this.models.getModel("openai", modelId) ||
        this.models.getModels(provider)[0];
      if (!this.model) throw new Error(`未找到模型 ${provider}/${modelId}`);
    }
  }
  async prompt(
    chatId: string,
    prompt: string,
    hooks: AgentHooks,
  ): Promise<AgentResponse> {
    const a = await this.get(chatId);
    this.activeChats.add(chatId);
    let pendingQuestion: { question: string; options: string[] } | undefined;
    const media: MediaItem[] = [];
    const off = a.subscribe((ev) => {
      if (
        ev.type === "message_update" &&
        ev.assistantMessageEvent.type === "text_delta"
      )
        hooks.delta(ev.assistantMessageEvent.delta);
      if (ev.type === "tool_call") {
        hooks.toolStart(ev.toolName, ev.input);
        if (ev.toolName === "ask_user") {
          const question = text(ev.input.question);
          const options = stringList(ev.input.options);
          if (question && options.length)
            pendingQuestion = { question, options };
        }
      }
      if (ev.type === "tool_result") {
        media.push(...mediaFromToolContent(ev.content, ev.toolName));
        hooks.toolEnd(
          ev.toolName,
          ev.isError ? "error" : "ok",
          ev.content
            .map((item) => (item.type === "text" ? item.text : ""))
            .join("\n"),
        );
      }
    });
    try {
      const msg = await a.prompt(prompt);
      const content = pendingQuestion?.question || assistantText(msg);
      return {
        content,
        media,
        ...(pendingQuestion ? { buttons: [pendingQuestion.options] } : {}),
      };
    } finally {
      this.activeChats.delete(chatId);
      off();
    }
  }
  async abort(chatId: string) {
    const a = this.harnesses.get(chatId);
    if (a) await a.abort();
  }

  snapshot() {
    return {
      harness_count: this.harnesses.size,
      active_chat_ids: [...this.activeChats],
    };
  }
  private async get(chatId: string) {
    const found = this.harnesses.get(chatId);
    if (found) return found;
    const all = await this.repo.list({ cwd: this.paths.workspace }),
      meta = all.find((x) => x.id === chatId),
      session = meta
        ? await this.repo.open(meta)
        : await this.repo.create({
            id: chatId,
            cwd: this.paths.workspace,
            metadata: { chatId },
          });
    const tools = this.tools();
    const a = new AgentHarness({
      env: this.env,
      session,
      models: this.models,
      model: this.model,
      thinkingLevel: "medium",
      tools,
      activeToolNames: tools.map((x) => x.name),
      resources: { skills: productSkills(this.paths.workspace) },
      systemPrompt: systemPrompt(this.config.agents.defaults.timezone),
    });
    this.harnesses.set(chatId, a);
    return a;
  }
  private tools(): AgentTool[] {
    const context: AgentTool<any> = {
      name: "read_case_graph_context",
      label: "读取图谱研判上下文",
      description: "读取当前关系图、最新步骤和交易事实，用于研判解释。",
      parameters: Type.Object({
        caseId: Type.String(),
        graphId: Type.String(),
      }),
      execute: async (_id, raw) => {
        const p = raw as { caseId: string; graphId: string },
          state = await this.graphState.loadCurrent(p.caseId, p.graphId),
          steps = await this.graphState.listSteps(p.caseId, p.graphId);
        return result({ state, latestStep: steps.at(-1) || null });
      },
    };
    const actionTypes = [
      "filter",
      "reset_filter",
      "drill",
      "exclude_node",
      "restore_node",
      "exclude_trades",
      "restore_trades",
      "extend_clues",
      "complete_relation",
      "create_subject",
      "add_manual_trade",
      "add_reality_relation",
    ];
    const action: AgentTool<any> = {
      name: "build_case_graph_action",
      label: "生成图谱操作指令",
      description:
        "把用户确认的图谱操作转换为前端可执行的隐藏动作协议；本工具不直接修改图谱。",
      parameters: Type.Object({
        type: Type.Union(actionTypes.map((x) => Type.Literal(x))),
        payload: Type.Record(Type.String(), Type.Any()),
      }),
      execute: async (_id, raw) => {
        const p = raw as { type: string; payload: JsonObject };
        return result(
          `<!-- 图谱动作 ${JSON.stringify({ type: p.type, ...p.payload })} -->`,
        );
      },
    };
    const funds: AgentTool<any> = {
      name: "query_case_funds",
      label: "查询案件资金流水",
      description: "按案件、付款方、收款方、金额和时间条件只读查询资金流水。",
      parameters: Type.Object({
        caseId: Type.String(),
        payerCards: Type.Optional(
          Type.Array(Type.Record(Type.String(), Type.Any())),
        ),
        payeeCards: Type.Optional(
          Type.Array(Type.Record(Type.String(), Type.Any())),
        ),
        startTime: Type.Optional(Type.String()),
        endTime: Type.Optional(Type.String()),
        minAmount: Type.Optional(Type.String()),
        maxAmount: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Number()),
      }),
      execute: async (_id, raw) =>
        result(await this.query.targetDetail(raw as JsonObject)),
    };
    const askUser: AgentTool = {
      name: "ask_user",
      label: "向用户确认",
      description: "当继续处理前必须由用户选择或确认时，展示问题和可点击选项。",
      parameters: Type.Object({
        question: Type.String(),
        options: Type.Array(Type.String(), { minItems: 1, maxItems: 8 }),
      }),
      execute: async (_id, raw) => {
        const input = raw as { question: string; options: string[] };
        const question = text(input.question);
        const options = stringList(input.options);
        return {
          ...result(
            [
              question,
              "",
              ...options.map((item, index) => `${index + 1}. ${item}`),
            ].join("\n"),
          ),
          terminate: true,
        };
      },
    };
    return [context, action, funds, askUser];
  }
}
function result(details: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          typeof details === "string"
            ? details
            : JSON.stringify(details, null, 2),
      },
    ],
    details,
  };
}
function assistantText(message: AssistantMessage): string {
  return Array.isArray(message.content)
    ? message.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("")
    : "";
}

function mediaFromToolContent(
  content: Array<TextContent | ImageContent>,
  toolName: string,
): MediaItem[] {
  return content
    .filter(
      (item): item is ImageContent =>
        item.type === "image" && Boolean(item.data) && Boolean(item.mimeType),
    )
    .map((item, index) => ({
      url: `data:${item.mimeType};base64,${item.data}`,
      name: `${toolName}-${index + 1}.${extensionForMime(item.mimeType)}`,
      mime: item.mimeType,
    }));
}

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function extensionForMime(mime: string): string {
  return mime.split("/")[1]?.replace("jpeg", "jpg") || "bin";
}
function envKey(p: string) {
  return (
    (
      {
        openai: "OPENAI_API_KEY",
        openrouter: "OPENROUTER_API_KEY",
        anthropic: "ANTHROPIC_API_KEY",
        deepseek: "DEEPSEEK_API_KEY",
      } as Record<string, string>
    )[p] || `${p.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`
  );
}
function systemPrompt(tz: string) {
  return [
    "你是面向公安办案人员的资金流分析智能体。",
    `使用中文，事实与推断分开表达。时区：${tz}。`,
    "图谱解释先读取当前图谱上下文；数据库查询必须只读。",
    "用户要求执行图谱动作时，先明确对象与影响，再调用 build_case_graph_action，并原样保留工具返回的隐藏注释。",
    "需要用户选择或补充信息时必须调用 ask_user。",
    "不得编造案件、账号、交易或图谱事实。",
  ].join("");
}
function productSkills(root: string) {
  return [
    {
      name: "case-graph-analyst",
      description:
        "图谱研判助手：读取保存的图谱事实和步骤，用中文解释当前关系图。",
      content:
        "必须调用 read_case_graph_context 获取当前 graph.json、步骤与交易事实；区分数据库事实、人工补充和研判推断。",
      filePath: `${root}/skills/case-graph-analyst/SKILL.md`,
    },
    {
      name: "case-graph-operator",
      description: "图谱操作助手：把自然语言意图转换为前端图谱动作协议。",
      content:
        "不得直接修改图谱；仅在参数明确后调用 build_case_graph_action，输出其隐藏注释。",
      filePath: `${root}/skills/case-graph-operator/SKILL.md`,
    },
    {
      name: "mysql-connector",
      description: "资金流水查询助手：只读查询案件账号与交易事实。",
      content:
        "使用 query_case_funds，只读、参数化查询；姓名应先解析为案件账号，交易方向依据付款方和收款方。",
      filePath: `${root}/skills/mysql-connector/SKILL.md`,
    },
  ];
}
