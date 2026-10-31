// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { CONFIRMATION_VALUE, isPrivilegedKey, readIntegrationConfig } from '../integration/config';

// Fake, non-functional values only.
const base = {
  OGLOG_IT_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  OGLOG_IT_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_FAKEFAKEFAKE',
  OGLOG_IT_USER_A_EMAIL: 'oglog-test-a@example.com',
  OGLOG_IT_USER_A_PASSWORD: 'fake-password-a',
  OGLOG_IT_USER_B_EMAIL: 'oglog-test-b@example.com',
  OGLOG_IT_USER_B_PASSWORD: 'fake-password-b',
  OGLOG_IT_CONFIRM: CONFIRMATION_VALUE,
};

const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify(payload))}.signature`;

describe('integration test configuration guard', () => {
  it('accepts a complete development configuration', () => {
    expect(readIntegrationConfig(base).ok).toBe(true);
    expect(readIntegrationConfig({ ...base, OGLOG_IT_SUPABASE_URL: 'http://127.0.0.1:54321' }).ok).toBe(true);
  });

  it('skips when anything is missing, naming only the variables', () => {
    const result = readIntegrationConfig({ ...base, OGLOG_IT_USER_B_PASSWORD: '' });
    expect(result).toEqual({ ok: false, reason: 'not configured (missing OGLOG_IT_USER_B_PASSWORD)' });
    expect(readIntegrationConfig({}).ok).toBe(false);
  });

  it('requires explicit confirmation that the project holds synthetic data only', () => {
    expect(readIntegrationConfig({ ...base, OGLOG_IT_CONFIRM: 'yes' }).ok).toBe(false);
  });

  it('refuses secret and service-role keys, which would bypass RLS', () => {
    for (const key of ['sb_secret_FAKE', jwt({ role: 'service_role' }), jwt({ role: 'authenticated' }), 'a.b.c']) {
      expect(isPrivilegedKey(key)).toBe(true);
      const result = readIntegrationConfig({ ...base, OGLOG_IT_SUPABASE_PUBLISHABLE_KEY: key });
      expect(result.ok).toBe(false);
    }
    expect(isPrivilegedKey(jwt({ role: 'anon' }))).toBe(false);
    expect(isPrivilegedKey('sb_publishable_FAKE')).toBe(false);
  });

  it('rejects unexpected URLs and identical test users', () => {
    expect(readIntegrationConfig({ ...base, OGLOG_IT_SUPABASE_URL: 'https://example.com' }).ok).toBe(false);
    expect(readIntegrationConfig({ ...base, OGLOG_IT_USER_B_EMAIL: 'OGLOG-TEST-A@example.com' }).ok).toBe(false);
  });

  it('never includes configured values in its messages', () => {
    const secretish = { ...base, OGLOG_IT_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_DO_NOT_PRINT', OGLOG_IT_CONFIRM: 'nope' };
    for (const env of [secretish, { ...base, OGLOG_IT_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_DO_NOT_PRINT' }]) {
      const result = readIntegrationConfig(env);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).not.toContain('DO_NOT_PRINT');
        expect(result.reason).not.toContain('fake-password');
      }
    }
  });
});
