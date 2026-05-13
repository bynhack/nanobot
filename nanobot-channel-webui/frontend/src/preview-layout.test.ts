import { describe, expect, it } from 'vitest';

import {
  DETAIL_PANEL_MAX_WIDTH,
  getPreferredDetailPanelWidth,
  shouldUseImmersivePreview,
} from './preview-layout';

describe('preview layout helpers', () => {
  it('enters immersive preview only on sufficiently wide viewports', () => {
    expect(shouldUseImmersivePreview(1179)).toBe(false);
    expect(shouldUseImmersivePreview(1180)).toBe(true);
  });

  it('prefers a large preview width but keeps it bounded', () => {
    expect(getPreferredDetailPanelWidth(1280)).toBe(922);
    expect(getPreferredDetailPanelWidth(900)).toBe(720);
    expect(getPreferredDetailPanelWidth(2200)).toBe(1584);
    expect(getPreferredDetailPanelWidth(2400)).toBe(DETAIL_PANEL_MAX_WIDTH);
  });
});
