import type { AuthResult, AuthService, AuthState, EmailLinkType, MfaEnrollment } from '../auth/authService';

export const TEST_USER = { id: '11111111-1111-4111-8111-111111111111', email: 'oglog-test-a@example.com' };
export const TEST_PASSWORD = 'synthetic-password-1';
// The one code the fake authenticator accepts.
export const TEST_TOTP_CODE = '246810';

// What the fake "server" knows about the one synthetic account. Shared between
// FakeAuthService instances to simulate page reloads: a new instance restores
// its state from here, as the real app restores from Supabase.
export interface FakeAccount {
  password: string;
  passwordChangeRequired: boolean;
  mfaEnabled: boolean;
}

export const fakeAccount = (overrides: Partial<FakeAccount> = {}): FakeAccount => ({
  password: TEST_PASSWORD,
  passwordChangeRequired: false,
  mfaEnabled: false,
  ...overrides,
});

// TEST ONLY. An in-memory AuthService with one synthetic account. Tests drive
// it directly (signIn, expire, startRecovery) and observe what screens do.
export class FakeAuthService implements AuthService {
  private state: AuthState;
  private readonly listeners = new Set<() => void>();
  readonly calls = {
    signIn: 0,
    signOut: 0,
    reset: [] as string[],
    updatePassword: [] as string[],
    changePassword: 0,
    reauthenticate: 0,
    emailLinks: [] as { tokenHash: string; type: EmailLinkType }[],
  };
  // Single-use email-link tokens the fake "server" accepts.
  readonly validLinkTokens = new Set<string>();
  // Whether this browser session has completed the second step.
  private secondStep = false;
  nextError: string | null = null;

  // With no initial state, restores a signed-in session for `account`.
  constructor(
    initial?: AuthState,
    readonly account: FakeAccount = fakeAccount(),
  ) {
    this.state = initial ?? this.sessionState();
  }

  getState(): AuthState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    this.calls.signIn += 1;
    if (this.nextError) {
      return this.fail();
    }
    if (email.trim() !== TEST_USER.email || password !== this.account.password) {
      return { ok: false, message: 'Sign-in failed. Check your email and password, then try again.' };
    }
    this.secondStep = false;
    this.set(this.sessionState());
    return { ok: true };
  }

  async signOut(reason: 'signedOut' | 'idle' | 'accountDeleted' = 'signedOut'): Promise<void> {
    this.calls.signOut += 1;
    this.secondStep = false;
    this.set({ status: 'signedOut', reason });
  }

  async requestPasswordReset(email: string): Promise<AuthResult> {
    this.calls.reset.push(email);
    return this.nextError ? this.fail() : { ok: true };
  }

  async updatePassword(password: string, code?: string): Promise<AuthResult> {
    this.calls.updatePassword.push(password);
    if (this.nextError) {
      return this.fail();
    }
    // As Supabase does: with two-step verification on, only a session that
    // has passed the second step may set a password.
    if (this.account.mfaEnabled && !this.secondStep) {
      if (code !== TEST_TOTP_CODE) {
        return { ok: false, message: code ? 'The authenticator code is not correct. Wait for a new code and try again.' : 'Enter the 6-digit code from your authenticator app.' };
      }
      this.secondStep = true;
    }
    if (password === this.account.password) {
      return { ok: false, message: 'Choose a password you have not used for this account before.' };
    }
    // As the database trigger does: a new password clears the requirement.
    this.account.password = password;
    this.account.passwordChangeRequired = false;
    this.set(this.sessionState());
    return { ok: true };
  }

  async changePassword(currentPassword: string, newPassword: string, code?: string): Promise<AuthResult> {
    this.calls.changePassword += 1;
    const confirmed = await this.reauthenticate(currentPassword, code);
    return confirmed.ok ? this.updatePassword(newPassword) : confirmed;
  }

  async reauthenticate(password: string, code?: string): Promise<AuthResult> {
    this.calls.reauthenticate += 1;
    if (this.account.mfaEnabled && code !== TEST_TOTP_CODE) {
      return { ok: false, message: code ? 'The authenticator code is not correct. Wait for a new code and try again.' : 'Enter the 6-digit code from your authenticator app.' };
    }
    if (password !== this.account.password) {
      return { ok: false, message: 'Your current password is incorrect.' };
    }
    this.secondStep = this.account.mfaEnabled;
    return { ok: true };
  }

  async mfaStatus(): Promise<{ enrolled: boolean }> {
    return { enrolled: this.account.mfaEnabled };
  }

  async verifyMfa(code: string): Promise<AuthResult> {
    if (code !== TEST_TOTP_CODE) {
      return { ok: false, message: 'The code is not correct. Wait for a new code and try again.' };
    }
    this.secondStep = true;
    this.set(this.sessionState());
    return { ok: true };
  }

  async startMfaEnrollment(): Promise<MfaEnrollment> {
    return { ok: true, factorId: 'factor-1', qrCode: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"/>', secret: 'FAKESECRETBASE32' };
  }

  async confirmMfaEnrollment(_factorId: string, code: string): Promise<AuthResult> {
    if (code !== TEST_TOTP_CODE) {
      return { ok: false, message: 'The code is not correct. Check the time on your phone, wait for a new code and try again.' };
    }
    this.account.mfaEnabled = true;
    this.secondStep = true;
    this.set(this.sessionState());
    return { ok: true };
  }

  async disableMfa(): Promise<AuthResult> {
    this.account.mfaEnabled = false;
    this.set(this.sessionState());
    return { ok: true };
  }

  async retryAccountCheck(): Promise<void> {
    this.set(this.sessionState());
  }

  async verifyEmailLink(tokenHash: string, type: EmailLinkType): Promise<AuthResult> {
    this.calls.emailLinks.push({ tokenHash, type });
    if (!this.validLinkTokens.delete(tokenHash)) {
      return { ok: false, message: 'This link is invalid, has expired, or was already used.' };
    }
    if (type === 'recovery') {
      this.startRecovery();
    } else {
      // An invited account has no password yet and is flagged by the database.
      this.account.passwordChangeRequired = true;
      this.set(this.sessionState());
    }
    return { ok: true };
  }

  async handleSessionExpired(): Promise<void> {
    this.expire();
  }

  // Simulates Supabase ending the session (expired or revoked refresh token).
  expire() {
    this.set({ status: 'signedOut', reason: 'expired' });
  }

  // Simulates opening a valid password-reset link.
  startRecovery() {
    this.secondStep = false; // A reset-link session has not passed the second step.
    this.set({ status: 'recovery', user: TEST_USER });
  }

  finishLoading(next: AuthState) {
    this.set(next);
  }

  // The state a signed-in session gets once the server's flag is read.
  private sessionState(): AuthState {
    if (this.account.mfaEnabled && !this.secondStep) {
      return { status: 'mfaRequired', user: TEST_USER };
    }
    return this.account.passwordChangeRequired
      ? { status: 'passwordChangeRequired', user: TEST_USER }
      : { status: 'signedIn', user: TEST_USER };
  }

  private fail(): AuthResult {
    const message = this.nextError!;
    this.nextError = null;
    return { ok: false, message };
  }

  private set(next: AuthState) {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
}
