import { isPrivilegedKey } from './supabaseKeys';

// The website's Supabase connection, read from Vite environment variables
// (web/.env.local, git-ignored). Only the project URL and the publishable key
// may ever be given to the browser. Messages name variables, never values.

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

export type SupabaseConfigResult = { ok: true; config: SupabaseConfig } | { ok: false; reason: string };

const HOSTED_URL = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const LOCAL_URL = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/;

export function readSupabaseConfig(env: Record<string, unknown>): SupabaseConfigResult {
  const url = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.trim().replace(/\/+$/, '') : '';
  const key = typeof env.VITE_SUPABASE_PUBLISHABLE_KEY === 'string' ? env.VITE_SUPABASE_PUBLISHABLE_KEY.trim() : '';
  const missing = [!url && 'VITE_SUPABASE_URL', !key && 'VITE_SUPABASE_PUBLISHABLE_KEY'].filter(Boolean);
  if (missing.length > 0) {
    return { ok: false, reason: `Missing ${missing.join(' and ')}.` };
  }
  if (!HOSTED_URL.test(url) && !LOCAL_URL.test(url)) {
    return { ok: false, reason: 'VITE_SUPABASE_URL must be https://<project-ref>.supabase.co or a local http://127.0.0.1:<port> URL.' };
  }
  if (isPrivilegedKey(key)) {
    // Refuse to start rather than ship a key that bypasses Row Level Security.
    return {
      ok: false,
      reason: 'VITE_SUPABASE_PUBLISHABLE_KEY looks like a secret or service-role key. Use the publishable key only, and rotate the secret key if it was exposed.',
    };
  }
  return { ok: true, config: { url, publishableKey: key } };
}
