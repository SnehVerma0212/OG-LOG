import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { fakeAccount, FakeAuthService, TEST_TOTP_CODE, TEST_USER } from '../test/fakeAuthService';
import { renderApp } from '../test/renderApp';

// Password reset through an emailed link, for accounts with and without
// two-step verification. Synthetic account and tokens only.
const TOKEN = 'a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2';
const NEW_PASSWORD = 'harbor quill meadow lantern';

function openResetLink(mfaEnabled: boolean) {
  const auth = new FakeAuthService({ status: 'signedOut', reason: 'none' }, fakeAccount({ mfaEnabled }));
  auth.validLinkTokens.add(TOKEN);
  const view = renderApp(`/auth/confirm?token_hash=${TOKEN}&type=recovery`, undefined, { auth });
  return { ...view, auth };
}

async function enterNewPassword(user: ReturnType<typeof userEvent.setup>, code?: string) {
  await user.type(await screen.findByLabelText('New password'), NEW_PASSWORD);
  await user.type(screen.getByLabelText('Confirm new password'), NEW_PASSWORD);
  if (code !== undefined) {
    await user.type(screen.getByLabelText('Authenticator code'), code);
  }
  await user.click(screen.getByRole('button', { name: 'Save New Password' }));
}

async function signInAgain(user: ReturnType<typeof userEvent.setup>, auth: FakeAuthService) {
  await auth.signOut();
  await user.type(await screen.findByLabelText('Email'), TEST_USER.email);
  await user.type(screen.getByLabelText('Password'), NEW_PASSWORD);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

afterEach(() => window.history.replaceState(null, '', '/'));

describe('password recovery without two-step verification', () => {
  it('sets the new password from the link without asking for a code, and it works for the next sign-in', async () => {
    const user = userEvent.setup();
    const { auth, router } = openResetLink(false);
    await waitFor(() => expect(router.state.location.pathname).toBe('/reset-password'));
    await screen.findByLabelText('New password');
    expect(screen.queryByLabelText('Authenticator code')).toBeNull();

    await enterNewPassword(user);
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(auth.account.password).toBe(NEW_PASSWORD);
    expect(auth.calls.signIn).toBe(0); // Recovery never signs in with a password.

    await signInAgain(user, auth);
    await waitFor(() => expect(auth.getState().status).toBe('signedIn'));
  });
});

describe('password recovery with two-step verification', () => {
  it('asks for the authenticator code with the new password, and keeps the old password without it', async () => {
    const user = userEvent.setup();
    const { auth, router } = openResetLink(true);
    await waitFor(() => expect(router.state.location.pathname).toBe('/reset-password'));
    expect(await screen.findByLabelText('Authenticator code')).toBeTruthy();

    await enterNewPassword(user);
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the 6-digit code from your authenticator app.');
    expect(screen.queryByText(/Sign-in failed/)).toBeNull();
    expect(auth.account.password).not.toBe(NEW_PASSWORD);
    expect(auth.getState().status).toBe('recovery');
    expect(router.state.location.pathname).toBe('/reset-password');
  });

  it('rejects a wrong code and leaves the password unchanged', async () => {
    const user = userEvent.setup();
    const { auth } = openResetLink(true);
    await enterNewPassword(user, '000000');
    expect((await screen.findByRole('alert')).textContent).toMatch(/authenticator code is not correct/);
    expect(auth.account.password).not.toBe(NEW_PASSWORD);
    expect(auth.getState().status).toBe('recovery');
  });

  it('sets the password with the correct code; the next sign-in still requires the code', async () => {
    const user = userEvent.setup();
    const { auth, router } = openResetLink(true);
    await enterNewPassword(user, TEST_TOTP_CODE);
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(auth.account.password).toBe(NEW_PASSWORD);
    expect(auth.calls.signIn).toBe(0);

    await signInAgain(user, auth);
    await waitFor(() => expect(router.state.location.pathname).toBe('/verify-mfa'));
    expect(auth.getState().status).toBe('mfaRequired');
  });
});

describe('failed or unusable recovery links', () => {
  it.each([false, true])('an expired or used link sets nothing (two-step verification: %s)', async (mfaEnabled) => {
    const auth = new FakeAuthService({ status: 'signedOut', reason: 'none' }, fakeAccount({ mfaEnabled }));
    // Token not accepted: already used or expired.
    renderApp(`/auth/confirm?token_hash=${TOKEN}&type=recovery`, undefined, { auth });
    expect((await screen.findByRole('alert')).textContent).toMatch(/invalid, has expired, or was already used/);
    expect(auth.getState().status).toBe('signedOut');
    expect(auth.calls.updatePassword).toEqual([]);
  });

  it('a link used a second time is refused', async () => {
    const { auth, router, unmount } = openResetLink(false);
    await waitFor(() => expect(router.state.location.pathname).toBe('/reset-password'));
    unmount();
    await auth.signOut();
    renderApp(`/auth/confirm?token_hash=${TOKEN}&type=recovery`, undefined, { auth });
    expect((await screen.findByRole('alert')).textContent).toMatch(/invalid, has expired, or was already used/);
  });

  it('an expired link reported by Supabase on /reset-password shows no form', async () => {
    window.history.replaceState(null, '', '/reset-password?error=access_denied&error_code=otp_expired');
    renderApp('/reset-password?error=access_denied&error_code=otp_expired', undefined, {
      auth: new FakeAuthService({ status: 'signedOut', reason: 'none' }, fakeAccount({ mfaEnabled: true })),
    });
    expect((await screen.findByRole('alert')).textContent).toMatch(/invalid or has expired/);
    expect(screen.queryByLabelText('New password')).toBeNull();
  });

  it('a server failure while saving keeps the recovery form and the old password', async () => {
    const user = userEvent.setup();
    const { auth } = openResetLink(true);
    await screen.findByLabelText('Authenticator code');
    auth.nextError = 'Could not reach the server. Check your connection and try again.';
    await enterNewPassword(user, TEST_TOTP_CODE);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not reach the server/);
    expect(auth.account.password).not.toBe(NEW_PASSWORD);
    expect(auth.getState().status).toBe('recovery');
    expect(screen.getByRole('button', { name: 'Save New Password' })).toBeTruthy();
  });
});
