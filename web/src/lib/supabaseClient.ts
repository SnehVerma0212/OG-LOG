import { createClient, type SupabaseClient, type SupportedStorage } from '@supabase/supabase-js';

import type { SupabaseConfig } from './supabaseConfig';

// One client per page, created with the publishable key only, refreshing the
// session automatically. PKCE: no tokens ever appear in URLs.
//
// The session is kept in sessionStorage: it survives a reload but ends when
// the tab or browser is closed, and is never written to disk-backed
// localStorage. Only the short-lived PKCE code verifier (not a credential on
// its own) goes to localStorage, because reset links usually open in a new tab.
export function createSupabaseClient(config: SupabaseConfig): SupabaseClient {
  removeLegacySessions(safeStorage(() => window.localStorage));
  return createClient(config.url, config.publishableKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: tabScopedStorage(safeStorage(() => window.sessionStorage), safeStorage(() => window.localStorage)),
    },
  });
}

export function tabScopedStorage(session: Storage | null, local: Storage | null): SupportedStorage {
  const pick = (key: string) => (key.endsWith('-code-verifier') ? local : session);
  return {
    getItem: (key) => attempt(() => pick(key)?.getItem(key) ?? null, null),
    setItem: (key, value) => attempt(() => pick(key)?.setItem(key, value), undefined),
    removeItem: (key) => attempt(() => pick(key)?.removeItem(key), undefined),
  };
}

// Earlier versions kept sessions in localStorage (`sb-<project>-auth-token`).
export function removeLegacySessions(local: Storage | null) {
  if (!local) {
    return;
  }
  for (const key of Object.keys(local)) {
    if (/^sb-.+-auth-token$/.test(key)) {
      attempt(() => local.removeItem(key), undefined);
    }
  }
}

function safeStorage(get: () => Storage): Storage | null {
  return attempt(get, null);
}

function attempt<T>(work: () => T, fallback: T): T {
  try {
    return work();
  } catch {
    return fallback; // Storage disabled (private mode, blocked site data).
  }
}
