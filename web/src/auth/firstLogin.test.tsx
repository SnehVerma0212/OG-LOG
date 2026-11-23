import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { fakeAccount, FakeAuthService, TEST_USER } from '../test/fakeAuthService';
import { renderApp } from '../test/renderApp';

// The administrator-issued initial password ("doctor" in the beta plan). The
// server flag lives on the fake account, as it lives in the database, so a new
// FakeAuthService for the same account behaves like a page reload.
const INITIAL = 'doctor';
const NEW_PASSWORD = 'my-own-synthetic-pass';
const PRIVATE_PATHS = ['/', '/cases', '/cases/new', '/statistics', '/settings', '/cases/00000000-0000-4000-8000-000000000000'];

const newDoctor = () => fakeAccount({ password: INITIAL, passwordChangeRequired: true });
const signedOutFor = (account = newDoctor()) => new FakeAuthService({ status: 'signedOut', reason: 'none' }, account);
const mainNav = () => screen.queryAllByRole('navigation', { name: 'Main' });

async function signIn(user: ReturnType<typeof userEvent.setup>, password: string) {
  await user.type(await screen.findByLabelText('Email'), TEST_USER.email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

async function setNewPassword(user: ReturnType<typeof userEvent.setup>, password: string, confirmation = password) {
  await user.type(await screen.findByLabelText('New password'), password);
  await user.type(screen.getByLabelText('Confirm new password'), confirmation);
  await user.click(screen.getByRole('button', { name: 'Save New Password' }));
}

describe('first sign-in with an initial password', () => {
  it('goes straight to Set New Password instead of the requested page', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/statistics', undefined, { auth: signedOutFor() });
    await signIn(user, INITIAL);
    await waitFor(() => expect(router.state.location.pathname).toBe('/set-password'));
    expect(screen.getByRole('heading', { name: 'Set a new password' })).toBeTruthy();
    expect(screen.getByText(/initial password from the administrator/)).toBeTruthy();
    expect(mainNav()).toEqual([]);
  });

  it.each(PRIVATE_PATHS)('redirects a direct visit to %s while the change is pending', async (path) => {
    const { router } = renderApp(path, undefined, { auth: new FakeAuthService(undefined, newDoctor()) });
    await waitFor(() => expect(router.state.location.pathname).toBe('/set-password'));
    expect(mainNav()).toEqual([]);
    expect(screen.queryByText(/SAMPLE-00/)).toBeNull();
  });

  it('still requires the change after a page reload, because the requirement is read from the server', async () => {
    const account = newDoctor();
    const first = renderApp('/', undefined, { auth: new FakeAuthService(undefined, account) });
    await waitFor(() => expect(first.router.state.location.pathname).toBe('/set-password'));
    first.unmount();
    window.localStorage.clear(); // Nothing in browser storage decides this.

    const reloaded = renderApp('/cases', undefined, { auth: new FakeAuthService(undefined, account) });
    await waitFor(() => expect(reloaded.router.state.location.pathname).toBe('/set-password'));
  });

  it('keeps the logbook locked when the new password is rejected', async () => {
    const user = userEvent.setup();
    const auth = new FakeAuthService(undefined, newDoctor());
    const { router } = renderApp('/set-password', undefined, { auth });

    await setNewPassword(user, 'short');
    expect((await screen.findByRole('alert')).textContent).toBe('Use at least 6 characters.');
    await user.clear(screen.getByLabelText('New password'));
    await user.clear(screen.getByLabelText('Confirm new password'));

    await setNewPassword(user, NEW_PASSWORD, 'something-else-12');
    expect((await screen.findByRole('alert')).textContent).toBe('The two passwords do not match.');
    expect(auth.calls.updatePassword).toEqual([]);
    await user.clear(screen.getByLabelText('New password'));
    await user.clear(screen.getByLabelText('Confirm new password'));

    auth.nextError = 'Choose a stronger password: at least 6 characters, not a common or reused one.';
    await setNewPassword(user, NEW_PASSWORD);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Choose a stronger password/);
    expect(auth.account.passwordChangeRequired).toBe(true);
    expect(router.state.location.pathname).toBe('/set-password');
    expect(document.body.textContent).not.toContain(NEW_PASSWORD);

    await act(() => router.navigate('/cases'));
    expect(router.state.location.pathname).toBe('/set-password');
  });

  it('opens the logbook after a successful change, and later sign-ins use only the new password', async () => {
    const user = userEvent.setup();
    const auth = signedOutFor();
    const { router } = renderApp('/login', undefined, { auth });
    await signIn(user, INITIAL);
    await setNewPassword(user, NEW_PASSWORD);

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByText('Password updated.')).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeTruthy();
    expect(auth.account.passwordChangeRequired).toBe(false);

    await user.click(screen.getAllByRole('button', { name: 'Sign Out' })[0]!);
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    await signIn(user, INITIAL);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Sign-in failed/);

    await user.clear(screen.getByLabelText('Email'));
    await signIn(user, NEW_PASSWORD);
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeTruthy();
  });

  it('applies the password policy: 6 characters, nothing common, not the email name', async () => {
    const user = userEvent.setup();
    const auth = new FakeAuthService(undefined, newDoctor());
    const { router } = renderApp('/set-password', undefined, { auth });
    const common = 'This password is too common or predictable. Choose a longer, less predictable passphrase.';
    const attempts: [string, string][] = [
      ['abc12', 'Use at least 6 characters.'],
      ['doctor', common],
      ['123456', common],
      ['abc123', common],
      ['qwerty', common],
      ['345678', common],
      ['aaaaaa', common],
      ['password1234', common],
      ['oglog-test-a-2026!', 'Do not include your email address in your password.'],
      ['é'.repeat(37), 'Use a shorter password (at most 72 bytes; long passphrases with many special characters can exceed this).'],
    ];
    for (const [password, message] of attempts) {
      await setNewPassword(user, password);
      expect((await screen.findByRole('alert')).textContent).toBe(message);
      await user.clear(screen.getByLabelText('New password'));
      await user.clear(screen.getByLabelText('Confirm new password'));
    }
    expect(auth.calls.updatePassword).toEqual([]);

    // Exactly 6 characters that are not common are accepted.
    await setNewPassword(user, 'k7#mQz');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(auth.calls.updatePassword).toEqual(['k7#mQz']);
    expect(auth.account.passwordChangeRequired).toBe(false);
  });

  it('allows signing out from Set New Password', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/set-password', undefined, { auth: new FakeAuthService(undefined, newDoctor()) });
    await user.click(await screen.findByRole('button', { name: 'Sign Out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it('is not shown to accounts that do not need it, or to signed-out visitors', async () => {
    const done = renderApp('/set-password');
    await waitFor(() => expect(done.router.state.location.pathname).toBe('/'));
    done.unmount();
    const out = renderApp('/set-password', undefined, { auth: new FakeAuthService({ status: 'signedOut', reason: 'none' }) });
    await waitFor(() => expect(out.router.state.location.pathname).toBe('/login'));
  });

  it('keeps the logbook closed when the account status cannot be checked, and offers a retry', async () => {
    const user = userEvent.setup();
    const auth = new FakeAuthService({ status: 'accountCheckFailed', user: TEST_USER });
    renderApp('/cases', undefined, { auth });
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not confirm your account status/);
    expect(mainNav()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'My Cases' })).toBeTruthy();
  });
});

describe('password recovery and the first-login requirement', () => {
  it('a reset link replaces the initial password and opens the logbook without a redirect loop', async () => {
    const user = userEvent.setup();
    const account = newDoctor();
    const auth = signedOutFor(account);
    const { router, unmount } = renderApp('/reset-password', undefined, { auth });
    act(() => auth.startRecovery());

    await setNewPassword(user, NEW_PASSWORD);
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeTruthy();
    expect(account.passwordChangeRequired).toBe(false);
    unmount();

    const reloaded = renderApp('/cases', undefined, { auth: new FakeAuthService(undefined, account) });
    expect(await screen.findByRole('heading', { level: 1, name: 'My Cases' })).toBeTruthy();
    expect(reloaded.router.state.location.pathname).toBe('/cases');
  });

  it('a recovery session cannot reach the logbook before a new password is saved', async () => {
    const auth = signedOutFor();
    const { router } = renderApp('/reset-password', undefined, { auth });
    act(() => auth.startRecovery());
    for (const path of ['/', '/cases', '/set-password']) {
      await act(() => router.navigate(path));
      expect(router.state.location.pathname).toBe('/reset-password');
    }
  });
});

describe('the reset page without a reset link', () => {
  it('does not let a signed-in user set a password without the current one', async () => {
    const auth = new FakeAuthService();
    renderApp('/reset-password', undefined, { auth });
    expect(await screen.findByText(/You are already signed in/)).toBeTruthy();
    expect(screen.queryByLabelText('New password')).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to Settings' }).getAttribute('href')).toBe('/settings');
    expect(auth.calls.updatePassword).toEqual([]);
  });

  it('sends a user with a pending initial password to Set New Password', async () => {
    const { router } = renderApp('/reset-password', undefined, { auth: new FakeAuthService(undefined, newDoctor()) });
    await waitFor(() => expect(router.state.location.pathname).toBe('/set-password'));
  });
});

describe('changing the password in Settings', () => {
  async function openForm() {
    const card = await screen.findByRole('region', { name: 'Change Password' });
    return card;
  }

  it('requires the current password and a confirmed new one, without revealing passwords', async () => {
    const user = userEvent.setup();
    const auth = new FakeAuthService();
    renderApp('/settings', undefined, { auth });
    const card = await openForm();

    await user.click(within(card).getByRole('button', { name: 'Change Password' }));
    expect((await within(card).findByRole('alert')).textContent).toBe('Enter your current password.');

    await user.type(within(card).getByLabelText('Current password'), 'not-my-password');
    await user.type(within(card).getByLabelText('New password'), NEW_PASSWORD);
    await user.type(within(card).getByLabelText('Confirm new password'), NEW_PASSWORD);
    await user.click(within(card).getByRole('button', { name: 'Change Password' }));
    expect((await within(card).findByRole('alert')).textContent).toBe('Your current password is incorrect.');
    expect(auth.account.password).not.toBe(NEW_PASSWORD);
    expect(document.body.textContent).not.toContain(NEW_PASSWORD);
    expect(document.body.textContent).not.toContain('not-my-password');
  });

  it('changes the password, confirms it, and the new password works for the next sign-in', async () => {
    const user = userEvent.setup();
    const auth = new FakeAuthService();
    const { router } = renderApp('/settings', undefined, { auth });
    const card = await openForm();

    await user.type(within(card).getByLabelText('Current password'), auth.account.password);
    await user.type(within(card).getByLabelText('New password'), NEW_PASSWORD);
    await user.type(within(card).getByLabelText('Confirm new password'), NEW_PASSWORD);
    await user.click(within(card).getByRole('button', { name: 'Change Password' }));

    expect(await within(card).findByText(/Your password was changed/)).toBeTruthy();
    expect((within(card).getByLabelText('New password') as HTMLInputElement).value).toBe('');
    expect(auth.calls.changePassword).toBe(1);

    await user.click(screen.getAllByRole('button', { name: 'Sign Out' })[0]!);
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    await signIn(user, NEW_PASSWORD);
    // Back to the page the doctor was on, with no Set New Password detour.
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
  });

  it('refuses a new password equal to the current one', async () => {
    const user = userEvent.setup();
    const auth = new FakeAuthService();
    renderApp('/settings', undefined, { auth });
    const card = await openForm();
    for (const field of ['Current password', 'New password', 'Confirm new password']) {
      await user.type(within(card).getByLabelText(field), auth.account.password);
    }
    await user.click(within(card).getByRole('button', { name: 'Change Password' }));
    expect((await within(card).findByRole('alert')).textContent).toBe('Choose a password different from your current one.');
    expect(auth.calls.changePassword).toBe(0);
  });
});
