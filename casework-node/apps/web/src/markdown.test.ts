import { describe, expect, it } from 'vitest';

import { normalizeInlineArtifacts, shouldRenderMarkdownForAssistant } from './markdown';

describe('normalizeInlineArtifacts', () => {
  it('converts common inline latex arrows to unicode', () => {
    expect(normalizeInlineArtifacts('[Image #1] $\\rightarrow$ Layer 3')).toBe('[Image #1] → Layer 3');
    expect(normalizeInlineArtifacts('$\\leftarrow$ back')).toBe('← back');
  });

  it('converts inline bold markers inside Chinese text', () => {
    expect(
      normalizeInlineArtifacts('识别是否存在**“快进快出”**（转入后极短时间内转出）的特征。'),
    ).toBe('识别是否存在<strong>“快进快出”</strong>（转入后极短时间内转出）的特征。');
  });

  it('leaves non-matching text unchanged', () => {
    expect(normalizeInlineArtifacts('[Image #1] normal text')).toBe('[Image #1] normal text');
  });

  it('disables markdown rendering while assistant text is still streaming', () => {
    expect(shouldRenderMarkdownForAssistant('running')).toBe(false);
    expect(shouldRenderMarkdownForAssistant('complete')).toBe(true);
    expect(shouldRenderMarkdownForAssistant(undefined)).toBe(true);
  });
});
