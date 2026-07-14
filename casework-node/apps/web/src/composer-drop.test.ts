import { describe, expect, it, vi } from 'vitest';

import { attachDroppedFiles, fileListToArray, hasDraggedFiles } from './composer-drop';

describe('composer drop helpers', () => {
  it('detects file drags from DataTransfer types', () => {
    expect(hasDraggedFiles({ types: ['Files'] })).toBe(true);
    expect(hasDraggedFiles({ types: ['text/plain', 'Files'] })).toBe(true);
    expect(hasDraggedFiles({ types: ['text/plain'] })).toBe(false);
    expect(hasDraggedFiles(null)).toBe(false);
  });

  it('turns a file list into an array of files', () => {
    const files = [
      new File(['hello'], 'a.txt', { type: 'text/plain' }),
      new File(['world'], 'b.txt', { type: 'text/plain' }),
    ];
    const fileList = {
      0: files[0],
      1: files[1],
      length: 2,
      item: (index: number) => files[index] ?? null,
      [Symbol.iterator]: function* iterator() {
        yield files[0];
        yield files[1];
      },
    } as FileList;

    expect(fileListToArray(fileList).map((file) => file.name)).toEqual(['a.txt', 'b.txt']);
    expect(fileListToArray(null)).toEqual([]);
  });

  it('adds each dropped file through the provided attachment function', async () => {
    const addAttachment = vi.fn().mockResolvedValue(undefined);
    const files = [
      new File(['hello'], 'a.txt', { type: 'text/plain' }),
      new File(['world'], 'b.txt', { type: 'text/plain' }),
    ];

    await attachDroppedFiles(files, addAttachment);

    expect(addAttachment).toHaveBeenCalledTimes(2);
    expect(addAttachment).toHaveBeenNthCalledWith(1, files[0]);
    expect(addAttachment).toHaveBeenNthCalledWith(2, files[1]);
  });
});
