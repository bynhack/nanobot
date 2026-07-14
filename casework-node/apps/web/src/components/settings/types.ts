export type AppearanceMode = 'system' | 'light' | 'dark';
export type UiTheme = 'hr' | 'business' | 'gov';
export type SettingsTab = 'general' | 'skills' | 'config' | 'runtime';
export const DEFAULT_UI_THEME: UiTheme = 'hr';

export const APPEARANCE_OPTIONS: Array<{ value: AppearanceMode; label: string }> = [
  { value: 'system', label: '自动' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

export const UI_THEME_OPTIONS: Array<{
  value: UiTheme;
  label: string;
  description: string;
}> = [
  { value: 'hr', label: '清爽浅色', description: '轻灰基底、低装饰，适合高频信息处理与日常操作。' },
  { value: 'business', label: '企业中性', description: '通用企业风格，克制稳妥。' },
  { value: 'gov', label: '政务严肃', description: '低饱和、强秩序，更适合政务与公安。' },
];

export const SETTINGS_TABS: Array<{ value: SettingsTab; label: string; icon: string }> = [
  { value: 'general', label: '常规', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
  { value: 'skills', label: '技能', icon: 'M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.257c.938-.332 1.948-.512 3-.512a8.967 8.967 0 016 2.292m0-14.25v14.25m0-14.25a8.967 8.967 0 016-2.292c1.052 0 2.062.18 3 .512v14.257c-.938-.332-1.948-.512-3-.512a8.967 8.967 0 00-6 2.292' },
  { value: 'config', label: '配置', icon: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4' },
  { value: 'runtime', label: '数据', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
];
