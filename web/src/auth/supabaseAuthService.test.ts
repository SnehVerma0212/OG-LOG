import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { SupabaseAuthService } from './supabaseAuthService';

// A stand-in for supabase-js that emits the same auth events and serves the
// user's own profile row (the first-login flag). Synthetic user only.
function fakeClient() {
  let emit: (event: AuthChangeEvent, session: Session | null) => void = () => undefined;
  const server = {
    profile: { password_change_required: false } as { password_change_required: unknown } | null,
    profileError: null as { code: string; message: string } | null,
    profileReads: 0,
    // Two-step verification: whether a verified factor exists, and this session's level.
    mfaFactor: false,
    aal: 'aal1' as 'aal1' | 'aal2',
  };
  const mfa = {
    getAuthenticatorAssuranceLevel: vi.fn(async () => ({
      data: { currentLevel: server.aal, nextLevel: server.mfaFactor ? 'aal2' : 'aal1' },
      error: null,
    })),
    listFactors: vi.fn(async () => ({
      data: { all: server.mfaFactor ? [{ id: 'factor-1', status: 'verified' }] : [], totp: server.mfaFactor ? [{ id: 'factor-1', status: 'verified' }] : [] },
      error: null,
    })),
    challengeAndVerify: vi.fn(async ({ code }: { factorId: string; code: string }) => {
      if (code !== '246810') {
        return { data: null, error: { status: 422, code: 'mfa_verification_failed', name: 'AuthApiError' } };
      }
      server.aal = 'aal2';
      server.mfaFactor = true;
      return { data: {}, error: null };
    }),
    enroll: vi.fn(async () => ({ data: { id: 'factor-1', type: 'totp', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'S' } }, error: null })),
    unenroll: vi.fn(async () => {
      server.mfaFactor = false;
      server.aal = 'aal1';
      return { data: {}, error: null };
    }),
  };
  const auth = {
    mfa,
    onAuthStateChange: vi.fn((callback: typeof emit) => {
      emit = callback;
      return { data: { subscription: { unsubscribe: () => undefined } } };
    }),
    signInWithPassword: vi.fn(async (_credentials: { email: string; password: string }) => {
      server.aal = 'aal1'; // A new sign-in starts at password-only level.
      return { data: {}, error: null as unknown };
    }),
    signOut: vi.fn(async () => {
      emit('SIGNED_OUT', null);
      return { error: null };
    }),
    resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null as unknown })),
    updateUser: vi.fn(async () => {
      // As Supabase Auth does: with a verified factor, only an aal2 session
      // may set a password ("AAL2 session is required to update email or
      // password when MFA is enabled.").
      if (server.mfaFactor && server.aal !== 'aal2') {
        return { data: { user: null }, error: { status: 401, code: 'insufficient_aal', name: 'AuthApiError' } as unknown };
      }
      // As the database trigger does when the password hash changes.
      if (server.profile) {
        server.profile.password_change_required = false;
      }
      return { data: { user: { id: 'user-1', email: 'a@example.com' } }, error: null as unknown };
    }),
  };
  const from = vi.fn((table: string) => {
    expect(table).toBe('profiles');
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => {
        server.profileReads += 1;
        return { data: server.profileError ? null : server.profile, error: server.profileError };
      },
    };
    return chain;
  });
  return {
    client: { auth, from } as unknown as SupabaseClient,
    auth,
    server,
    emit: (event: AuthChangeEvent, session: Session | null) => emit(event, session),
  };
}

const session = (id = 'user-1', email = 'a@example.com') => ({ user: { id, email } }) as unknown as Session;
const USER = { id: 'user-1', email: 'a@example.com' };
// The account check starts just after the auth callback returns.
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const service = (client: SupabaseClient) => new SupabaseAuthService(client, 'https://app.example/reset-password');

describe('SupabaseAuthService', () => {
  it('stays loading until the account check confirms the password was already changed', async () => {
    const { client, emit } = fakeClient();
    const auth = service(client);
    expect(auth.getState()).toEqual({ status: 'loading' });

    emit('INITIAL_SESSION', session());
    expect(auth.getState()).toEqual({ status: 'loading' });
    await settle();
    expect(auth.getState()).toEqual({ status: 'signedIn', user: USER });
  });

  it('requires a new password when the server flags the account, including after a reload', async () => {
    const { client, emit, server } = fakeClient();
    server.profile = { password_change_required: true };
    const auth = service(client);
    emit('SIGNED_IN', session());
    await settle();
    expect(auth.getState()).toEqual({ status: 'passwordChangeRequired', user: USER });

    // A page reload restores the session; the flag is read from the server again.
    const reloaded = service(client);
    emit('INITIAL_SESSION', session());
    await settle();
    expect(reloaded.getState()).toEqual({ status: 'passwordChangeRequired', user: USER });
  });

  it('fails closed when the account status cannot be read', async () => {
    for (const setup of [
      (server: ReturnType<typeof fakeClient>['server']) => (server.profileError = { code: '42703', message: 'column does not exist' }),
      (server: ReturnType<typeof fakeClient>['server']) => (server.profile = null),
      (server: ReturnType<typeof fakeClient>['server']) => (server.profile = { password_change_required: 'no' }),
    ]) {
      const { client, emit, server } = fakeClient();
      setup(server);
      const auth = service(client);
      emit('SIGNED_IN', session());
      await settle();
      expect(auth.getState()).toEqual({ status: 'accountCheckFailed', user: USER });
    }
  });

  it('can retry a failed account check', async () => {
    const { client, emit, server } = fakeClient();
    server.profileError = { code: 'PGRST000', message: 'connection' };
    const auth = service(client);
    emit('SIGNED_IN', session());
    await settle();
    server.profileError = null;
    await auth.retryAccountCheck();
    expect(auth.getState()).toEqual({ status: 'signedIn', user: USER });
  });

  it('reports no saved session as plainly signed out', () => {
    const { client, emit } = fakeClient();
    const auth = service(client);
    emit('INITIAL_SESSION', null);
    expect(auth.getState()).toEqual({ status: 'signedOut', reason: 'none' });
  });

  it('does not re-check or notify screens on token refreshes for the same user', async () => {
    const { client, emit, server } = fakeClient();
    const auth = service(client);
    emit('SIGNED_IN', session());
    await settle();
    const listener = vi.fn();
    auth.subscribe(listener);
    emit('TOKEN_REFRESHED', session());
    await settle();
    expect(listener).not.toHaveBeenCalled();
    expect(server.profileReads).toBe(1);
  });

  it('ignores an account check that finishes after sign-out', async () => {
    const { client, emit } = fakeClient();
    const auth = service(client);
    emit('SIGNED_IN', session());
    await auth.signOut(); // Before the check has run.
    await settle();
    expect(auth.getState()).toEqual({ status: 'signedOut', reason: 'signedOut' });
  });

  it('treats a sign-out it did not start as an expired session', async () => {
    const { client, emit } = fakeClient();
    const auth = service(client);
    emit('SIGNED_IN', session());
    await settle();
    emit('SIGNED_OUT', null); // e.g. the refresh token expired or was revoked
    expect(auth.getState()).toEqual({ status: 'signedOut', reason: 'expired' });
  });

  it('signs out this browser only and reports it as a deliberate sign-out', async () => {
    const { client, auth: supabaseAuth, emit } = fakeClient();
    const auth = service(client);
    emit('SIGNED_IN', session());
    await settle();
    await auth.signOut();
    expect(supabaseAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(auth.getState()).toEqual({ status: 'signedOut', reason: 'signedOut' });
  });

  it('opens the app after the first-login password change, once the server has cleared the flag', async () => {
    const { client, emit, server } = fakeClient();
    server.profile = { password_change_required: true };
    const auth = service(client);
    emit('SIGNED_IN', session());
    await settle();

    expect(await auth.updatePassword('a-new-synthetic-pass')).toEqual({ ok: true });
    expect(auth.getState()).toEqual({ status: 'signedIn', user: USER });
  });

  it('does not open the app if the server still flags the account after a password change', async () => {
    const { client, emit, server, auth: supabaseAuth } = fakeClient();
    server.profile = { password_change_required: true };
    supabaseAuth.updateUser.mockResolvedValueOnce({ data: { user: USER }, error: null }); // Flag not cleared.
    const auth = service(client);
    emit('SIGNED_IN', session());
    await settle();

    const result = await auth.updatePassword('a-new-synthetic-pass');
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/server still requires a new one/) });
    expect(auth.getState().status).toBe('passwordChangeRequired');
  });

  it('keeps a password-recovery session until the password is updated, then checks the account', async () => {
    const { client, emit, server, auth: supabaseAuth } = fakeClient();
    server.profile = { password_change_required: true }; // Recovery also replaces an initial password.
    const auth = service(client);
    emit('PASSWORD_RECOVERY', session());
    emit('INITIAL_SESSION', session());
    emit('TOKEN_REFRESHED', session());
    await settle();
    expect(auth.getState().status).toBe('recovery');

    expect(await auth.updatePassword('a-new-synthetic-pass')).toEqual({ ok: true });
    expect(auth.getState()).toEqual({ status: 'signedIn', user: USER });
    expect(supabaseAuth.mfa.challengeAndVerify).not.toHaveBeenCalled(); // No two-step verification: no code.
  });

  it('with two-step verification on, a reset link sets the password only after the authenticator code', async () => {
    const { client, emit, server, auth: supabaseAuth } = fakeClient();
    server.mfaFactor = true; // The reset-link session itself is aal1.
    const auth = service(client);
    emit('PASSWORD_RECOVERY', session());
    await settle();
    expect(auth.getState().status).toBe('recovery');

    expect(await auth.updatePassword('a-new-synthetic-pass')).toEqual({
      ok: false,
      message: 'Enter the 6-digit code from your authenticator app.',
    });
    expect(await auth.updatePassword('a-new-synthetic-pass', '000000')).toEqual({
      ok: false,
      message: expect.stringMatching(/authenticator code is not correct/),
    });
    expect(supabaseAuth.updateUser).not.toHaveBeenCalled();
    expect(auth.getState().status).toBe('recovery');

    expect(await auth.updatePassword('a-new-synthetic-pass', '246810')).toEqual({ ok: true });
    expect(supabaseAuth.signInWithPassword).not.toHaveBeenCalled(); // Recovery never signs in with a password.
    expect(supabaseAuth.updateUser).toHaveBeenCalledWith({ password: 'a-new-synthetic-pass' });
    expect(auth.getState()).toEqual({ status: 'signedIn', user: USER });

    // The next normal sign-in still needs the second step.
    emit('SIGNED_OUT', null);
    await auth.signIn('a@example.com', 'a-new-synthetic-pass');
    emit('SIGNED_IN', session());
    await settle();
    expect(auth.getState()).toEqual({ status: 'mfaRequired', user: USER });
  });

  it('explains a server refusal for a missing second step instead of reporting a failed sign-in', async () => {
    const { client, emit, server, auth: supabaseAuth } = fakeClient();
    server.mfaFactor = true;
    const auth = service(client);
    emit('PASSWORD_RECOVERY', session());
    await settle();
    // E.g. the factor was enrolled elsewhere after the assurance level was read.
    supabaseAuth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null });
    const result = await auth.updatePassword('a-new-synthetic-pass');
    expect(result).toEqual({ ok: false, message: 'Enter the 6-digit code from your authenticator app to continue.' });
    expect(auth.getState().status).toBe('recovery');
  });

  it('changes the password in Settings only after confirming the current one', async () => {
    const { client, emit, auth: supabaseAuth } = fakeClient();
    const auth = service(client);
    emit('SIGNED_IN', session());
    await settle();

    supabaseAuth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: { status: 400, code: 'invalid_credentials', name: 'AuthApiError' } });
    expect(await auth.changePassword('wrong-current', 'a-new-synthetic-pass')).toEqual({
      ok: false,
      message: 'Your current password is incorrect.',
    });
    expect(supabaseAuth.updateUser).not.toHaveBeenCalled();

    expect(await auth.changePassword('right-current', 'a-new-synthetic-pass')).toEqual({ ok: true });
    expect(supabaseAuth.signInWithPassword).toHaveBeenLastCalledWith({ email: 'a@example.com', password: 'right-current' });
    expect(supabaseAuth.updateUser).toHaveBeenCalledWith({ password: 'a-new-synthetic-pass' });
  });

  it('asks for the second step when the doctor has two-step verification on', async () => {
    const { client, emit, server } = fakeClient();
    server.mfaFactor = true;
    const auth = service(client);
    emit('SIGNED_IN', session());
    await settle();
    expect(auth.getState()).toEqual({ status: 'mfaRequired', user: USER });

    expect(await auth.verifyMfa('000000')).toEqual({ ok: false, message: expect.stringMatching(/code is not correct/) });
    expect(auth.getState().status).toBe('mfaRequired');
    expect(await auth.verifyMfa('246810')).toEqual({ ok: true });
    expect(auth.getState()).toEqual({ status: 'signedIn', user: USER });
  });

  it('re-confirms password and code before a sensitive change when two-step verification is on', async () => {
    const { client, emit, server, auth: supabaseAuth } = fakeClient();
    server.mfaFactor = true;
    server.aal = 'aal2';
    const auth = service(client);
    emit('SIGNED_IN', session());
    await settle();

    expect(await auth.reauthenticate('right-password')).toEqual({ ok: false, message: 'Enter the 6-digit code from your authenticator app.' });
    expect(supabaseAuth.signInWithPassword).not.toHaveBeenCalled();
    expect(await auth.reauthenticate('right-password', '246810')).toEqual({ ok: true });
    expect(auth.getState().status).toBe('signedIn');
  });

  it('sets up and turns off two-step verification', async () => {
    const { client, emit, auth: supabaseAuth } = fakeClient();
    const auth = service(client);
    emit('SIGNED_IN', session());
    await settle();
    expect(await auth.mfaStatus()).toEqual({ enrolled: false });

    const enrollment = await auth.startMfaEnrollment();
    expect(enrollment).toMatchObject({ ok: true, factorId: 'factor-1', qrCode: expect.stringMatching(/^data:image\/svg\+xml/) });
    expect(await auth.confirmMfaEnrollment('factor-1', '12345')).toMatchObject({ ok: false });
    expect(await auth.confirmMfaEnrollment('factor-1', '246810')).toEqual({ ok: true });
    expect(await auth.mfaStatus()).toEqual({ enrolled: true });
    expect(auth.getState().status).toBe('signedIn');

    expect(await auth.disableMfa()).toEqual({ ok: true });
    expect(supabaseAuth.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'factor-1' });
    expect(await auth.mfaStatus()).toEqual({ enrolled: false });
  });

  it('opens invitation and reset links with the single-use token', async () => {
    const { client, auth: supabaseAuth } = fakeClient();
    const verifyOtp = vi.fn(async () => ({ data: {}, error: null as unknown }));
    (supabaseAuth as unknown as { verifyOtp: typeof verifyOtp }).verifyOtp = verifyOtp;
    const auth = service(client);
    expect(await auth.verifyEmailLink('token-hash-value', 'invite')).toEqual({ ok: true });
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'token-hash-value', type: 'invite' });
    verifyOtp.mockResolvedValueOnce({ data: {}, error: { status: 403, code: 'otp_expired', name: 'AuthApiError' } });
    expect(await auth.verifyEmailLink('token-hash-value', 'recovery')).toEqual({
      ok: false,
      message: 'This link is invalid, has expired, or was already used.',
    });
  });

  it('requests resets with the approved redirect and never reveals whether an account exists', async () => {
    const { client, auth: supabaseAuth } = fakeClient();
    const auth = service(client);
    supabaseAuth.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: { status: 400, code: 'user_not_found', name: 'AuthApiError' } });
    expect(await auth.requestPasswordReset(' someone@example.com ')).toEqual({ ok: true });
    expect(supabaseAuth.resetPasswordForEmail).toHaveBeenCalledWith('someone@example.com', { redirectTo: 'https://app.example/reset-password' });

    supabaseAuth.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: { status: 429, code: 'over_email_send_rate_limit', name: 'AuthApiError' } });
    expect(await auth.requestPasswordReset('someone@example.com')).toEqual({ ok: false, message: expect.stringMatching(/Too many attempts/) });
  });

  it('maps sign-in failures to a generic message', async () => {
    const { client, auth: supabaseAuth } = fakeClient();
    const auth = service(client);
    supabaseAuth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: { status: 400, code: 'invalid_credentials', name: 'AuthApiError' } });
    expect(await auth.signIn('a@example.com', 'wrong')).toEqual({
      ok: false,
      message: 'Sign-in failed. Check your email and password, then try again.',
    });
  });

  it('signs out locally and reports expiry when data requests are rejected', async () => {
    const { client, auth: supabaseAuth, emit } = fakeClient();
    const auth = service(client);
    emit('SIGNED_IN', session());
    await settle();
    await auth.handleSessionExpired();
    expect(supabaseAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(auth.getState()).toEqual({ status: 'signedOut', reason: 'expired' });
  });
});
