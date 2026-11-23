import { describe, expect, it } from 'vitest';

import { readSupabaseConfig } from './supabaseConfig';

// Fake, non-functional values only.
const URL_VALUE = 'https://abcdefghijklmnopqrst.supabase.co';
const KEY_VALUE = 'sb_publishable_FAKEFAKEFAKE';
const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify(payload))}.signature`;

describe('website Supabase configuration', () => {
  it('accepts a project URL with a publishable or legacy anon key', () => {
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: `${URL_VALUE}/`, VITE_SUPABASE_PUBLISHABLE_KEY: KEY_VALUE })).toEqual({
      ok: true,
      config: { url: URL_VALUE, publishableKey: KEY_VALUE },
    });
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: URL_VALUE, VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'anon' }) }).ok).toBe(true);
  });

  it('names missing variables without values', () => {
    expect(readSupabaseConfig({})).toEqual({ ok: false, reason: 'Missing VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.' });
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: URL_VALUE })).toEqual({ ok: false, reason: 'Missing VITE_SUPABASE_PUBLISHABLE_KEY.' });
  });

  it('refuses secret and service-role keys without echoing them', () => {
    for (const key of ['sb_secret_FAKEFAKEFAKE', jwt({ role: 'service_role' }), 'aaa.bbb.ccc']) {
      const result = readSupabaseConfig({ VITE_SUPABASE_URL: URL_VALUE, VITE_SUPABASE_PUBLISHABLE_KEY: key });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(key);
    }
  });

  it('refuses URLs that are not a Supabase project or the local stack', () => {
    for (const url of ['http://abcdefghijklmnopqrst.supabase.co', 'https://evil.example', 'https://abc.supabase.co.evil.example']) {
      expect(readSupabaseConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: KEY_VALUE }).ok).toBe(false);
    }
  });
});
