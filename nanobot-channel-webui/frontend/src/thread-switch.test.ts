import { describe, expect, it } from 'vitest';

import { createThreadSwitchGuard } from './thread-switch';

describe('thread switch guard', () => {
  it('marks only the latest switch request as current', () => {
    const guard = createThreadSwitchGuard();

    const first = guard.begin();
    const second = guard.begin();

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });
});
