import { formatDate } from '../../../ui-utils';
import { SettingsSectionTitle } from './SettingsRow';

export function FileMetaList({
  title,
  items,
}: {
  title: string;
  items: Array<{ name: string; path: string; updated_at: string; size: number }>;
}) {
  return (
    <div className="settings-list-wrapper">
      <div className="settings-row-label mb-2 px-1">{title}</div>
      <div className="settings-list">
        {items.length ? (
          items.map((item) => (
            <div key={item.path} className="settings-list-item">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{item.name}</span>
                <span className="text-[11px] text-muted-foreground">{formatDate(item.updated_at)}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 truncate">{item.path}</div>
            </div>
          ))
        ) : (
          <div className="settings-empty text-xs py-3">暂无记录</div>
        )}
      </div>
    </div>
  );
}
