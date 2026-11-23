import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';

import {
  authErrorMessage,
  type AuthResult,
  type AuthService,
  type AuthState,
  type AuthUser,
  type EmailLinkType,
  type MfaEnrollment,
  MFA_CODE,
  type SignedOutReason,
} from './authService';

// Supabase Auth behind the AuthService contract. Subscribes as soon as it is
// constructed (right after the client), so the PASSWORD_RECOVERY event that
// supabase-js emits while reading a reset link is never missed.
//
// After every sign-in or session restore it reads the user's own
// profiles.password_change_required flag from the database before opening
// the app. The flag is set and cleared only on the server (see migration
// 20261102120000); while it is set, Row Level Security also blocks all case
// data, so this check decides what to show, not what is allowed.
export class SupabaseAuthService implements AuthService {
  private state: AuthState = { status: 'loading' };
  private readonly listeners = new Set<() => void>();
  private signingOut = false;
  // Only the latest account check may set the state.
  private checkSequence = 0;

  constructor(
    private readonly client: SupabaseClient,
    private readonly resetRedirectUrl: string,
  ) {
    client.auth.onAuthStateChange((event, session) => this.onAuthEvent(event, session));
  }

  getState(): AuthState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    const { error } = await this.client.auth.signInWithPassword({ email: email.trim(), password });
    return error ? { ok: false, message: authErrorMessage(error) } : { ok: true };
  }

  async signOut(reason: 'signedOut' | 'idle' | 'accountDeleted' = 'signedOut'): Promise<void> {
    this.signingOut = true;
    try {
      // 'local' ends this browser's session only. supabase-js clears the local
      // session even if the server cannot be reached.
      await this.client.auth.signOut({ scope: 'local' });
    } finally {
      this.signingOut = false;
      this.checkSequence += 1;
      this.setState({ status: 'signedOut', reason });
    }
  }

  async requestPasswordReset(email: string): Promise<AuthResult> {
    const { error } = await this.client.auth.resetPasswordForEmail(email.trim(), { redirectTo: this.resetRedirectUrl });
    // Only rate limits and connection failures are reported; any other outcome
    // looks like success, so the page never reveals whether an account exists.
    if (error && (error.status === 429 || error.name === 'AuthRetryableFetchError' || error.status === 0)) {
      return { ok: false, message: authErrorMessage(error) };
    }
    return { ok: true };
  }

  async updatePassword(password: string, code?: string): Promise<AuthResult> {
    // A reset-link session is password-less (aal1). If the doctor has two-step
    // verification on, Supabase refuses the new password (insufficient_aal)
    // until this session has also passed the authenticator code.
    const assurance = await this.client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!assurance.error && assurance.data.nextLevel === 'aal2' && assurance.data.currentLevel !== 'aal2') {
      const factorId = await this.verifiedFactorId();
      if (factorId) {
        if (!MFA_CODE.test(code ?? '')) {
          return { ok: false, message: 'Enter the 6-digit code from your authenticator app.' };
        }
        const verified = await this.client.auth.mfa.challengeAndVerify({ factorId, code: code! });
        if (verified.error) {
          return {
            ok: false,
            message:
              verified.error.status === 429
                ? authErrorMessage(verified.error)
                : 'The authenticator code is not correct. Wait for a new code and try again.',
          };
        }
      }
    }
    const { data, error } = await this.client.auth.updateUser({ password });
    if (error) {
      return { ok: false, message: authErrorMessage(error) };
    }
    if (data.user) {
      // The database clears the first-login flag when the password changes;
      // read it back rather than assuming.
      await this.checkAccount(toUser(data.user));
    }
    if (this.state.status === 'passwordChangeRequired') {
      return {
        ok: false,
        message: 'Your password was changed, but the server still requires a new one. Contact the administrator.',
      };
    }
    return { ok: true };
  }

  async changePassword(currentPassword: string, newPassword: string, code?: string): Promise<AuthResult> {
    const confirmed = await this.reauthenticate(currentPassword, code);
    return confirmed.ok ? this.updatePassword(newPassword) : confirmed;
  }

  async reauthenticate(password: string, code?: string): Promise<AuthResult> {
    const user = 'user' in this.state ? this.state.user : null;
    if (!user?.email) {
      return { ok: false, message: 'Sign in again to continue.' };
    }
    const factorId = await this.verifiedFactorId();
    if (factorId && !MFA_CODE.test(code ?? '')) {
      return { ok: false, message: 'Enter the 6-digit code from your authenticator app.' };
    }
    // Signing in again proves the password (and satisfies Supabase's optional
    // "secure password change"); with two-step verification, the code follows.
    const { error } = await this.client.auth.signInWithPassword({ email: user.email, password });
    if (error) {
      return {
        ok: false,
        message: error.code === 'invalid_credentials' ? 'Your current password is incorrect.' : authErrorMessage(error),
      };
    }
    let result: AuthResult = { ok: true };
    if (factorId) {
      const verified = await this.client.auth.mfa.challengeAndVerify({ factorId, code: code! });
      if (verified.error) {
        result = { ok: false, message: 'The authenticator code is not correct. Wait for a new code and try again.' };
      }
    }
    await this.checkAccount(user);
    return result;
  }

  async mfaStatus(): Promise<{ enrolled: boolean }> {
    return { enrolled: (await this.verifiedFactorId()) !== null };
  }

  async verifyMfa(code: string): Promise<AuthResult> {
    const user = 'user' in this.state ? this.state.user : null;
    const factorId = await this.verifiedFactorId();
    if (!user || !factorId) {
      return { ok: false, message: 'Sign in again to continue.' };
    }
    if (!MFA_CODE.test(code)) {
      return { ok: false, message: 'Enter the 6-digit code from your authenticator app.' };
    }
    const { error } = await this.client.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) {
      return {
        ok: false,
        message: error.status === 429 ? authErrorMessage(error) : 'The code is not correct. Wait for a new code and try again.',
      };
    }
    await this.checkAccount(user);
    return { ok: true };
  }

  async startMfaEnrollment(): Promise<MfaEnrollment | { ok: false; message: string }> {
    // Abandoned set-ups leave unverified factors; remove them first.
    const { data: factors } = await this.client.auth.mfa.listFactors();
    for (const factor of factors?.all ?? []) {
      if (factor.status !== 'verified') {
        await this.client.auth.mfa.unenroll({ factorId: factor.id });
      }
    }
    const { data, error } = await this.client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'OG-LOG authenticator' });
    if (error || !data || data.type !== 'totp') {
      return { ok: false, message: 'Two-step verification could not be set up. Try again.' };
    }
    return { ok: true, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
  }

  async confirmMfaEnrollment(factorId: string, code: string): Promise<AuthResult> {
    if (!MFA_CODE.test(code)) {
      return { ok: false, message: 'Enter the 6-digit code from your authenticator app.' };
    }
    const { error } = await this.client.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) {
      return { ok: false, message: 'The code is not correct. Check the time on your phone, wait for a new code and try again.' };
    }
    if ('user' in this.state) {
      await this.checkAccount(this.state.user);
    }
    return { ok: true };
  }

  async disableMfa(): Promise<AuthResult> {
    const factorId = await this.verifiedFactorId();
    if (!factorId) {
      return { ok: true };
    }
    const { error } = await this.client.auth.mfa.unenroll({ factorId });
    if (error) {
      return { ok: false, message: 'Two-step verification could not be turned off. Sign in again and retry.' };
    }
    if ('user' in this.state) {
      await this.checkAccount(this.state.user);
    }
    return { ok: true };
  }

  private async verifiedFactorId(): Promise<string | null> {
    const { data, error } = await this.client.auth.mfa.listFactors();
    if (error) {
      return null;
    }
    return data?.totp.find((factor) => factor.status === 'verified')?.id ?? null;
  }

  async retryAccountCheck(): Promise<void> {
    if ('user' in this.state) {
      await this.checkAccount(this.state.user);
    }
  }

  async verifyEmailLink(tokenHash: string, type: EmailLinkType): Promise<AuthResult> {
    // On success supabase-js emits PASSWORD_RECOVERY (reset) or SIGNED_IN
    // (invitation); the usual handlers then route the user.
    const { error } = await this.client.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      if (error.status === 429 || error.name === 'AuthRetryableFetchError') {
        return { ok: false, message: authErrorMessage(error) };
      }
      return { ok: false, message: 'This link is invalid, has expired, or was already used.' };
    }
    return { ok: true };
  }

  async handleSessionExpired(): Promise<void> {
    await this.client.auth.signOut({ scope: 'local' });
    this.setState({ status: 'signedOut', reason: 'expired' });
  }

  private onAuthEvent(event: AuthChangeEvent, session: Session | null) {
    if (!session) {
      this.checkSequence += 1;
      let reason: SignedOutReason = this.state.status === 'signedOut' ? this.state.reason : 'none';
      if (this.signingOut) {
        reason = 'signedOut';
      } else if ('user' in this.state) {
        reason = 'expired'; // Not started here: the session expired or was revoked.
      }
      this.setState({ status: 'signedOut', reason });
      return;
    }
    const user = toUser(session.user);
    if (event === 'PASSWORD_RECOVERY') {
      this.checkSequence += 1;
      this.setState({ status: 'recovery', user });
      return;
    }
    const sameUser = 'user' in this.state && this.state.user.id === user.id && this.state.user.email === user.email;
    // Token refreshes and the initial session keep a pending recovery in place.
    if (this.state.status === 'recovery' && sameUser && event !== 'USER_UPDATED') {
      return;
    }
    if (sameUser && event !== 'USER_UPDATED') {
      return; // Token refresh or re-authentication: nothing changed.
    }
    if (!sameUser) {
      this.setState({ status: 'loading' });
    }
    // supabase-js must not be called from inside this callback, so the
    // database read runs just after it. Numbered now, so a sign-out in
    // between makes its result stale.
    const sequence = ++this.checkSequence;
    setTimeout(() => void this.checkAccount(user, sequence), 0);
  }

  private async checkAccount(user: AuthUser, sequence = ++this.checkSequence): Promise<void> {
    let next: AuthState;
    try {
      // Two-step verification first: until the code is entered the database
      // returns no case data anyway.
      const assurance = await this.client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error) {
        throw assurance.error;
      }
      if (assurance.data.nextLevel === 'aal2' && assurance.data.currentLevel !== 'aal2') {
        if (sequence === this.checkSequence) {
          this.setState({ status: 'mfaRequired', user });
        }
        return;
      }
      const { data, error } = await this.client
        .from('profiles')
        .select('password_change_required')
        .eq('id', user.id)
        .maybeSingle();
      const row = data as { password_change_required?: unknown } | null;
      if (error || !row || typeof row.password_change_required !== 'boolean') {
        next = { status: 'accountCheckFailed', user }; // Fail closed.
      } else {
        next = row.password_change_required ? { status: 'passwordChangeRequired', user } : { status: 'signedIn', user };
      }
    } catch {
      next = { status: 'accountCheckFailed', user };
    }
    if (sequence === this.checkSequence) {
      this.setState(next);
    }
  }

  private setState(next: AuthState) {
    this.state = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function toUser(user: { id: string; email?: string | null }): AuthUser {
  return { id: user.id, email: user.email ?? null };
}
