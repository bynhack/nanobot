import { useEffect, useState } from 'react';
import { loadSettingsRuntime } from '../../../api';
import { SettingsRuntimeSnapshot } from '../../../types';
import { FileMetaList } from '../ui/FileMetaList';
import { SettingsRow, SettingsSectionTitle } from '../ui/SettingsRow';

export function RuntimeTab({ token }: { token: string }) {
  const [data, setData] = useState<SettingsRuntimeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const snapshot = await loadSettingsRuntime(token);
        if (active) setData(snapshot);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : '加载运行状态失败');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  if (loading) return <div className="settings-empty">加载运行状态中…</div>;
  if (error) return <div className="settings-error">{error}</div>;
  if (!data) return <div className="settings-empty">暂无运行状态</div>;

  return (
    <section className="settings-section">
      <SettingsSectionTitle 
        title="运行数据" 
        subtitle="观测 Nanobot 的运行状态、日志跟踪与存储资源。"
      />
      <SettingsRow label="工作区目录" hint="Nanobot 当前运行的物理路径。">
        <code className="text-xs">{data.workspace}</code>
      </SettingsRow>
      <SettingsRow label="活跃会话数" hint="当前存储在工作区中的对话总数。">
        <div className="font-semibold">{data.session_count}</div>
      </SettingsRow>
      
      <div className="settings-header mt-8">
        <h3 className="settings-header-title">性能指标 (Metrics)</h3>
        <p className="settings-header-subtitle">实时统计数据，反映系统负载与执行效率。</p>
      </div>
      <SettingsRow label="执行统计" vertical>
        <pre className="settings-code-block">{JSON.stringify(data.metrics, null, 2) || '{}'}</pre>
      </SettingsRow>
      
      <div className="settings-header mt-8">
        <h3 className="settings-header-title">日志观测</h3>
        <p className="settings-header-subtitle">查看最近的系统运行记录与错误堆栈。</p>
      </div>
      <FileMetaList title="最近日志文件" items={data.recent_logs} />
      <SettingsRow label="日志实时预览" hint="显示最新 50 行日志记录。" vertical>
        <pre className="settings-code-block">{data.latest_log_preview || '暂无日志预览'}</pre>
      </SettingsRow>

      <div className="settings-header mt-8">
        <h3 className="settings-header-title">存储快照</h3>
        <p className="settings-header-subtitle">工作区自动保存的状态、计划与临时文件。</p>
      </div>
      <FileMetaList title="状态文件 (.state)" items={data.recent_state_files} />
      <FileMetaList title="执行计划 (.plan)" items={data.recent_plans} />
    </section>
  );
}
