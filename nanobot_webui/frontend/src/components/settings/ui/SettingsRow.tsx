import { ReactNode } from 'react';

interface SettingsRowProps {
  label: string;
  hint?: ReactNode;
  children?: ReactNode;
  vertical?: boolean;
}

export function SettingsRow({ label, hint, children, vertical = false }: SettingsRowProps) {
  return (
    <div className={`settings-row ${vertical ? 'is-vertical' : ''}`}>
      <div className="settings-row-info">
        <div className="settings-row-label">{label}</div>
        {hint && <div className="settings-row-hint">{hint}</div>}
      </div>
      {children && (
        <div className="settings-row-action">
          {children}
        </div>
      )}
    </div>
  );
}

export function SettingsSectionTitle({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="settings-header">
      <h3 className="settings-header-title">{title}</h3>
      {subtitle && <p className="settings-header-subtitle">{subtitle}</p>}
    </div>
  );
}
