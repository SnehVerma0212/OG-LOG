import { beforeEach, describe, expect, it } from 'vitest';

import { removeLegacySessions, tabScopedStorage } from './supabaseClient';

describe('session storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('keeps the session in sessionStorage, never localStorage', () => {
    const storage = tabScopedStorage(window.sessionStorage, window.localStorage);
    void storage.setItem('sb-abcdefghijklmnopqrst-auth-token', '{"access_token":"fake"}');
    expect(window.sessionStorage.getItem('sb-abcdefghijklmnopqrst-auth-token')).toBe('{"access_token":"fake"}');
    expect(window.localStorage.length).toBe(0);
    expect(storage.getItem('sb-abcdefghijklmnopqrst-auth-token')).toBe('{"access_token":"fake"}');
    void storage.removeItem('sb-abcdefghijklmnopqrst-auth-token');
    expect(window.sessionStorage.length).toBe(0);
  });

  it('keeps only the PKCE code verifier in localStorage, so reset links work in a new tab', () => {
    const storage = tabScopedStorage(window.sessionStorage, window.localStorage);
    void storage.setItem('sb-abcdefghijklmnopqrst-auth-token-code-verifier', 'fake-verifier/PASSWORD_RECOVERY');
    expect(window.localStorage.getItem('sb-abcdefghijklmnopqrst-auth-token-code-verifier')).toBe('fake-verifier/PASSWORD_RECOVERY');
    expect(window.sessionStorage.length).toBe(0);
  });

  it('removes sessions that earlier versions left in localStorage', () => {
    window.localStorage.setItem('sb-abcdefghijklmnopqrst-auth-token', '{"access_token":"old"}');
    window.localStorage.setItem('unrelated', 'kept');
    removeLegacySessions(window.localStorage);
    expect(window.localStorage.getItem('sb-abcdefghijklmnopqrst-auth-token')).toBeNull();
    expect(window.localStorage.getItem('unrelated')).toBe('kept');
  });

  it('works without storage (blocked site data)', () => {
    const storage = tabScopedStorage(null, null);
    expect(storage.getItem('anything')).toBeNull();
    expect(() => storage.setItem('anything', 'x')).not.toThrow();
  });
});
