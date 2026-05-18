import { AuthUser, BootstrapConfig, ConnectionState } from '../../../types';
import { connectionStatusText } from '../../../ui-utils';
import { APPEARANCE_OPTIONS, AppearanceMode, UI_THEME_OPTIONS, UiTheme } from '../types';
import { SettingsRow, SettingsSectionTitle } from '../ui/SettingsRow';

interface GeneralTabProps {
  connectionState: ConnectionState;
  currentChatId: string | null;
  authRequired: boolean;
  onOpenAuth: () => void;
  appearanceMode: AppearanceMode;
  onAppearanceModeChange: (value: AppearanceMode) => void;
  uiTheme: UiTheme;
  onUiThemeChange: (value: UiTheme) => void;
  currentUser: AuthUser | null;
  authMode: BootstrapConfig['authMode'];
  onLogout: () => void;
}

export function GeneralTab({
  connectionState,
  currentChatId,
  authRequired,
  onOpenAuth,
  appearanceMode,
  onAppearanceModeChange,
  uiTheme,
  onUiThemeChange,
  currentUser,
  authMode,
  onLogout,
}: GeneralTabProps) {
  return (
    <>
      <section className="settings-section">
        <SettingsSectionTitle title="系统设置" subtitle="配置界面的外观与基础连接参数。" />
        <SettingsRow label="明暗模式" hint="控制浅色、深色与跟随系统。">
          <div className="theme-switcher settings-theme-switcher" role="group" aria-label="主题切换">
            {APPEARANCE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`theme-chip${appearanceMode === option.value ? ' active' : ''}`}
                onClick={() => onAppearanceModeChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow
          label="业务主题"
          hint="按使用场景切换界面气质，布局与交互保持不变。"
          vertical
        >
          <div className="settings-theme-grid" role="group" aria-label="业务主题切换">
            {UI_THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`settings-theme-card${uiTheme === option.value ? ' active' : ''}`}
                onClick={() => onUiThemeChange(option.value)}
              >
                <span className="settings-theme-card-title">{option.label}</span>
                <span className="settings-theme-card-desc">{option.description}</span>
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
        {currentUser ? (
          <>
            <SettingsRow label="当前账号" hint="当前登录的 PocketBase 用户。">
              <code className="text-xs text-muted-foreground">{currentUser.email}</code>
            </SettingsRow>
            <SettingsRow label="角色" hint="管理员可查看全局配置与运行数据，普通用户仅查看自己的数据。">
              <div className={`status-badge connected`}>
                <span className="status-dot" />
                <span>{currentUser.role === 'admin' ? '管理员' : '普通用户'}</span>
              </div>
            </SettingsRow>
          </>
        ) : null}
        {authRequired && (
          <SettingsRow
            label="安全认证"
            hint={authMode === 'pocketbase' ? '管理当前登录账号。' : '管理用于访问此实例的令牌。'}
          >
            {authMode === 'pocketbase' ? (
              <button className="ghost-button" type="button" onClick={onLogout}>
                退出登录
              </button>
            ) : (
              <button className="ghost-button" type="button" onClick={onOpenAuth}>
                更新令牌
              </button>
            )}
          </SettingsRow>
        )}
      </section>
    </>
  );
}
