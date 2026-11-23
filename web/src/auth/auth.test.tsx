import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { SessionExpiredError } from '../data/caseRepository';
import { InMemoryCaseRepository } from '../data/inMemoryCaseRepository';
import { FakeAuthService, TEST_PASSWORD, TEST_USER } from '../test/fakeAuthService';
import { renderApp } from '../test/renderApp';
import { authErrorMessage, MIN_PASSWORD_LENGTH, passwordProblem, safeReturnPath } from './authService';

const signedOut = () => new FakeAuthService({ status: 'signedOut', reason: 'none' });

async function signIn(user: ReturnType<typeof userEvent.setup>, password = TEST_PASSWORD) {
  await user.type(await screen.findByLabelText('Email'), TEST_USER.email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('protected routes', () => {
  it.each(['/', '/cases', '/cases/new', '/statistics', '/settings', '/cases/00000000-0000-4000-8000-000000000000'])(
    'redirects %s to sign-in when signed out, without rendering private content',
    async (path) => {
      const { router } = renderApp(path, undefined, { auth: signedOut() });
      await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
      expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
      expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
      expect(screen.queryByText(/SAMPLE-00/)).toBeNull();
    },
  );

  it('shows a loading state while the session is restored, then the page', async () => {
    const auth = new FakeAuthService({ status: 'loading' });
    renderApp('/cases', undefined, { auth });
    expect(screen.getByText('Checking your session…')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'My Cases' })).toBeNull();

    act(() => auth.finishLoading({ status: 'signedIn', user: TEST_USER }));
    expect(await screen.findByRole('heading', { level: 1, name: 'My Cases' })).toBeTruthy();
  });

  it('restores a saved session straight to the requested page', async () => {
    const { router } = renderApp('/statistics', undefined, { auth: new FakeAuthService() });
    expect(await screen.findByRole('heading', { level: 1, name: 'Statistics' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/statistics');
  });
});

describe('sign-in', () => {
  it('signs in and returns to the page that was requested', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/statistics', undefined, { auth: signedOut() });
    await signIn(user);
    await waitFor(() => expect(router.state.location.pathname).toBe('/statistics'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Statistics' })).toBeTruthy();
  });

  it('shows a generic error for wrong credentials, clears the password, and stays signed out', async () => {
    const user = userEvent.setup();
    const auth = signedOut();
    const { router } = renderApp('/login', undefined, { auth });
    await signIn(user, 'wrong-password');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Sign-in failed. Check your email and password, then try again.');
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
    expect(router.state.location.pathname).toBe('/login');
    expect(auth.getState().status).toBe('signedOut');
  });

  it('asks for both fields before contacting the server', async () => {
    const user = userEvent.setup();
    const auth = signedOut();
    renderApp('/login', undefined, { auth });
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Enter your email and password.');
    expect(auth.calls.signIn).toBe(0);
  });

  it('reports a server or connection failure from the auth service', async () => {
    const user = userEvent.setup();
    const auth = signedOut();
    auth.nextError = 'Could not reach the server. Check your connection and try again.';
    renderApp('/login', undefined, { auth });
    await signIn(user);
    expect((await screen.findByRole('alert')).textContent).toBe('Could not reach the server. Check your connection and try again.');
  });

  it('sends an already signed-in user from the sign-in page to the dashboard', async () => {
    const { router } = renderApp('/login');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('never offers public registration', async () => {
    renderApp('/login', undefined, { auth: signedOut() });
    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByText(/sign up|register|create (an )?account/i)).toBeNull();
  });
});

describe('sign-out and session expiry', () => {
  it('signs out from the app and blocks private pages afterwards', async () => {
    const user = userEvent.setup();
    const { router, auth } = renderApp('/cases');
    await screen.findByRole('heading', { level: 1, name: 'My Cases' });

    await user.click(screen.getAllByRole('button', { name: 'Sign Out' })[0]!);
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(auth.calls.signOut).toBe(1);
    expect(screen.getByText('You have signed out.')).toBeTruthy();

    await act(() => router.navigate('/cases'));
    expect(router.state.location.pathname).toBe('/login');
  });

  it('returns to sign-in with an explanation when the session ends, then back to the same page', async () => {
    const user = userEvent.setup();
    const { router, auth } = renderApp('/statistics');
    await screen.findByRole('heading', { level: 1, name: 'Statistics' });

    act(() => auth.expire());
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(screen.getByText('Your session has ended')).toBeTruthy();

    await signIn(user);
    await waitFor(() => expect(router.state.location.pathname).toBe('/statistics'));
  });
});

describe('session ending during data access', () => {
  it('sends the user to sign-in when the database rejects the session', async () => {
    const auth = new FakeAuthService();
    class ExpiredSessionRepository extends InMemoryCaseRepository {
      override async listCases(): Promise<never> {
        await auth.handleSessionExpired(); // What the Supabase repository does on a 401.
        throw new SessionExpiredError();
      }
    }
    const { router } = renderApp('/cases', new ExpiredSessionRepository(), { auth });
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(screen.getByText('Your session has ended')).toBeTruthy();
  });
});

describe('password recovery', () => {
  it('confirms a reset request without revealing whether the account exists', async () => {
    const user = userEvent.setup();
    const auth = signedOut();
    renderApp('/forgot-password', undefined, { auth });
    await user.type(await screen.findByLabelText('Email'), 'unknown-person@example.com');
    await user.click(screen.getByRole('button', { name: 'Send Reset Link' }));
    expect(await screen.findByText(/If an account exists for that email, a reset link is on its way/)).toBeTruthy();
    expect(auth.calls.reset).toEqual(['unknown-person@example.com']);
  });

  it('checks the email format before sending', async () => {
    const user = userEvent.setup();
    const auth = signedOut();
    renderApp('/forgot-password', undefined, { auth });
    await user.type(await screen.findByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Send Reset Link' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the email address you sign in with.');
    expect(auth.calls.reset).toEqual([]);
  });

  it('keeps a recovery session on the reset page until a new password is saved', async () => {
    const user = userEvent.setup();
    const auth = signedOut();
    const { router } = renderApp('/reset-password', undefined, { auth });
    act(() => auth.startRecovery());

    // The rest of the app stays closed until the password is changed.
    await act(() => router.navigate('/cases'));
    expect(router.state.location.pathname).toBe('/reset-password');

    await user.type(await screen.findByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm new password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Save New Password' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Use at least 6 characters.');

    await user.clear(screen.getByLabelText('New password'));
    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('New password'), 'a-new-synthetic-pass');
    await user.type(screen.getByLabelText('Confirm new password'), 'a-different-pass-123');
    await user.click(screen.getByRole('button', { name: 'Save New Password' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The two passwords do not match.');
    expect(auth.calls.updatePassword).toEqual([]);

    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('Confirm new password'), 'a-new-synthetic-pass');
    await user.click(screen.getByRole('button', { name: 'Save New Password' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(auth.calls.updatePassword).toEqual(['a-new-synthetic-pass']);
    expect(await screen.findByText('Password updated.')).toBeTruthy();
    expect(within((await screen.findAllByRole('navigation', { name: 'Main' }))[0]!).getByRole('link', { name: 'Dashboard' })).toBeTruthy();
  });

  it('explains an invalid or expired reset link and offers a new one', async () => {
    window.history.replaceState(null, '', '/reset-password#error=access_denied&error_code=otp_expired');
    try {
      renderApp('/reset-password', undefined, { auth: signedOut() });
      expect((await screen.findByRole('alert')).textContent).toMatch(/This reset link is invalid or has expired/);
      expect(screen.getByRole('link', { name: 'Request a New Link' })).toBeTruthy();
      expect(screen.queryByLabelText('New password')).toBeNull();
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });
});

describe('auth helpers', () => {
  it('only returns to same-site, non-auth paths after sign-in', () => {
    expect(safeReturnPath('/cases/123')).toBe('/cases/123');
    for (const unsafe of ['https://evil.example', '//evil.example', '/\\evil.example', 'cases', null, 42, '/login', '/reset-password']) {
      expect(safeReturnPath(unsafe)).toBe('/');
    }
  });

  it('requires at least 6 characters and keeps the other password rules', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(6);
    expect(passwordProblem('k7#mQ', null)).toBe('Use at least 6 characters.');
    expect(passwordProblem('k7#mQz', null)).toBeNull();
    expect(passwordProblem('k7#mQz', 'someone@example.com')).toBeNull();
    for (const weak of ['doctor', 'Doctor', '123456', '654321', 'qwerty', 'asdfgh', 'abcdef', 'fedcba', '111111', 'zzzzzzzz', 'password', 'letmein']) {
      expect(passwordProblem(weak, null), weak).toMatch(/too common or predictable/);
    }
    expect(passwordProblem('dr-smith-2026', 'dr-smith@example.com')).toBe('Do not include your email address in your password.');
    expect(passwordProblem('x'.repeat(5) + 'é'.repeat(34), null)).toMatch(/at most 72 bytes/);
  });

  it('uses one message for unknown, unconfirmed and wrong-password sign-ins', () => {
    const generic = authErrorMessage({ code: 'invalid_credentials', status: 400 });
    expect(authErrorMessage({ code: 'email_not_confirmed', status: 400 })).toBe(generic);
    expect(authErrorMessage({ code: 'user_not_found', status: 400 })).toBe(generic);
    expect(authErrorMessage({ code: 'over_request_rate_limit', status: 429 })).toMatch(/Too many attempts/);
    expect(authErrorMessage({ name: 'AuthRetryableFetchError', status: 0 })).toMatch(/Could not reach the server/);
  });
});
