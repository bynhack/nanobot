export type VisualConfigDraft = {
  model: string;
  provider: string;
  apiKey: string;
  apiBase: string;
  timezone: string;
  feishuEnabled: boolean;
  feishuAppId: string;
  feishuAppSecret: string;
};

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function readText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function buildVisualConfigDraft(parsed: Record<string, unknown>): VisualConfigDraft {
  const agents = asRecord(parsed.agents);
  const defaults = asRecord(agents.defaults);
  const providers = asRecord(parsed.providers);
  const providerName = readText(defaults.provider, 'custom') || 'custom';
  const providerConfig = asRecord(providers[providerName]);
  const channels = asRecord(parsed.channels);
  const feishu = asRecord(channels.feishu);

  return {
    model: readText(defaults.model),
    provider: providerName,
    apiKey: readText(providerConfig.apiKey),
    apiBase: readText(providerConfig.apiBase),
    timezone: readText(defaults.timezone, 'Asia/Shanghai'),
    feishuEnabled: readBoolean(feishu.enabled),
    feishuAppId: readText(feishu.appId),
    feishuAppSecret: readText(feishu.appSecret),
  };
}

export function buildVisualConfigPayload(
  parsed: Record<string, unknown>,
  draft: VisualConfigDraft,
): Record<string, unknown> {
  const next = structuredClone(parsed);
  const agents = asRecord(next.agents);
  const defaults = asRecord(agents.defaults);
  const providers = asRecord(next.providers);
  const currentProviderName = readText(defaults.provider, 'custom') || 'custom';
  const currentProvider = asRecord(providers[currentProviderName]);
  const selectedProvider = asRecord(providers[draft.provider]);
  const channels = asRecord(next.channels);
  const feishu = asRecord(channels.feishu);

  next.agents = {
    ...agents,
    defaults: {
      ...defaults,
      model: draft.model.trim(),
      provider: draft.provider.trim() || 'custom',
      timezone: draft.timezone.trim() || 'Asia/Shanghai',
    },
  };

  next.providers = {
    ...providers,
    [draft.provider.trim() || 'custom']: {
      ...(draft.provider === currentProviderName ? currentProvider : selectedProvider),
      apiKey: draft.apiKey.trim(),
      apiBase: draft.apiBase.trim() || null,
    },
  };

  next.channels = {
    ...channels,
    feishu: {
      allowFrom: Array.isArray(feishu.allowFrom) ? feishu.allowFrom : ['*'],
      streaming: typeof feishu.streaming === 'boolean' ? feishu.streaming : true,
      encryptKey: readText(feishu.encryptKey),
      verificationToken: readText(feishu.verificationToken),
      reactEmoji: readText(feishu.reactEmoji, 'THUMBSUP'),
      groupPolicy: readText(feishu.groupPolicy, 'mention'),
      replyToMessage: readBoolean(feishu.replyToMessage),
      ...feishu,
      enabled: draft.feishuEnabled,
      appId: draft.feishuAppId.trim(),
      appSecret: draft.feishuAppSecret.trim(),
    },
  };

  return next;
}
