import { join, resolve } from 'node:path';

export interface RuntimePaths {
  root: string;
  workspace: string;
  data: string;
  sessions: string;
  uploads: string;
  skills: string;
  logs: string;
  caseGraphs: string;
  caseGraphContexts: string;
  caseAudits: string;
  chatWorkspaces: string;
}

export function runtimePaths(root: string, configuredWorkspace: string): RuntimePaths {
  const workspace = resolve(expandHome(configuredWorkspace));
  const data = join(workspace, 'data');
  return {
    root,
    workspace,
    data,
    sessions: join(workspace, 'sessions'),
    uploads: join(data, 'uploads'),
    skills: join(workspace, 'skills'),
    logs: join(root, 'logs'),
    caseGraphs: join(data, 'case_graphs'),
    caseGraphContexts: join(data, 'case_graph_contexts'),
    caseAudits: join(data, 'case_audits'),
    chatWorkspaces: join(data, 'chat_workspaces'),
  };
}

function expandHome(path: string): string {
  if (!path.startsWith('~/')) return path;
  return join(process.env.HOME || '', path.slice(2));
}
