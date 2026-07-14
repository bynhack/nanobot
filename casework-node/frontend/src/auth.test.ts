import { describe, expect, test } from 'vitest';

import { createAuthState } from './auth-store';

describe('auth-store', () => {
  test('starts unauthenticated', () => {
    const state = createAuthState();

    expect(state.status).toBe('anonymous');
    expect(state.token).toBe('');
    expect(state.user).toBeNull();
  });
});
