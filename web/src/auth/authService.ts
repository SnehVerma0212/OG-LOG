// Everything screens know about authentication. The Supabase implementation
// lives in supabaseAuthService.ts; tests use a fake with the same contract.

export interface AuthUser {
  id: string;
  email: string | null;
}

export type SignedOutReason = 'none' | 'signedOut' | 'expired' | 'idle' | 'accountDeleted';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; reason: SignedOutReason }
  | { status: 'signedIn'; user: AuthUser }
  // Signed in through a password-reset link: must choose a new password first.
  | { status: 'recovery'; user: AuthUser }
  // Signed in with the administrator-issued initial password; the server
  // (profiles.password_change_required) blocks all case data until it changes.
  | { status: 'passwordChangeRequired'; user: AuthUser }
  // Signed in with the password, but the doctor has two-step verification
  // on: the database withholds case data until the code is entered.
  | { status: 'mfaRequired'; user: AuthUser }
  // Signed in, but the account status could not be read. Fails closed.
  | { status: 'accountCheckFailed'; user: AuthUser };

export type AuthResult = { ok: true } | { ok: false; message: string };

export type EmailLinkType = 'invite' | 'recovery';

export interface MfaEnrollment {
  ok: true;
  factorId: string;
  // An SVG data URL to show as an image, and the same secret as text.
  qrCode: string;
  secret: string;
}

export const MFA_CODE = /^\d{6}$/;

export interface AuthService {
  getState(): AuthState;
  subscribe(listener: () => void): () => void;
  signIn(email: string, password: string): Promise<AuthResult>;
  // 'idle': signed out automatically after a period without activity.
  signOut(reason?: 'signedOut' | 'idle' | 'accountDeleted'): Promise<void>;
  // Always reports the same outcome whether or not the email has an account.
  requestPasswordReset(email: string): Promise<AuthResult>;
  // Sets a new password for the signed-in user (first login or reset link).
  // With two-step verification on, Supabase accepts a new password only from
  // a session that has completed the second step, so a reset-link session
  // must also give the authenticator code.
  updatePassword(password: string, code?: string): Promise<AuthResult>;
  // Settings: confirms the current password (and authenticator code, when
  // two-step verification is on) before setting a new one.
  changePassword(currentPassword: string, newPassword: string, code?: string): Promise<AuthResult>;
  // Confirms identity again before a sensitive action (e.g. account deletion).
  reauthenticate(password: string, code?: string): Promise<AuthResult>;
  // Two-step verification with an authenticator app (TOTP).
  mfaStatus(): Promise<{ enrolled: boolean }>;
  verifyMfa(code: string): Promise<AuthResult>;
  startMfaEnrollment(): Promise<MfaEnrollment | { ok: false; message: string }>;
  confirmMfaEnrollment(factorId: string, code: string): Promise<AuthResult>;
  disableMfa(): Promise<AuthResult>;
  retryAccountCheck(): Promise<void>;
  // Opens an emailed invitation or password-reset link ({{ .TokenHash }}
  // template). Works on any device; the token is used once.
  verifyEmailLink(tokenHash: string, type: EmailLinkType): Promise<AuthResult>;
  // A data request was rejected because the session is no longer valid.
  handleSessionExpired(): Promise<void>;
}

export const MIN_PASSWORD_LENGTH = 6;
// Supabase Auth stores bcrypt hashes, which ignore anything past 72 bytes.
export const MAX_PASSWORD_BYTES = 72;

// Common or default passwords, including the old shared initial password.
// With a 6-character minimum, the short ones matter most.
const COMMON_PASSWORDS = new Set([
  'doctor', 'doctor1', 'doctor12', 'doctor123', 'doctor1234', 'doctor@123', 'surgeon', 'surgeon1', 'surgeon123',
  'surgeon12345', 'hospital', 'hospital1', 'hospital123', 'hospital1234', 'medical', 'medical1', 'nurse123',
  'password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p@ssw0rd', 'p@ssword',
  '123456', '1234567', '12345678', '123456789', '1234567890', '123456789012', '1234567890123', '123123', '654321',
  '111111', '000000', '121212', '112233', '666666', '696969', '987654321', 'abc123', 'abcd1234', 'a1b2c3',
  'qwerty', 'qwerty1', 'qwerty12', 'qwerty123', 'qwertyuiop', 'qwertyuiop12', 'qwertyuiopas', 'asdfgh', 'zxcvbn',
  'iloveyou', 'iloveyou1', 'iloveyou1234', 'welcome', 'welcome1', 'welcome123', 'welcome12345', 'letmein',
  'letmein1', 'letmein12345', 'admin', 'admin123', 'administrator', 'changeme', 'changeme1234', 'secret',
  'monkey', 'dragon', 'sunshine', 'princess', 'football', 'baseball', 'master', 'shadow', 'india123',
  'oglog', 'oglog123', 'oglogoglog12',
]);

// Straight runs on the keyboard or in the alphabet, e.g. "345678" or "asdfgh".
const SEQUENCES = ['01234567890', '9876543210', 'abcdefghijklmnopqrstuvwxyz', 'zyxwvutsrqponmlkjihgfedcba', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

// Why a new password is not acceptable, or null. Supabase's own password
// policy (dashboard) is the server-side check; this gives clear messages first.
export function passwordProblem(password: string, email: string | null): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    return 'Use a shorter password (at most 72 bytes; long passphrases with many special characters can exceed this).';
  }
  const lower = password.toLowerCase();
  if (
    COMMON_PASSWORDS.has(lower) ||
    /^(.)\1+$/.test(password) ||
    SEQUENCES.some((sequence) => sequence.includes(lower)) ||
    /^(0123456789|1234567890|abcdefghijkl)/.test(lower)
  ) {
    return 'This password is too common or predictable. Choose a longer, less predictable passphrase.';
  }
  const name = email?.split('@')[0]?.toLowerCase() ?? '';
  if (name.length >= 4 && lower.includes(name)) {
    return 'Do not include your email address in your password.';
  }
  return null;
}

// Messages never say whether an email address has an account.
export function authErrorMessage(error: { code?: string; status?: number; name?: string } | null | undefined): string {
  const code = error?.code ?? '';
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || error?.status === 429) {
    return 'Too many attempts. Wait a few minutes, then try again.';
  }
  if (code === 'weak_password') {
    return `Choose a stronger password: at least ${MIN_PASSWORD_LENGTH} characters, not a common or reused one.`;
  }
  if (code === 'insufficient_aal') {
    return 'Enter the 6-digit code from your authenticator app to continue.';
  }
  if (code === 'same_password') {
    return 'Choose a password you have not used for this account before.';
  }
  if (error?.name === 'AuthRetryableFetchError' || error?.status === 0) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  return 'Sign-in failed. Check your email and password, then try again.';
}

// Only same-site paths may be used as a post-sign-in destination.
export function safeReturnPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/';
  }
  return ['/login', '/forgot-password', '/reset-password', '/set-password', '/verify-mfa', '/auth/'].some((path) => value.startsWith(path)) ? '/' : value;
}
