import { useEffect, useState } from 'react';
import { loadSettingsTenantContracts } from '../../../api';
import type { SettingsTenantContractsSnapshot } from '../../../types';
import { SettingsRow, SettingsSectionTitle } from '../ui/SettingsRow';

function statusLabel(status: string): string {
  if (status === 'error') return '错误';
  if (status === 'warning') return '警告';
  return '通过';
}

export function ContractsTab({ token }: { token: string }) {
  const [data, setData] = useState<SettingsTenantContractsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setData(await loadSettingsTenantContracts(token));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加载技能契约失败');
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
        const snapshot = await loadSettingsTenantContracts(token);
        if (active) setData(snapshot);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : '加载技能契约失败');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  if (loading) return <div className="settings-empty">扫描技能契约中…</div>;
  if (error) return <div className="settings-error">{error}</div>;
  if (!data) return <div className="settings-empty">暂无契约数据</div>;

  return (
    <section className="settings-section">
      <div className="flex items-center justify-between mb-2">
        <SettingsSectionTitle
          title="技能契约校验"
          subtitle="扫描工作区技能的 tenant-runtime.json，提前发现权限声明和命令入口问题。"
        />
        <button type="button" className="ghost-button" onClick={() => void refresh()}>
          刷新
        </button>
      </div>

      <SettingsRow label="技能目录" hint="当前只校验工作区技能，不扫描内置系统技能。">
        <code className="text-xs">{data.skills_root}</code>
      </SettingsRow>
      <SettingsRow label="校验统计" hint="错误需要修复；警告需要确认是否符合业务预期。">
        <div className="settings-audit-summary">
          <span>总计 {data.summary.total}</span>
          <span className="allow">通过 {data.summary.ok}</span>
          <span>警告 {data.summary.warning}</span>
          <span className="deny">错误 {data.summary.error}</span>
        </div>
      </SettingsRow>

      <div className="settings-contract-list">
        {data.contracts.map((contract) => (
          <article className={`settings-contract-item ${contract.status}`} key={contract.path}>
            <div className="settings-contract-heading">
              <div>
                <h3>{contract.name}</h3>
                <p>{contract.contract_path || '未声明契约'}</p>
              </div>
              <span className={`settings-contract-status ${contract.status}`}>{statusLabel(contract.status)}</span>
            </div>
            <div className="settings-contract-grid">
              <div>
                <strong>类型</strong>
                <p>{contract.kind || 'business'}</p>
              </div>
              <div>
                <strong>命令入口</strong>
                <p>{contract.commands.length ? contract.commands.join('、') : '未声明'}</p>
              </div>
              <div>
                <strong>拒绝子命令</strong>
                <p>{contract.denied_commands.length ? contract.denied_commands.join('、') : '未声明'}</p>
              </div>
              <div>
                <strong>资源动作</strong>
                <p>
                  {contract.resources.length
                    ? contract.resources.map((item) => `${item.resource}:${item.actions.join('/')}`).join('、')
                    : '未声明'}
                </p>
              </div>
            </div>
            {contract.issues.length ? (
              <ul className="settings-contract-issues">
                {contract.issues.map((issue, index) => (
                  <li className={issue.severity} key={`${issue.code}-${index}`}>
                    <span>{issue.severity === 'error' ? '错误' : '警告'}</span>
                    <code>{issue.code}</code>
                    <p>{issue.message}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="settings-success">契约声明完整，未发现问题。</div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
