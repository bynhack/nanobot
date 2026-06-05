import { describe, expect, it } from 'vitest';

import {
  DETAIL_PANEL_MAX_WIDTH,
  clampDetailWidth,
  getPreferredDetailPanelWidth,
  shouldUseImmersivePreview,
} from './preview-layout';

describe('preview layout helpers', () => {
  it('enters immersive preview only on sufficiently wide viewports', () => {
    expect(shouldUseImmersivePreview(1179)).toBe(false);
    expect(shouldUseImmersivePreview(1180)).toBe(true);
  });

  it('prefers a large preview width but keeps it bounded', () => {
    expect(getPreferredDetailPanelWidth(1280)).toBe(720);
    expect(getPreferredDetailPanelWidth(900)).toBe(720);
    expect(getPreferredDetailPanelWidth(390)).toBe(390);
    expect(getPreferredDetailPanelWidth(2200)).toBe(1144);
    expect(getPreferredDetailPanelWidth(3200)).toBe(DETAIL_PANEL_MAX_WIDTH);
  });

  it('keeps non-immersive detail panels inside narrow viewports', () => {
    expect(clampDetailWidth(720, 390, false, false)).toBe(390);
  });
});
