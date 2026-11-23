// Configuration for the real-Supabase integration tests, read from
// web/.env.integration.local (git-ignored). Values are never logged: every
// message names a variable, never its contents.

import { isPrivilegedKey } from '../../src/lib/supabaseKeys';

export interface IntegrationConfig {
  url: string;
  publishableKey: string;
  userA: { email: string; password: string };
  userB: { email: string; password: string };
}

export type IntegrationConfigResult = { ok: true; config: IntegrationConfig } | { ok: false; reason: string };

export const CONFIRMATION_VALUE = 'synthetic-dev-project';

const REQUIRED = [
  'OGLOG_IT_SUPABASE_URL',
  'OGLOG_IT_SUPABASE_PUBLISHABLE_KEY',
  'OGLOG_IT_USER_A_EMAIL',
  'OGLOG_IT_USER_A_PASSWORD',
  'OGLOG_IT_USER_B_EMAIL',
  'OGLOG_IT_USER_B_PASSWORD',
  'OGLOG_IT_CONFIRM',
] as const;

const HOSTED_URL = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const LOCAL_URL = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/;

export function readIntegrationConfig(env: Record<string, string | undefined>): IntegrationConfigResult {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) {
    return { ok: false, reason: `not configured (missing ${missing.join(', ')})` };
  }
  const value = (name: (typeof REQUIRED)[number]) => env[name]!.trim();

  if (value('OGLOG_IT_CONFIRM') !== CONFIRMATION_VALUE) {
    return {
      ok: false,
      reason: `OGLOG_IT_CONFIRM must be "${CONFIRMATION_VALUE}" to confirm the target is a development project with synthetic data only`,
    };
  }

  const url = value('OGLOG_IT_SUPABASE_URL').replace(/\/+$/, '');
  if (!HOSTED_URL.test(url) && !LOCAL_URL.test(url)) {
    return { ok: false, reason: 'OGLOG_IT_SUPABASE_URL must be https://<project-ref>.supabase.co or a local http://127.0.0.1:<port> URL' };
  }

  const key = value('OGLOG_IT_SUPABASE_PUBLISHABLE_KEY');
  if (isPrivilegedKey(key)) {
    return {
      ok: false,
      reason: 'OGLOG_IT_SUPABASE_PUBLISHABLE_KEY looks like a secret/service-role key. Use the publishable (or legacy anon) key only.',
    };
  }

  const userA = { email: value('OGLOG_IT_USER_A_EMAIL'), password: value('OGLOG_IT_USER_A_PASSWORD') };
  const userB = { email: value('OGLOG_IT_USER_B_EMAIL'), password: value('OGLOG_IT_USER_B_PASSWORD') };
  if (userA.email.toLowerCase() === userB.email.toLowerCase()) {
    return { ok: false, reason: 'OGLOG_IT_USER_A_EMAIL and OGLOG_IT_USER_B_EMAIL must be two different synthetic accounts' };
  }

  return { ok: true, config: { url, publishableKey: key, userA, userB } };
}

// Secret keys bypass Row Level Security, which would make every isolation test
// meaningless. The same check guards the website's configuration.
export { isPrivilegedKey };
