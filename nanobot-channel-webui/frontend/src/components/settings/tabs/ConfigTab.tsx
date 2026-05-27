import { useState, useEffect } from 'react';
import { loadSettingsConfig, saveSettingsConfig } from '../../../api';
import type { SettingsConfigSnapshot } from '../../../types';
import { buildVisualConfigDraft, buildVisualConfigPayload, VisualConfigDraft, asRecord, readText, readBoolean } from '../utils/configUtils';
import { SettingsRow, SettingsSectionTitle } from '../ui/SettingsRow';
import { FileMetaList } from '../ui/FileMetaList';

export function ConfigTab({ token }: { token: string }) {
  const [data, setData] = useState<SettingsConfigSnapshot | null>(null);
  const [draftRaw, setDraftRaw] = useState('');
  const [visualDraft, setVisualDraft] = useState<VisualConfigDraft | null>(null);
  const [advancedMode, setAdvancedMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const snapshot = await loadSettingsConfig(token);
        if (active) {
          setData(snapshot);
          setDraftRaw(snapshot.raw);
          setVisualDraft(buildVisualConfigDraft(snapshot.parsed));
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : '加载配置失败');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  if (loading) {
    return <div className="settings-empty">加载配置中…</div>;
  }
  if (error) {
    return <div className="settings-error">{error}</div>;
  }
  if (!data) {
    return <div className="settings-empty">暂无配置数据</div>;
  }

  const providerOptions = Array.from(
    new Set([
      ...(visualDraft?.provider ? [visualDraft.provider] : []),
      ...Object.keys(asRecord(data.parsed.providers)),
    ]),
  );

  return (
    <section className="settings-section">
      <SettingsSectionTitle title="工作区配置" subtitle="管理当前工作区的核心设置与模型参数。" />
      
      <SettingsRow label="当前工作区" hint="当前系统实例绑定的物理目录。">
        <code className="text-xs">{data.workspace}</code>
      </SettingsRow>
      <SettingsRow label="主配置文件" hint="所有配置更改都将持久化到此文件。">
        <code className="text-xs">{data.config_path}</code>
      </SettingsRow>

      {notice ? <div className="settings-success">{notice}</div> : null}
      {error ? <div className="settings-error">{error}</div> : null}

      {visualDraft && (
        <>
          <div className="settings-header mt-8">
            <h3 className="settings-header-title">模型与推理</h3>
            <p className="settings-header-subtitle">配置默认使用的智能模型及其对应的接口服务商。</p>
          </div>
          
          <SettingsRow label="模型名称" hint="例如 gpt-4o, kimi-k2.5 等。">
            <input
              className="settings-input"
              value={visualDraft.model}
              onChange={(event) => setVisualDraft((current) => current ? { ...current, model: event.target.value } : current)}
              placeholder="例如 gpt-4o"
            />
          </SettingsRow>

          <SettingsRow label="服务商" hint="指定模型所属的后端集成。">
            <select
              className="settings-select"
              value={visualDraft.provider}
              onChange={(event) => setVisualDraft((current) => current ? { ...current, provider: event.target.value } : current)}
            >
              {providerOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </SettingsRow>

          <SettingsRow label="接口令牌" hint="用于接口鉴权的访问令牌。">
            <input
              className="settings-input"
              type="password"
              value={visualDraft.apiKey}
              onChange={(event) => setVisualDraft((current) => current ? { ...current, apiKey: event.target.value } : current)}
              placeholder="sk-..."
            />
          </SettingsRow>

          <SettingsRow label="接口基准地址" hint="自定义接口端点，留空则使用默认值。">
            <input
              className="settings-input"
              value={visualDraft.apiBase}
              onChange={(event) => setVisualDraft((current) => current ? { ...current, apiBase: event.target.value } : current)}
              placeholder="https://api.openai.com/v1"
            />
          </SettingsRow>

          <SettingsRow label="时区" hint="影响定时任务和日志的时间戳显示。">
            <input
              className="settings-input"
              value={visualDraft.timezone}
              onChange={(event) => setVisualDraft((current) => current ? { ...current, timezone: event.target.value } : current)}
              placeholder="Asia/Shanghai"
            />
          </SettingsRow>

          <div className="settings-header mt-8">
            <h3 className="settings-header-title">飞书渠道</h3>
            <p className="settings-header-subtitle">配置飞书机器人的集成参数。</p>
          </div>

          <SettingsRow label="启用飞书" hint="开启后系统将通过飞书机器人提供服务。">
            <button
              type="button"
              className={`settings-modern-toggle${visualDraft.feishuEnabled ? ' active' : ''}`}
              aria-label={visualDraft.feishuEnabled ? '禁用飞书' : '启用飞书'}
              onClick={() =>
                setVisualDraft((current) => current ? { ...current, feishuEnabled: !current.feishuEnabled } : current)
              }
            >
              <div className="toggle-thumb" />
            </button>
          </SettingsRow>

          <SettingsRow label="应用编号" hint="飞书开放平台的应用标识。">
            <input
              className="settings-input"
              value={visualDraft.feishuAppId}
              onChange={(event) =>
                setVisualDraft((current) => current ? { ...current, feishuAppId: event.target.value } : current)
              }
              placeholder="cli_xxx"
            />
          </SettingsRow>

          <SettingsRow label="应用密钥" hint="应用的访问密钥。">
            <input
              className="settings-input"
              type="password"
              value={visualDraft.feishuAppSecret}
              onChange={(event) =>
                setVisualDraft((current) => current ? { ...current, feishuAppSecret: event.target.value } : current)
              }
              placeholder="请输入应用密钥"
            />
          </SettingsRow>

          <div className="settings-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setVisualDraft(buildVisualConfigDraft(data.parsed));
                setNotice(null);
                setError(null);
              }}
              disabled={saving}
            >
              重置更改
            </button>
            <button
              type="button"
              className="settings-primary-button"
              disabled={saving}
              onClick={async () => {
                if (!visualDraft) return;
                setSaving(true);
                setError(null);
                setNotice(null);
                try {
                  const payload = buildVisualConfigPayload(data.parsed, visualDraft);
                  const next = await saveSettingsConfig(`${JSON.stringify(payload, null, 2)}\n`, token);
                  setData(next);
                  setDraftRaw(next.raw);
                  setVisualDraft(buildVisualConfigDraft(next.parsed));
                  setNotice('配置已更新');
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : '保存失败');
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? '保存中...' : '保存更改'}
            </button>
          </div>
        </>
      )}

      <div className="settings-header mt-8">
        <h3 className="settings-header-title">高级配置</h3>
        <p className="settings-header-subtitle">直接编辑结构化配置文件，适合高级用户。</p>
      </div>

      <SettingsRow label="专家模式" hint="启用直接编辑结构化配置内容。">
        <button
          type="button"
          className="ghost-button"
          onClick={() => setAdvancedMode((current) => !current)}
        >
          {advancedMode ? '关闭编辑器' : '打开编辑器'}
        </button>
      </SettingsRow>

      {advancedMode && (
        <div className="settings-editor-wrapper mt-4">
          <textarea
            className="settings-textarea"
            value={draftRaw}
            onChange={(event) => setDraftRaw(event.target.value)}
            spellCheck={false}
          />
          <div className="settings-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setDraftRaw(data.raw)}
              disabled={saving}
            >
              还原
            </button>
            <button
              type="button"
              className="settings-primary-button"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                setError(null);
                setNotice(null);
                try {
                  const next = await saveSettingsConfig(draftRaw, token);
                  setData(next);
                  setDraftRaw(next.raw);
                  setVisualDraft(buildVisualConfigDraft(next.parsed));
                  setNotice('结构化配置已保存');
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : '保存失败');
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? '保存中...' : '保存配置'}
            </button>
          </div>
        </div>
      )}

      <div className="mt-12">
        <FileMetaList title="工作区资源" items={data.omx_files} />
      </div>
    </section>
  );
}
