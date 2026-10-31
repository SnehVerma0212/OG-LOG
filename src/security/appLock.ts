// App lock: a privacy screen that requires device authentication (biometrics,
// or the device PIN, pattern or password) to see the app. It hides the UI; the
// data itself is protected separately by database encryption.

export type LockTimeout = 0 | 60 | 300;

export interface LockPolicy {
  enabled: boolean;
  // How long the app may stay in the background before it locks again.
  timeoutSeconds: LockTimeout;
}

export const DEFAULT_LOCK_POLICY: LockPolicy = { enabled: false, timeoutSeconds: 0 };

// Used if saved settings cannot be read: lock immediately rather than open.
export const FAIL_CLOSED_POLICY: LockPolicy = { enabled: true, timeoutSeconds: 0 };

export const LOCK_TIMEOUT_OPTIONS: { value: LockTimeout; label: string }[] = [
  { value: 0, label: 'Immediately' },
  { value: 60, label: 'After 1 minute' },
  { value: 300, label: 'After 5 minutes' },
];

export function serializeLockPolicy(policy: LockPolicy): string {
  return JSON.stringify({ enabled: policy.enabled, timeoutSeconds: policy.timeoutSeconds });
}

// Missing settings mean the user never turned the lock on. Damaged settings
// fail closed.
export function parseLockPolicy(stored: string | null): LockPolicy {
  if (stored === null) {
    return DEFAULT_LOCK_POLICY;
  }
  try {
    const value: unknown = JSON.parse(stored);
    if (value && typeof value === 'object') {
      const { enabled, timeoutSeconds } = value as Record<string, unknown>;
      if (typeof enabled === 'boolean' && LOCK_TIMEOUT_OPTIONS.some((option) => option.value === timeoutSeconds)) {
        return { enabled, timeoutSeconds: timeoutSeconds as LockTimeout };
      }
    }
  } catch {
    // Fall through.
  }
  return FAIL_CLOSED_POLICY;
}

// checking: reading saved settings. authenticating: the unlock prompt is open.
// verifying: an unlocked user is confirming a lock-setting change.
export type LockPhase = 'checking' | 'locked' | 'authenticating' | 'unlocked' | 'verifying';

// Whether the app content must be covered.
export function isLocked(phase: LockPhase): boolean {
  return phase !== 'unlocked' && phase !== 'verifying';
}

export interface LockState {
  phase: LockPhase;
  policy: LockPolicy;
  // When the app last went to the background while unlocked.
  backgroundedAt: number | null;
  // Show the system prompt automatically (on launch or return), but never
  // repeatedly after the user cancels or fails.
  autoPrompt: boolean;
  message: string | null;
}

export const initialLockState: LockState = {
  phase: 'checking',
  policy: DEFAULT_LOCK_POLICY,
  backgroundedAt: null,
  autoPrompt: false,
  message: null,
};

export type LockAction =
  | { type: 'policyLoaded'; policy: LockPolicy }
  | { type: 'policyLoadFailed' }
  | { type: 'background'; at: number }
  | { type: 'foreground'; at: number }
  | { type: 'authStarted' }
  | { type: 'authSucceeded' }
  | { type: 'authFailed'; message: string }
  | { type: 'settingsAuthStarted' }
  | { type: 'settingsAuthFinished' }
  | { type: 'policyChanged'; policy: LockPolicy };

export function lockReducer(state: LockState, action: LockAction): LockState {
  switch (action.type) {
    case 'policyLoaded':
      return action.policy.enabled
        ? { ...state, policy: action.policy, phase: 'locked', autoPrompt: true }
        : { ...state, policy: action.policy, phase: 'unlocked' };
    case 'policyLoadFailed':
      return {
        ...state,
        policy: FAIL_CLOSED_POLICY,
        phase: 'locked',
        autoPrompt: true,
        message: 'Lock settings could not be read, so OG-LOG stayed locked.',
      };
    case 'background':
      // System authentication prompts can briefly background the app (notably
      // on Android); those transitions must not restart the lock.
      if (state.phase !== 'unlocked' || state.backgroundedAt !== null) {
        return state;
      }
      return { ...state, backgroundedAt: action.at };
    case 'foreground': {
      if (state.phase === 'authenticating' || state.phase === 'verifying') {
        return state;
      }
      if (state.phase === 'locked') {
        // Returning to a locked app offers the system prompt again.
        return { ...state, autoPrompt: true };
      }
      if (state.backgroundedAt === null) {
        return state;
      }
      const elapsed = action.at - state.backgroundedAt;
      // A clock that moved backwards also locks.
      const expired = elapsed < 0 || elapsed >= state.policy.timeoutSeconds * 1000;
      if (state.phase === 'unlocked' && state.policy.enabled && expired) {
        return { ...state, phase: 'locked', backgroundedAt: null, autoPrompt: true, message: null };
      }
      return { ...state, backgroundedAt: null };
    }
    case 'authStarted':
      return state.phase === 'locked' ? { ...state, phase: 'authenticating', autoPrompt: false, message: null } : state;
    case 'authSucceeded':
      return state.phase === 'authenticating'
        ? { ...state, phase: 'unlocked', backgroundedAt: null, message: null }
        : state;
    case 'authFailed':
      return { ...state, phase: 'locked', autoPrompt: false, message: action.message };
    case 'settingsAuthStarted':
      return state.phase === 'unlocked' ? { ...state, phase: 'verifying' } : state;
    case 'settingsAuthFinished':
      return state.phase === 'verifying' ? { ...state, phase: 'unlocked', backgroundedAt: null } : state;
    case 'policyChanged':
      return { ...state, policy: action.policy };
  }
}

// expo-local-authentication error codes -> what the user can do about it.
export function authErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'user_cancel':
    case 'system_cancel':
    case 'app_cancel':
      return 'Unlock was cancelled.';
    case 'authentication_failed':
      return 'Not recognised. Try again.';
    case 'lockout':
      return 'Too many failed attempts. Wait a moment, or unlock your device first, then try again.';
    case 'not_enrolled':
    case 'passcode_not_set':
    case 'not_available':
      return 'This device has no screen lock set up. Add a PIN, pattern, password or biometrics in the device settings, then try again.';
    case 'timeout':
      return 'The unlock prompt timed out. Try again.';
    default:
      return 'Unlock did not succeed. Try again.';
  }
}
