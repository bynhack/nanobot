import { AgentHarness, JsonlSessionRepo, NodeExecutionEnv, type AgentTool } from '@earendil-works/pi-agent-core/node';
import { Type, createModels, createProvider, type Model } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import type { CaseworkConfig } from '../config/config.js';
import type { RuntimePaths } from '../persistence/paths.js';
import type { CaseGraphQueryClient } from '../case-graph/query-client.js';
import { GraphStateService } from '../case-graph/graph-state-service.js';
type R=Record<string,any>;

type Hooks={delta:(s:string)=>void;toolStart:(name:string,args:Record<string,unknown>)=>void;toolEnd:(name:string,status:string,detail:string)=>void};
export class AgentRuntime{
 private env:NodeExecutionEnv;private repo:JsonlSessionRepo;private models:any;private model:Model<any>;private harnesses=new Map<string,AgentHarness>();
 constructor(private config:CaseworkConfig,private paths:RuntimePaths,private graphState:GraphStateService,private query:CaseGraphQueryClient){
  this.env=new NodeExecutionEnv({cwd:paths.workspace});this.repo=new JsonlSessionRepo({fs:this.env,sessionsRoot:`${paths.sessions}/agent-harness`});
  const provider=config.agents.defaults.provider,pc=config.providers[provider]||{},modelId=config.agents.defaults.model;
  if(pc.apiKey)process.env[envKey(provider)]=pc.apiKey;
  if(pc.apiBase){const apiBase=pc.apiBase;this.models=createModels();const model:any={id:modelId,name:modelId,api:'openai-completions',provider,baseUrl:apiBase,reasoning:true,input:['text','image'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:32768,compat:{supportsDeveloperRole:false,supportsStrictMode:false}};this.models.setProvider(createProvider({id:provider,name:provider,baseUrl:apiBase,auth:{apiKey:{name:`${provider} API key`,resolve:async()=>pc.apiKey?{auth:{apiKey:pc.apiKey,baseUrl:apiBase},source:'config.json'}:undefined}},models:[model],api:openAICompletionsApi()}));this.model=model;}
  else{this.models=builtinModels();this.model=this.models.getModel(provider,modelId)||this.models.getModel('openai',modelId)||this.models.getModels(provider)[0];if(!this.model)throw new Error(`未找到模型 ${provider}/${modelId}`);}
 }
 async prompt(chatId:string,prompt:string,h:Hooks){const a=await this.get(chatId);let started=new Map<string,number>();const off=a.subscribe(ev=>{if(ev.type==='message_update'&&ev.assistantMessageEvent.type==='text_delta')h.delta(ev.assistantMessageEvent.delta);if(ev.type==='tool_call'){started.set(ev.toolCallId,Date.now());h.toolStart(ev.toolName,ev.input);}if(ev.type==='tool_result')h.toolEnd(ev.toolName,ev.isError?'error':'ok',ev.content.map((x:any)=>x.text||'').join('\n'));});try{const msg=await a.prompt(prompt);return assistantText(msg);}finally{off();}}
 async abort(chatId:string){const a=this.harnesses.get(chatId);if(a)await a.abort();}
 private async get(chatId:string){const found=this.harnesses.get(chatId);if(found)return found;const all=await this.repo.list({cwd:this.paths.workspace}),meta=all.find(x=>x.id===chatId),session=meta?await this.repo.open(meta):await this.repo.create({id:chatId,cwd:this.paths.workspace,metadata:{chatId}});const tools=this.tools();const a=new AgentHarness({env:this.env,session,models:this.models,model:this.model,thinkingLevel:'medium',tools,activeToolNames:tools.map(x=>x.name),resources:{skills:productSkills(this.paths.workspace)},systemPrompt:systemPrompt(this.config.agents.defaults.timezone)});this.harnesses.set(chatId,a);return a;}
 private tools():AgentTool[]{
  const context:AgentTool<any>={name:'read_case_graph_context',label:'读取图谱研判上下文',description:'读取当前关系图、最新步骤和交易事实，用于研判解释。',parameters:Type.Object({caseId:Type.String(),graphId:Type.String()}),execute:async(_id,raw)=>{const p=raw as R,state=await this.graphState.loadCurrent(p.caseId,p.graphId),steps=await this.graphState.listSteps(p.caseId,p.graphId);return result({state,latestStep:steps.at(-1)||null});}};
  const actionTypes=['filter','reset_filter','drill','exclude_node','restore_node','exclude_trades','restore_trades','extend_clues','complete_relation','create_subject','add_manual_trade','add_reality_relation'];
  const action:AgentTool<any>={name:'build_case_graph_action',label:'生成图谱操作指令',description:'把用户确认的图谱操作转换为前端可执行的隐藏动作协议；本工具不直接修改图谱。',parameters:Type.Object({type:Type.Union(actionTypes.map(x=>Type.Literal(x))),payload:Type.Record(Type.String(),Type.Any())}),execute:async(_id,raw)=>{const p=raw as R;return result(`<!-- 图谱动作 ${JSON.stringify({type:p.type,...p.payload})} -->`);}};
  const funds:AgentTool<any>={name:'query_case_funds',label:'查询案件资金流水',description:'按案件、付款方、收款方、金额和时间条件只读查询资金流水。',parameters:Type.Object({caseId:Type.String(),payerCards:Type.Optional(Type.Array(Type.Record(Type.String(),Type.Any()))),payeeCards:Type.Optional(Type.Array(Type.Record(Type.String(),Type.Any()))),startTime:Type.Optional(Type.String()),endTime:Type.Optional(Type.String()),minAmount:Type.Optional(Type.String()),maxAmount:Type.Optional(Type.String()),limit:Type.Optional(Type.Number())}),execute:async(_id,raw)=>result(await this.query.targetDetail(raw as R))};
  return[context,action,funds];
 }
}
function result(details:any){return{content:[{type:'text' as const,text:typeof details==='string'?details:JSON.stringify(details,null,2)}],details};}function assistantText(m:any){return Array.isArray(m.content)?m.content.filter((x:any)=>x.type==='text').map((x:any)=>x.text).join(''):'';}function envKey(p:string){return({openai:'OPENAI_API_KEY',openrouter:'OPENROUTER_API_KEY',anthropic:'ANTHROPIC_API_KEY',deepseek:'DEEPSEEK_API_KEY'}as Record<string,string>)[p]||`${p.toUpperCase().replace(/[^A-Z0-9]/g,'_')}_API_KEY`;}
function systemPrompt(tz:string){return`你是面向公安办案人员的资金流分析智能体。使用中文，事实与推断分开表达。时区：${tz}。图谱解释先读取当前图谱上下文；数据库查询必须只读；用户要求执行图谱动作时，先明确对象与影响，再调用 build_case_graph_action，并原样保留工具返回的隐藏注释。不得编造案件、账号、交易或图谱事实。`;}
function productSkills(root:string){return[{name:'case-graph-analyst',description:'图谱研判助手：读取保存的图谱事实和步骤，用中文解释当前关系图。',content:'必须调用 read_case_graph_context 获取当前 graph.json、步骤与交易事实；区分数据库事实、人工补充和研判推断。',filePath:`${root}/skills/case-graph-analyst/SKILL.md`},{name:'case-graph-operator',description:'图谱操作助手：把自然语言意图转换为前端图谱动作协议。',content:'不得直接修改图谱；仅在参数明确后调用 build_case_graph_action，输出其隐藏注释。',filePath:`${root}/skills/case-graph-operator/SKILL.md`},{name:'mysql-connector',description:'资金流水查询助手：只读查询案件账号与交易事实。',content:'使用 query_case_funds，只读、参数化查询；姓名应先解析为案件账号，交易方向依据付款方和收款方。',filePath:`${root}/skills/mysql-connector/SKILL.md`}];}
