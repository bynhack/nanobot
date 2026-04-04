import { useState } from 'react';

import { GeneralTab } from './components/settings/tabs/GeneralTab';
import { SkillsTab } from './components/settings/tabs/SkillsTab';
import { ConfigTab } from './components/settings/tabs/ConfigTab';
import { RuntimeTab } from './components/settings/tabs/RuntimeTab';
import { SETTINGS_TABS, SettingsTab, ThemePreference } from './components/settings/types';
import type { AppState } from './types';
import { connectionStatusText } from './ui-utils';

export type { ThemePreference, SettingsTab };

export function SettingsScreen({
  authRequired,
  connectionState,
  currentChatId,
  onBack,
  onOpenAuth,
  themePreference,
  onThemeChange,
  token,
}: {
  authRequired: boolean;
  connectionState: AppState['connectionState'];
  currentChatId: string | null;
  onBack: () => void;
  onOpenAuth: () => void;
  themePreference: ThemePreference;
  onThemeChange: (value: ThemePreference) => void;
  token: string;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  return (
    <div className="settings-overlay" onClick={onBack}>
      <main className="settings-shell" onClick={(e) => e.stopPropagation()}>
        <div className="settings-layout">
          <aside className="settings-nav-sidebar">
            <header className="settings-sidebar-header">
              <button className="icon-button close-btn" type="button" onClick={onBack} aria-label="关闭">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </header>
            <nav className="settings-nav" aria-label="设置导航">
              {SETTINGS_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  className={`settings-nav-item${activeTab === tab.value ? ' active' : ''}`}
                  onClick={() => setActiveTab(tab.value)}
                >
                  <svg className="settings-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
                  </svg>
                  <span className="settings-nav-label">{tab.label}</span>
                </button>
              ))}
            </nav>
          </aside>
          <div className="settings-content-wrapper">
            <header className="settings-content-header">
              <h2 className="settings-content-title">
                {SETTINGS_TABS.find(t => t.value === activeTab)?.label}
              </h2>
              <div className={`status-badge ${connectionState}`}>
                <span className="status-dot" />
                <span>{connectionStatusText(connectionState)}</span>
              </div>
            </header>
            <div className="settings-content-body">
              <div className="settings-content-inner">
                {activeTab === 'general' && (
                  <GeneralTab
                    connectionState={connectionState}
                    currentChatId={currentChatId}
                    authRequired={authRequired}
                    onOpenAuth={onOpenAuth}
                    themePreference={themePreference}
                    onThemeChange={onThemeChange}
                  />
                )}
                {activeTab === 'skills' && <SkillsTab token={token} />}
                {activeTab === 'config' && <ConfigTab token={token} />}
                {activeTab === 'runtime' && <RuntimeTab token={token} />}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
