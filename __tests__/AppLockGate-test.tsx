import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { AppState, Text, TextInput, type AppStateStatus } from 'react-native';

import type { LockPolicy } from '../src/security/appLock';
import { AppLockGate, useAppLock } from '../src/security/AppLockGate';
import type { AppLockServices, AuthResult } from '../src/security/expoAppLock';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// Simulated foreground/background changes and clock.
let appStateListeners: ((state: AppStateStatus) => void)[] = [];
let clock = 0;
const now = () => clock;

beforeEach(() => {
  appStateListeners = [];
  clock = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    const handler = listener as (state: AppStateStatus) => void;
    appStateListeners.push(handler);
    return { remove: () => (appStateListeners = appStateListeners.filter((item) => item !== handler)) } as never;
  });
});

afterEach(() => jest.restoreAllMocks());

async function moveApp(to: AppStateStatus, at?: number) {
  if (at !== undefined) {
    clock = at;
  }
  await act(async () => appStateListeners.forEach((listener) => listener(to)));
}

function fakeServices(policy: LockPolicy, results: AuthResult[] = []) {
  const queue = [...results];
  const services = {
    loadPolicy: jest.fn(async () => policy),
    savePolicy: jest.fn(async () => undefined),
    authenticate: jest.fn(async () => queue.shift() ?? { ok: true as const }),
    getCapability: jest.fn(async () => ({ available: true, description: 'Fingerprint' })),
    enablePrivacyProtection: jest.fn(async () => undefined),
  };
  return services satisfies AppLockServices;
}

// Stands in for a screen with unsaved input.
function Notes() {
  const [text, setText] = useState('');
  return <TextInput accessibilityLabel="Notes" value={text} onChangeText={setText} />;
}

const on = (timeoutSeconds: LockPolicy['timeoutSeconds'] = 0): LockPolicy => ({ enabled: true, timeoutSeconds });
const off: LockPolicy = { enabled: false, timeoutSeconds: 0 };

const renderGate = (services: AppLockServices) =>
  render(
    <AppLockGate services={services} now={now}>
      <Notes />
    </AppLockGate>,
  );

describe('AppLockGate', () => {
  it('shows the app without a prompt when the lock is off', async () => {
    const services = fakeServices(off);
    await renderGate(services);

    expect(await screen.findByLabelText('Notes')).toBeTruthy();
    expect(services.authenticate).not.toHaveBeenCalled();
    expect(services.enablePrivacyProtection).toHaveBeenCalled();
  });

  it('asks once on launch and shows nothing until unlocked', async () => {
    let finish!: (result: AuthResult) => void;
    const services = fakeServices(on());
    services.authenticate.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await renderGate(services);

    await waitFor(() => expect(services.authenticate).toHaveBeenCalledTimes(1));
    expect(screen.getByText('OG-LOG is locked')).toBeTruthy();
    expect(screen.queryByLabelText('Notes', { includeHiddenElements: true })).toBeNull();

    await act(async () => finish({ ok: true }));
    expect(await screen.findByLabelText('Notes')).toBeTruthy();
    expect(screen.queryByText('OG-LOG is locked')).toBeNull();
  });

  it('stays locked after a cancelled unlock and does not keep prompting', async () => {
    const services = fakeServices(on(), [{ ok: false, message: 'Unlock was cancelled.' }]);
    await renderGate(services);

    expect(await screen.findByText('Unlock was cancelled.')).toBeTruthy();
    expect(screen.queryByLabelText('Notes', { includeHiddenElements: true })).toBeNull();
    expect(services.authenticate).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByLabelText('Notes')).toBeTruthy();
    expect(services.authenticate).toHaveBeenCalledTimes(2);
  });

  it('fails closed when lock settings cannot be read', async () => {
    const services = fakeServices(off, [{ ok: false, message: 'Unlock was cancelled.' }]);
    services.loadPolicy.mockRejectedValueOnce(new Error('secure storage unavailable'));
    await renderGate(services);

    expect(await screen.findByText('OG-LOG is locked')).toBeTruthy();
    expect(screen.queryByLabelText('Notes', { includeHiddenElements: true })).toBeNull();
  });

  it('locks on return, hides but keeps unsaved input, and unlocks again', async () => {
    const services = fakeServices(on(0), [{ ok: true }, { ok: false, message: 'Not recognised. Try again.' }, { ok: true }]);
    await renderGate(services);
    await fireEvent.changeText(await screen.findByLabelText('Notes'), 'unsaved text');

    await moveApp('background', 1_000);
    expect(screen.getByLabelText('OG-LOG')).toBeTruthy(); // privacy cover for the app switcher
    await moveApp('active', 1_500);

    expect(await screen.findByText('Not recognised. Try again.')).toBeTruthy();
    expect(screen.queryByLabelText('Notes')).toBeNull(); // hidden from accessibility while locked
    expect(screen.getByLabelText('Notes', { includeHiddenElements: true }).props.value).toBe('unsaved text');

    await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }));
    expect((await screen.findByLabelText('Notes')).props.value).toBe('unsaved text');
  });

  it('honours the timeout before locking again', async () => {
    const services = fakeServices(on(60));
    await renderGate(services);
    await screen.findByLabelText('Notes');

    await moveApp('background', 0);
    await moveApp('active', 30_000);
    expect(screen.getByLabelText('Notes')).toBeTruthy();
    expect(services.authenticate).toHaveBeenCalledTimes(1);

    await moveApp('background', 100_000);
    await moveApp('active', 170_000);
    await waitFor(() => expect(services.authenticate).toHaveBeenCalledTimes(2));
  });

  it('does not re-lock because the system prompt sent the app to the background', async () => {
    let finish!: (result: AuthResult) => void;
    const services = fakeServices(on(0));
    services.authenticate.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await renderGate(services);
    await waitFor(() => expect(services.authenticate).toHaveBeenCalledTimes(1));

    await moveApp('background', 10);
    await moveApp('active', 20);
    await act(async () => finish({ ok: true }));

    expect(await screen.findByLabelText('Notes')).toBeTruthy();
    expect(services.authenticate).toHaveBeenCalledTimes(1);
  });
});

function LockToggle() {
  const { policy, updatePolicy } = useAppLock();
  const [result, setResult] = useState('');
  return (
    <>
      <Text>{policy.enabled ? 'lock on' : 'lock off'}</Text>
      <Text>{result}</Text>
      <Text
        accessibilityRole="button"
        onPress={async () => {
          const outcome = await updatePolicy({ enabled: true, timeoutSeconds: 60 });
          setResult(outcome.ok ? 'saved' : outcome.message);
        }}
      >
        Turn on
      </Text>
    </>
  );
}

describe('changing the lock setting', () => {
  it('requires device authentication before saving', async () => {
    const services = fakeServices(off, [{ ok: false, message: 'Unlock was cancelled.' }, { ok: true }]);
    await render(
      <AppLockGate services={services} now={now}>
        <LockToggle />
      </AppLockGate>,
    );

    await fireEvent.press(await screen.findByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText('Unlock was cancelled.')).toBeTruthy();
    expect(services.savePolicy).not.toHaveBeenCalled();
    expect(screen.getByText('lock off')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText('saved')).toBeTruthy();
    expect(services.savePolicy).toHaveBeenCalledWith({ enabled: true, timeoutSeconds: 60 });
    expect(screen.getByText('lock on')).toBeTruthy();
  });
});
