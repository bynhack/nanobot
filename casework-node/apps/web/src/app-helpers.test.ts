import { describe, expect, it } from 'vitest';

import { mediaToParts } from './app-helpers';

describe('mediaToParts', () => {
  it('keeps assistant image parts only for data URLs', () => {
    expect(
      mediaToParts([
        {
          url: 'data:image/png;base64,ZmFrZQ==',
          name: 'inline.png',
          mime: 'image/png',
        },
      ]),
    ).toEqual([
      {
        type: 'image',
        image: 'data:image/png;base64,ZmFrZQ==',
        filename: 'inline.png',
      },
    ]);
  });

  it('maps remote image URLs to file parts so assistant-ui does not discard them', () => {
    expect(
      mediaToParts([
        {
          url: 'https://example.com/cat.png',
          name: 'cat.png',
          mime: 'image/png',
        },
      ]),
    ).toEqual([
      {
        type: 'file',
        data: 'https://example.com/cat.png',
        filename: 'cat.png',
        mimeType: 'image/png',
      },
    ]);
  });
});
