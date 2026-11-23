import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CaseInput } from '@og-log/domain/cases';

import { InMemoryCaseRepository } from '../data/inMemoryCaseRepository';
import { InMemoryPhotoStore } from '../photos/inMemoryPhotoStore';
import { fakeAccount, FakeAuthService, TEST_PASSWORD, TEST_TOTP_CODE, TEST_USER } from '../test/fakeAuthService';
import { renderApp } from '../test/renderApp';
import { syntheticImage } from '../test/syntheticImages';
import { InMemoryAccountService } from './inMemoryAccountService';

const input = (procedure: string): CaseInput => ({
  reference: '',
  surgeryDate: '2026-10-01',
  procedure,
  diagnosis: 'Synthetic diagnosis',
  role: 'primary',
  status: 'completed',
  sections: { preop: { indication: 'Synthetic indication' }, ot: {}, postop: {} },
});

async function seeded() {
  const repository = new InMemoryCaseRepository();
  const photos = new InMemoryPhotoStore();
  const account = new InMemoryAccountService();
  const first = await repository.createCase(input('Synthetic procedure one'));
  await repository.createCase(input('Synthetic procedure two'));
  await photos.uploadPhoto(first.id, 'ot', syntheticImage('image/jpeg'));
  account.filesRemain = () => photos.photos.size > 0;
  return { repository, photos, account, first };
}

describe('two-step verification', () => {
  it('asks for the code after the password, and opens the logbook only with a correct code', async () => {
    const user = userEvent.setup();
    const auth = new FakeAuthService({ status: 'signedOut', reason: 'none' }, fakeAccount({ mfaEnabled: true }));
    const { router } = renderApp('/statistics', undefined, { auth });
    await user.type(await screen.findByLabelText('Email'), TEST_USER.email);
    await user.type(screen.getByLabelText('Password'), TEST_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/verify-mfa'));

    await act(() => router.navigate('/cases')); // Direct URLs wait for the code too.
    expect(router.state.location.pathname).toBe('/verify-mfa');

    await user.type(screen.getByLabelText('Authenticator code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/code is not correct/);

    await user.type(screen.getByLabelText('Authenticator code'), TEST_TOTP_CODE);
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/cases'));
  });

  it('is set up in Settings with a QR code and a confirming code', async () => {
    const user = userEvent.setup();
    const auth = new FakeAuthService();
    renderApp('/settings', undefined, { auth });
    await user.click(await screen.findByRole('button', { name: 'Set Up' }));
    const card = screen.getByRole('region', { name: 'Two-Step Verification' });
    expect(within(card).getByRole('img', { name: 'QR code for your authenticator app' })).toBeTruthy();

    await user.type(within(card).getByLabelText('Code from the app'), '111111');
    await user.click(within(card).getByRole('button', { name: 'Turn On' }));
    expect((await within(card).findByRole('alert')).textContent).toMatch(/not correct/);
    expect(auth.account.mfaEnabled).toBe(false);

    await user.clear(within(card).getByLabelText('Code from the app'));
    await user.type(within(card).getByLabelText('Code from the app'), TEST_TOTP_CODE);
    await user.click(within(card).getByRole('button', { name: 'Turn On' }));
    expect(await within(card).findByText(/Signing in needs your password and a code/)).toBeTruthy();
    expect(auth.account.mfaEnabled).toBe(true);
    // Changing the password now also asks for a code.
    expect(within(screen.getByRole('region', { name: 'Change Password' })).getByLabelText('Authenticator code')).toBeTruthy();
  });
});

describe('data export', () => {
  // The workbook and ZIP contents are tested in recordsExport.test.ts.
  describe('from Settings', () => {
    let saved: Blob[] = [];
    let downloadName = '';
    beforeEach(() => {
      saved = [];
      downloadName = '';
      vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
        saved.push(blob as Blob);
        return 'blob:export';
      });
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        downloadName = this.download;
      });
    });
    afterEach(() => vi.restoreAllMocks());

    it('Export Records downloads an Excel workbook', async () => {
      const user = userEvent.setup();
      const { repository, photos, account } = await seeded();
      renderApp('/settings', repository, { photos, account });
      await user.click(await screen.findByRole('button', { name: 'Export Records' }));
      await waitFor(() => expect(saved).toHaveLength(1));
      expect(saved[0]!.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(downloadName).toMatch(/^oglog-records-\d{4}-\d{2}-\d{2}\.xlsx$/);
    });

    it('Export Records and Photos downloads a ZIP', async () => {
      const user = userEvent.setup();
      const { repository, photos, account } = await seeded();
      renderApp('/settings', repository, { photos, account });
      await user.click(await screen.findByRole('button', { name: 'Export Records and Photos' }));
      await waitFor(() => expect(saved).toHaveLength(1));
      expect(saved[0]!.type).toBe('application/zip');
      expect(downloadName).toMatch(/^oglog-records-and-photos-\d{4}-\d{2}-\d{2}\.zip$/);
    });

    it('explains a failed export and saves nothing', async () => {
      const user = userEvent.setup();
      const { repository, photos, account } = await seeded();
      photos.listAllPhotos = async () => {
        throw new Error('network');
      };
      renderApp('/settings', repository, { photos, account });
      await user.click(await screen.findByRole('button', { name: 'Export Records' }));
      expect((await screen.findByRole('alert')).textContent).toMatch(/could not be completed\. Nothing was saved/);
      expect(saved).toHaveLength(0);
    });
  });
});

describe('account deletion', () => {
  async function startDeletion(user: ReturnType<typeof userEvent.setup>, auth: FakeAuthService) {
    const { repository, photos, account } = await seeded();
    const view = renderApp('/settings', repository, { auth, photos, account });
    await user.click(await screen.findByRole('button', { name: 'Delete Account' }));
    return { ...view, repository, photos, account };
  }

  it('requires typing DELETE and the password, then removes photos before the account', async () => {
    const user = userEvent.setup();
    const auth = new FakeAuthService();
    const { router, photos, account } = await startDeletion(user, auth);

    await user.click(screen.getByRole('button', { name: 'Permanently Delete Everything' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Type DELETE in capital letters to confirm.');

    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.type(screen.getByLabelText('Your password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Permanently Delete Everything' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Your current password is incorrect.');
    expect(account.deleted).toBe(false);
    expect(photos.photos.size).toBe(1);

    await user.type(screen.getByLabelText('Your password'), TEST_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Permanently Delete Everything' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(photos.photos.size).toBe(0);
    expect(account.deleted).toBe(true);
    expect(await screen.findByText('Your account and all its records and photos were deleted.')).toBeTruthy();
  });

  it('keeps the account if photo files cannot be removed', async () => {
    const user = userEvent.setup();
    const auth = new FakeAuthService();
    const { photos, account } = await startDeletion(user, auth);
    photos.failNext.deleteFile = 1;
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.type(screen.getByLabelText('Your password'), TEST_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Permanently Delete Everything' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/photos could not be removed/);
    expect(account.deleted).toBe(false);
    expect(auth.getState().status).toBe('signedIn');
  });

  it('asks for the authenticator code when two-step verification is on', async () => {
    const user = userEvent.setup();
    const auth = new FakeAuthService(undefined, fakeAccount({ mfaEnabled: true }));
    await auth.verifyMfa(TEST_TOTP_CODE);
    const { account } = await startDeletion(user, auth);
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.type(screen.getByLabelText('Your password'), TEST_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Permanently Delete Everything' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the 6-digit code from your authenticator app.');
    expect(account.deleted).toBe(false);

    const data = screen.getByRole('region', { name: 'Your Data' });
    await user.type(within(data).getByLabelText('Your password'), TEST_PASSWORD);
    await user.type(within(data).getByLabelText('Authenticator code'), TEST_TOTP_CODE);
    await user.click(screen.getByRole('button', { name: 'Permanently Delete Everything' }));
    await waitFor(() => expect(account.deleted).toBe(true));
  });
});
