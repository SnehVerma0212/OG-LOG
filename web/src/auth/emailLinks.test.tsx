import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { fakeAccount, FakeAuthService } from '../test/fakeAuthService';
import { renderApp } from '../test/renderApp';

// Invitation and password-reset links ({{ .TokenHash }} email templates).
const TOKEN = 'f1e2d3c4b5a6978877665544332211aabbccddeeff00112233445566';
const signedOut = () => new FakeAuthService({ status: 'signedOut', reason: 'none' }, fakeAccount());

describe('emailed links', () => {
  it('an invitation opens Set New Password for the invited account, and removes the token from the address', async () => {
    const user = userEvent.setup();
    const auth = signedOut();
    auth.validLinkTokens.add(TOKEN);
    const { router } = renderApp(`/auth/confirm?token_hash=${TOKEN}&type=invite`, undefined, { auth });

    await waitFor(() => expect(router.state.location.pathname).toBe('/set-password'));
    expect(auth.calls.emailLinks).toEqual([{ tokenHash: TOKEN, type: 'invite' }]);
    expect(router.state.location.search).toBe('');

    await user.type(await screen.findByLabelText('New password'), 'river lamp orbit tulip');
    await user.type(screen.getByLabelText('Confirm new password'), 'river lamp orbit tulip');
    await user.click(screen.getByRole('button', { name: 'Save New Password' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(auth.account.passwordChangeRequired).toBe(false);
  });

  it('a reset link opens the new-password form on any device', async () => {
    const auth = signedOut();
    auth.validLinkTokens.add(TOKEN);
    const { router } = renderApp(`/auth/confirm?token_hash=${TOKEN}&type=recovery`, undefined, { auth });
    await waitFor(() => expect(router.state.location.pathname).toBe('/reset-password'));
    expect(await screen.findByLabelText('New password')).toBeTruthy();
  });

  it('explains used, expired or invalid links and offers a new one', async () => {
    const auth = signedOut(); // Token not accepted (already used or expired).
    renderApp(`/auth/confirm?token_hash=${TOKEN}&type=recovery`, undefined, { auth });
    expect((await screen.findByRole('alert')).textContent).toMatch(/invalid, has expired, or was already used/);
    expect(screen.getByRole('link', { name: 'Request a New Password Link' })).toBeTruthy();
    expect(auth.getState().status).toBe('signedOut');
  });

  it('rejects malformed links without contacting the server', async () => {
    for (const query of ['', '?type=invite', `?token_hash=${TOKEN}&type=signup`, '?token_hash=<script>&type=invite']) {
      const auth = signedOut();
      const view = renderApp(`/auth/confirm${query}`, undefined, { auth });
      expect((await screen.findByRole('alert')).textContent).toMatch(/incomplete or not valid/);
      expect(auth.calls.emailLinks).toEqual([]);
      view.unmount();
    }
  });
});
