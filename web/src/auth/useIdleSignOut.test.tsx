import { act, fireEvent, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeAuthService } from '../test/fakeAuthService';
import { renderApp } from '../test/renderApp';
import { AuthProvider } from './AuthContext';
import { IDLE_MINUTES, useIdleSignOut } from './useIdleSignOut';

describe('sign-out after inactivity', () => {
  let clock = 0;
  const now = () => clock;

  beforeEach(() => {
    clock = 0;
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(active = true) {
    const auth = new FakeAuthService();
    const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider service={auth}>{children}</AuthProvider>;
    renderHook(() => useIdleSignOut(active, now), { wrapper });
    return auth;
  }

  const wait = (minutes: number) =>
    act(() => {
      clock += minutes * 60_000;
      vi.advanceTimersByTime(15_000);
    });

  it(`signs out after ${IDLE_MINUTES} minutes without activity`, () => {
    const auth = setup();
    wait(IDLE_MINUTES - 1);
    expect(auth.getState().status).toBe('signedIn');
    wait(1);
    expect(auth.getState()).toEqual({ status: 'signedOut', reason: 'idle' });
  });

  it('starts counting again after any keyboard, pointer or touch activity', () => {
    const auth = setup();
    wait(IDLE_MINUTES - 1);
    fireEvent.keyDown(window);
    wait(IDLE_MINUTES - 1);
    fireEvent.pointerDown(window);
    wait(IDLE_MINUTES - 1);
    expect(auth.getState().status).toBe('signedIn');
  });

  it('signs out as soon as a tab becomes visible again after a long sleep', () => {
    const auth = setup();
    act(() => {
      clock += (IDLE_MINUTES + 60) * 60_000; // No timer ran while asleep.
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(auth.getState()).toEqual({ status: 'signedOut', reason: 'idle' });
  });

  it('does nothing while inactive (e.g. signed out)', () => {
    const auth = setup(false);
    wait(IDLE_MINUTES * 3);
    expect(auth.getState().status).toBe('signedIn');
  });
});

describe('the sign-in page after an inactivity sign-out', () => {
  it('explains why the user was signed out', async () => {
    renderApp('/login', undefined, { auth: new FakeAuthService({ status: 'signedOut', reason: 'idle' }) });
    expect(await screen.findByText('Signed out after inactivity')).toBeTruthy();
  });
});
