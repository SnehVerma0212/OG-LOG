import {
  authErrorMessage,
  DEFAULT_LOCK_POLICY,
  FAIL_CLOSED_POLICY,
  initialLockState,
  isLocked,
  lockReducer,
  parseLockPolicy,
  serializeLockPolicy,
  type LockAction,
  type LockPolicy,
  type LockState,
} from '../src/security/appLock';

const run = (actions: LockAction[], start: LockState = initialLockState) => actions.reduce(lockReducer, start);
const enabled = (timeoutSeconds: LockPolicy['timeoutSeconds']): LockPolicy => ({ enabled: true, timeoutSeconds });
const unlockedWith = (policy: LockPolicy) =>
  run([{ type: 'policyLoaded', policy }, { type: 'authStarted' }, { type: 'authSucceeded' }]);

describe('lock policy storage', () => {
  it('round-trips a policy', () => {
    expect(parseLockPolicy(serializeLockPolicy(enabled(60)))).toEqual(enabled(60));
  });

  it('defaults to off when nothing was ever saved', () => {
    expect(parseLockPolicy(null)).toEqual(DEFAULT_LOCK_POLICY);
  });

  it('fails closed for damaged settings', () => {
    for (const stored of ['', 'not json', '{"enabled":"yes"}', '{"enabled":true,"timeoutSeconds":7}', '[]']) {
      expect(parseLockPolicy(stored)).toEqual(FAIL_CLOSED_POLICY);
    }
  });
});

describe('lockReducer', () => {
  it('starts covered, then unlocks without a prompt when the lock is off', () => {
    expect(isLocked(initialLockState.phase)).toBe(true);
    const state = run([{ type: 'policyLoaded', policy: DEFAULT_LOCK_POLICY }]);
    expect(state.phase).toBe('unlocked');
    expect(state.autoPrompt).toBe(false);
  });

  it('locks on launch and asks once automatically when the lock is on', () => {
    const state = run([{ type: 'policyLoaded', policy: enabled(0) }]);
    expect(state).toMatchObject({ phase: 'locked', autoPrompt: true });
  });

  it('stays locked when settings cannot be read', () => {
    const state = run([{ type: 'policyLoadFailed' }]);
    expect(state.phase).toBe('locked');
    expect(state.policy).toEqual(FAIL_CLOSED_POLICY);
  });

  it('stays locked after a failed or cancelled unlock, without prompting again by itself', () => {
    const state = run([
      { type: 'policyLoaded', policy: enabled(0) },
      { type: 'authStarted' },
      { type: 'authFailed', message: 'Unlock was cancelled.' },
    ]);
    expect(state).toMatchObject({ phase: 'locked', autoPrompt: false, message: 'Unlock was cancelled.' });
  });

  it('cannot be unlocked without an authentication in progress', () => {
    const state = run([{ type: 'policyLoaded', policy: enabled(0) }, { type: 'authSucceeded' }]);
    expect(state.phase).toBe('locked');
  });

  it('locks immediately on return with the "Immediately" policy', () => {
    const state = run([{ type: 'background', at: 1_000 }, { type: 'foreground', at: 1_001 }], unlockedWith(enabled(0)));
    expect(state).toMatchObject({ phase: 'locked', autoPrompt: true });
  });

  it('allows a short absence within the timeout and locks after it', () => {
    const start = unlockedWith(enabled(60));
    expect(run([{ type: 'background', at: 0 }, { type: 'foreground', at: 59_999 }], start).phase).toBe('unlocked');
    expect(run([{ type: 'background', at: 0 }, { type: 'foreground', at: 60_000 }], start).phase).toBe('locked');
  });

  it('measures from when the app first left the foreground', () => {
    const state = run(
      [
        { type: 'background', at: 0 },
        { type: 'background', at: 50_000 },
        { type: 'foreground', at: 61_000 },
      ],
      unlockedWith(enabled(60)),
    );
    expect(state.phase).toBe('locked');
  });

  it('locks if the clock moved backwards while away', () => {
    const state = run([{ type: 'background', at: 100_000 }, { type: 'foreground', at: 1_000 }], unlockedWith(enabled(300)));
    expect(state.phase).toBe('locked');
  });

  it('ignores app-state changes caused by the system unlock prompt', () => {
    const state = run([
      { type: 'policyLoaded', policy: enabled(0) },
      { type: 'authStarted' },
      { type: 'background', at: 0 },
      { type: 'foreground', at: 1 },
      { type: 'authSucceeded' },
    ]);
    expect(state.phase).toBe('unlocked');
    expect(state.backgroundedAt).toBeNull();
  });

  it('offers the prompt again when returning to a locked app', () => {
    const state = run([
      { type: 'policyLoaded', policy: enabled(0) },
      { type: 'authStarted' },
      { type: 'authFailed', message: 'x' },
      { type: 'foreground', at: 5 },
    ]);
    expect(state).toMatchObject({ phase: 'locked', autoPrompt: true });
  });

  it('keeps content visible while confirming a settings change, and ignores app-state changes then', () => {
    const verifying = run([{ type: 'settingsAuthStarted' }], unlockedWith(enabled(0)));
    expect(verifying.phase).toBe('verifying');
    expect(isLocked(verifying.phase)).toBe(false);
    const after = run([{ type: 'background', at: 0 }, { type: 'foreground', at: 9 }, { type: 'settingsAuthFinished' }], verifying);
    expect(after.phase).toBe('unlocked');
  });

  it('never lets the lock be skipped when the lock is off and later turned on', () => {
    const state = run([
      { type: 'policyLoaded', policy: DEFAULT_LOCK_POLICY },
      { type: 'policyChanged', policy: enabled(0) },
      { type: 'background', at: 0 },
      { type: 'foreground', at: 1 },
    ]);
    expect(state.phase).toBe('locked');
  });
});

describe('authErrorMessage', () => {
  it('explains each kind of failure', () => {
    expect(authErrorMessage('user_cancel')).toMatch(/cancelled/);
    expect(authErrorMessage('lockout')).toMatch(/Too many/);
    expect(authErrorMessage('passcode_not_set')).toMatch(/no screen lock/);
    expect(authErrorMessage('not_enrolled')).toMatch(/no screen lock/);
    expect(authErrorMessage('authentication_failed')).toMatch(/Not recognised/);
    expect(authErrorMessage('something_new')).toMatch(/did not succeed/);
  });
});
