import { useEffect, useState } from 'react';
import { loadSettingsAudit } from '../../../api';
import type { SettingsAuditSnapshot } from '../../../types';
import { SettingsRow, SettingsSectionTitle } from '../ui/SettingsRow';

function formatTime(value: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function commandLabel(command: string): string {
  if (!command) return '-';
  return command.length > 120 ? `${command.slice(0, 120)}...` : command;
}

function scopeLabel(scopes: Record<string, string[]> | undefined): string {
  const entries = Object.entries(scopes ?? {}).filter(([, values]) => values.length > 0);
  if (!entries.length) return '无 scope';
  return entries.map(([key, values]) => `${key}: ${values.join('、')}`).join('；');
}

export function AuditTab({ token }: { token: string }) {
  const [data, setData] = useState<SettingsAuditSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setData(await loadSettingsAudit(token, 120));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加载审计日志失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const snapshot = await loadSettingsAudit(token, 120);
        if (active) setData(snapshot);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : '加载审计日志失败');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  if (loading) return <div className="settings-empty">加载审计日志中…</div>;
  if (error) return <div className="settings-error">{error}</div>;
  if (!data) return <div className="settings-empty">暂无审计数据</div>;

  return (
    <section className="settings-section">
      <div className="flex items-center justify-between mb-2">
        <SettingsSectionTitle
          title="权限审计"
          subtitle={data.scope === 'all' ? '管理员可查看所有用户最近的权限决策。' : '当前仅展示你的权限决策记录。'}
        />
        <button type="button" className="ghost-button" onClick={() => void refresh()}>
          刷新
        </button>
      </div>

      <SettingsRow label="审计范围" hint="普通用户仅能查看自己的审计事件，管理员可查看全局。">
        <div className={`status-badge ${data.scope === 'all' ? 'connected' : 'connecting'}`}>
          <span className="status-dot" />
          <span>{data.scope === 'all' ? '全局' : '仅本人'}</span>
        </div>
      </SettingsRow>
      <SettingsRow label="事件统计" hint="最近审计事件的允许与拒绝数量。">
        <div className="settings-audit-summary">
          <span>总计 {data.summary.total}</span>
          <span className="allow">允许 {data.summary.allow}</span>
          <span className="deny">拒绝 {data.summary.deny}</span>
        </div>
      </SettingsRow>
      {data.audit_path ? (
        <SettingsRow label="审计文件" hint="审计日志 JSONL 的物理路径，仅管理员可见。">
          <code className="text-xs">{data.audit_path}</code>
        </SettingsRow>
      ) : null}

      <div className="settings-header mt-8">
        <h3 className="settings-header-title">最近权限事件</h3>
        <p className="settings-header-subtitle">展示工具调用、命令、决策、原因、账号和通用 scope。</p>
      </div>

      {!data.events.length ? (
        <div className="settings-empty">暂无审计事件。执行一次带工具调用的业务问题后会出现在这里。</div>
      ) : (
        <div className="settings-audit-list">
          {data.events.map((event, index) => (
            <article className="settings-audit-item" key={`${event.ts}-${index}`}>
              <div className="settings-audit-item-main">
                <div className="settings-audit-title-row">
                  <span className={`settings-audit-decision ${event.decision === 'deny' ? 'deny' : 'allow'}`}>
                    {event.decision === 'deny' ? '拒绝' : '允许'}
                  </span>
                  <span className="settings-audit-tool">{event.tool || '-'}</span>
                  <span className="settings-audit-time">{formatTime(event.ts)}</span>
                </div>
                <div className="settings-audit-command">{commandLabel(event.command)}</div>
                <div className="settings-audit-meta">
                  <span>{event.email || '-'}</span>
                  <span>{event.role || '-'}</span>
                  <span>{event.business_role || '-'}</span>
                  <span>{event.reason || '-'}</span>
                </div>
              </div>
              <div className="settings-audit-scope">
                {scopeLabel(event.scopes)}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
