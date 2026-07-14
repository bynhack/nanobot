import { describe, expect, it } from 'vitest';

import { DEFAULT_UI_THEME, UI_THEME_OPTIONS } from './components/settings/types';

describe('business theme options', () => {
  it('uses the clean light theme by default', () => {
    expect(DEFAULT_UI_THEME).toBe('hr');
    expect(UI_THEME_OPTIONS[0]).toMatchObject({
      value: 'hr',
      label: '清爽浅色',
    });
  });
});
