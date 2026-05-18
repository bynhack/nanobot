import { describe, expect, it } from 'vitest';

import { streamdownZhTranslations } from './streamdown-i18n';

describe('streamdown i18n', () => {
  it('uses Chinese labels for visible tool controls', () => {
    expect(streamdownZhTranslations.copyCode).toBe('复制代码');
    expect(streamdownZhTranslations.downloadImage).toBe('下载图片');
    expect(streamdownZhTranslations.copyTable).toBe('复制表格');
    expect(streamdownZhTranslations.downloadTable).toBe('下载表格');
    expect(streamdownZhTranslations.viewFullscreen).toBe('全屏查看');
    expect(streamdownZhTranslations.exitFullscreen).toBe('退出全屏');
  });
});
