export interface CaseworkConfig {
  agents: {
    defaults: {
      model: string;
      provider: string;
      timezone: string;
      workspace: string;
    };
  };
  providers: Record<string, { apiKey?: string; apiBase?: string }>;
  channels: {
    webui_plugin: {
      enabled: boolean;
      host: string;
      port: number;
      title: string;
      authToken: string;
      mediaSigningSecret: string;
      mediaTokenTtlSeconds: number;
      streaming: boolean;
      pocketbaseUrl: string;
      pocketbaseUsersCollection: string;
      pocketbaseSessionsCollection: string;
      caseGraphDbHost: string;
      caseGraphDbPort: number;
      caseGraphDbUser: string;
      caseGraphDbPassword: string;
      caseGraphDbName: string;
    };
  };
}
