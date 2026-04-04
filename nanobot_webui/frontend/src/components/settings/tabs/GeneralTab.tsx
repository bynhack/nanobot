import { ConnectionState } from '../../../types';
import { connectionStatusText } from '../../../ui-utils';
import { THEME_OPTIONS, ThemePreference } from '../types';
import { SettingsRow, SettingsSectionTitle } from '../ui/SettingsRow';

interface GeneralTabProps {
  connectionState: ConnectionState;
  currentChatId: string | null;
  authRequired: boolean;
  onOpenAuth: () => void;
  themePreference: ThemePreference;
  onThemeChange: (value: ThemePreference) => void;
}

export function GeneralTab({
  connectionState,
  currentChatId,
  authRequired,
  onOpenAuth,
  themePreference,
  onThemeChange,
}: GeneralTabProps) {
  return (
    <>
      <section className="settings-section">
        <SettingsSectionTitle title="系统设置" subtitle="配置界面的外观与基础连接参数。" />
        <SettingsRow label="主题" hint="选择您偏好的界面外观。">
          <div className="theme-switcher settings-theme-switcher" role="group" aria-label="主题切换">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`theme-chip${themePreference === option.value ? ' active' : ''}`}
                onClick={() => onThemeChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow label="连接状态" hint="当前后端服务的实时连接状态。">
          <div className={`status-badge ${connectionState}`}>
            <span className="status-dot" />
            <span>{connectionStatusText(connectionState)}</span>
          </div>
        </SettingsRow>
        <SettingsRow label="当前会话 ID" hint="当前正在对话的会话唯一标识符。">
          <code className="text-xs text-muted-foreground">{currentChatId ?? '无'}</code>
        </SettingsRow>
        {authRequired && (
          <SettingsRow
            label="安全认证"
            hint="管理用于访问此实例的令牌。"
          >
            <button
              className="ghost-button"
              type="button"
              onClick={onOpenAuth}
            >
              更新令牌
            </button>
          </SettingsRow>
        )}
      </section>
    </>
  );
}
