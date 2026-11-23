import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryCaseRepository } from '../data/inMemoryCaseRepository';
import { renderApp } from '../test/renderApp';
import { syntheticImage } from '../test/syntheticImages';
import { InMemoryPhotoStore } from './inMemoryPhotoStore';

// Screens against the in-memory photo store. Real Storage policies are tested
// in supabase/tests/storage.test.ts and supabase/integration. Synthetic only.

async function setup() {
  const repository = new InMemoryCaseRepository();
  const created = await repository.createCase({
    reference: '',
    surgeryDate: '2026-10-01',
    procedure: 'Synthetic procedure',
    diagnosis: '',
    role: null,
    status: 'draft',
    sections: { preop: {}, ot: {}, postop: {} },
  });
  const photos = new InMemoryPhotoStore();
  const view = renderApp(`/cases/${created.id}`, repository, { photos });
  await screen.findByRole('heading', { level: 1, name: 'Synthetic procedure' });
  return { ...view, caseId: created.id, photos, repository };
}

const group = (label: string) => screen.getByRole('group', { name: `${label} photos` });
const savedPhotos = (label: string) => within(group(label)).queryByRole('list', { name: `Saved ${label} photos` });

describe('case photos', () => {
  it('shows a separate photo area for each of the three sections', async () => {
    await setup();
    for (const label of ['Preoperative', 'OT Record', 'Postoperative']) {
      expect(await within(group(label)).findByText(`No ${label} photos yet.`)).toBeTruthy();
      expect(screen.getByLabelText(`Add ${label} photos`)).toBeTruthy();
    }
  });

  it('previews chosen photos, uploads them to the right case and section, and lists them only when saved', async () => {
    const user = userEvent.setup();
    const { photos, caseId } = await setup();

    await user.upload(screen.getByLabelText('Add OT Record photos'), [syntheticImage('image/jpeg'), syntheticImage('image/png')]);
    const pending = await within(group('OT Record')).findByRole('list', { name: 'OT Record photos not uploaded yet' });
    expect(within(pending).getAllByRole('listitem')).toHaveLength(2);
    expect(savedPhotos('OT Record')).toBeNull();
    expect(photos.photos.size).toBe(0); // Nothing is sent before Upload.

    await user.click(screen.getByRole('button', { name: 'Upload 2 Photos' }));
    const saved = await within(group('OT Record')).findByRole('list', { name: 'Saved OT Record photos' });
    expect(within(saved).getAllByRole('img')).toHaveLength(2);
    expect(within(group('OT Record')).queryByRole('list', { name: 'OT Record photos not uploaded yet' })).toBeNull();

    expect([...photos.photos.values()].map(({ caseId: id, section }) => ({ id, section }))).toEqual([
      { id: caseId, section: 'ot' },
      { id: caseId, section: 'ot' },
    ]);
    expect(savedPhotos('Preoperative')).toBeNull();
    expect(savedPhotos('Postoperative')).toBeNull();
  });

  it('keeps photos with their case and section after reloading the page', async () => {
    const user = userEvent.setup();
    const { photos, repository, caseId, unmount } = await setup();
    await user.upload(screen.getByLabelText('Add Postoperative photos'), syntheticImage('image/webp'));
    await user.click(screen.getByRole('button', { name: 'Upload 1 Photo' }));
    await within(group('Postoperative')).findByRole('list', { name: 'Saved Postoperative photos' });
    unmount();

    renderApp(`/cases/${caseId}`, repository, { photos });
    const saved = await within(await screen.findByRole('group', { name: 'Postoperative photos' })).findByRole('list', {
      name: 'Saved Postoperative photos',
    });
    expect(within(saved).getByRole('img', { name: 'Postoperative photo 1' })).toBeTruthy();
    expect(savedPhotos('Preoperative')).toBeNull();
  });

  it('refuses unsupported or oversized files without showing file names', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const { photos } = await setup();
    await user.upload(screen.getByLabelText('Add Preoperative photos'), [
      new File(['%PDF synthetic'], 'Patient Name scan.pdf', { type: 'application/pdf' }),
      syntheticImage('image/jpeg', 11 * 1024 * 1024),
      syntheticImage('image/jpeg'),
    ]);
    const alert = await within(group('Preoperative')).findByRole('alert');
    expect(alert.textContent).toContain('Photo 1 of 3 was not added: Only JPEG, PNG and WebP photos can be added.');
    expect(alert.textContent).toContain('Photo 2 of 3 was not added: Photos must be 10 MB or smaller.');
    expect(document.body.textContent).not.toContain('Patient Name');
    expect(screen.getByRole('button', { name: 'Upload 1 Photo' })).toBeTruthy();
    expect(photos.photos.size).toBe(0);
  });

  it('does nothing when the selection is cancelled', async () => {
    const user = userEvent.setup();
    await setup();
    await user.upload(screen.getByLabelText('Add OT Record photos'), []);
    expect(within(group('OT Record')).queryByRole('button', { name: /Upload/ })).toBeNull();
    expect(within(group('OT Record')).queryByRole('alert')).toBeNull();
  });

  it('reports a failed upload, saves nothing, and succeeds once on retry', async () => {
    const user = userEvent.setup();
    const { photos } = await setup();
    photos.failNext.upload = 1;

    await user.upload(screen.getByLabelText('Add OT Record photos'), syntheticImage('image/jpeg'));
    await user.click(screen.getByRole('button', { name: 'Upload 1 Photo' }));
    expect((await within(group('OT Record')).findByRole('alert')).textContent).toBe(
      'The upload did not finish. Check your connection and try again.',
    );
    expect(savedPhotos('OT Record')).toBeNull();
    expect(photos.photos.size).toBe(0);

    await user.click(within(group('OT Record')).getByRole('button', { name: 'Retry' }));
    const saved = await within(group('OT Record')).findByRole('list', { name: 'Saved OT Record photos' });
    expect(within(saved).getAllByRole('img')).toHaveLength(1);
    expect(photos.photos.size).toBe(1);
  });

  it('reports a failed record save the same way', async () => {
    const user = userEvent.setup();
    const { photos } = await setup();
    photos.failNext.record = 1;
    await user.upload(screen.getByLabelText('Add Preoperative photos'), syntheticImage('image/png'));
    await user.click(screen.getByRole('button', { name: 'Upload 1 Photo' }));
    expect((await within(group('Preoperative')).findByRole('alert')).textContent).toBe('The photo could not be saved. Try again.');
    expect(photos.photos.size).toBe(0);
  });

  it('uploads only once when Upload is clicked repeatedly', async () => {
    const user = userEvent.setup();
    const { photos } = await setup();
    await user.upload(screen.getByLabelText('Add OT Record photos'), syntheticImage('image/jpeg'));
    const button = screen.getByRole('button', { name: 'Upload 1 Photo' });
    await Promise.all([user.click(button), user.click(button), user.click(button)]);
    await within(group('OT Record')).findByRole('list', { name: 'Saved OT Record photos' });
    expect(photos.photos.size).toBe(1);
  });

  it('removes a photo after confirmation, and reports and retries a partial failure', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    const { photos } = await setup();
    await user.upload(screen.getByLabelText('Add OT Record photos'), syntheticImage('image/jpeg'));
    await user.click(screen.getByRole('button', { name: 'Upload 1 Photo' }));
    await within(group('OT Record')).findByRole('list', { name: 'Saved OT Record photos' });

    await user.click(screen.getByRole('button', { name: 'Remove OT Record photo 1' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(photos.photos.size).toBe(1);

    photos.failNext.deleteRecord = 1;
    await user.click(screen.getByRole('button', { name: 'Remove OT Record photo 1' }));
    expect((await within(group('OT Record')).findByRole('alert')).textContent).toBe(
      'The photo file was removed, but its entry could not be deleted. Remove it again to finish.',
    );
    expect(savedPhotos('OT Record')).not.toBeNull(); // Still listed until fully removed.

    await user.click(screen.getByRole('button', { name: 'Remove OT Record photo 1' }));
    await waitFor(() => expect(savedPhotos('OT Record')).toBeNull());
    expect(photos.photos.size).toBe(0);
  });

  it('opens a larger view and closes it with Escape', async () => {
    const user = userEvent.setup();
    await setup();
    await user.upload(screen.getByLabelText('Add Preoperative photos'), syntheticImage('image/jpeg'));
    await user.click(screen.getByRole('button', { name: 'Upload 1 Photo' }));
    await user.click(await screen.findByRole('button', { name: 'Open Preoperative photo 1' }));

    const dialog = await screen.findByRole('dialog', { name: 'Preoperative photo 1' });
    expect(await within(dialog).findByRole('img', { name: 'Preoperative photo 1' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('deletes a case’s photos before the case, and keeps the case if that fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const { photos, repository, caseId, router } = await setup();
    await user.upload(screen.getByLabelText('Add OT Record photos'), syntheticImage('image/jpeg'));
    await user.click(screen.getByRole('button', { name: 'Upload 1 Photo' }));
    await within(group('OT Record')).findByRole('list', { name: 'Saved OT Record photos' });

    photos.failNext.deleteFile = 1;
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith("The case's photos could not be removed, so the case was not deleted. Try again."));
    expect(await repository.getCase(caseId)).not.toBeNull();
    expect(photos.photos.size).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/cases'));
    expect(await repository.getCase(caseId)).toBeNull();
    expect(photos.photos.size).toBe(0);
  });

  it('shows an error with retry when photos cannot be loaded', async () => {
    const user = userEvent.setup();
    const repository = new InMemoryCaseRepository();
    const created = await repository.createCase({
      reference: '',
      surgeryDate: '2026-10-01',
      procedure: 'Synthetic procedure',
      diagnosis: '',
      role: null,
      status: 'draft',
      sections: { preop: {}, ot: {}, postop: {} },
    });
    const photos = new InMemoryPhotoStore();
    photos.failNext.list = 1;
    renderApp(`/cases/${created.id}`, repository, { photos });
    const preop = await screen.findByRole('group', { name: 'Preoperative photos' });
    expect(await within(preop).findByText('The photos could not be loaded.')).toBeTruthy();
    await user.click(within(preop).getByRole('button', { name: 'Try Again' }));
    expect(await within(preop).findByText('No Preoperative photos yet.')).toBeTruthy();
  });
});

describe('photos while creating a case', () => {
  it('explains that a draft must be saved first, and offers no uploads before that', async () => {
    renderApp('/cases/new', new InMemoryCaseRepository());
    expect(await screen.findByText(/Photos: save this case as a draft first/)).toBeTruthy();
    expect(screen.queryByLabelText(/Add .* photos/)).toBeNull();
  });

  it('saves a draft once, then adds photos to that saved case and completes it', async () => {
    const user = userEvent.setup();
    const repository = new InMemoryCaseRepository();
    const photos = new InMemoryPhotoStore();
    const { router } = renderApp('/cases/new', repository, { photos });

    await user.type(await screen.findByRole('textbox', { name: 'Procedure' }), 'Synthetic procedure');
    const save = screen.getByRole('button', { name: 'Save Draft' });
    await Promise.all([user.click(save), user.click(save)]);
    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/edit$/));
    const [saved] = await repository.listCases();
    expect(await repository.countCases()).toBe(1);
    expect(router.state.location.pathname).toBe(`/cases/${saved!.id}/edit`);

    // The active section's photos are shown; the others are a step away.
    await user.upload(await screen.findByLabelText('Add Preoperative photos'), syntheticImage('image/jpeg'));
    await user.click(screen.getByRole('button', { name: 'OT Record' }));
    await user.upload(screen.getByLabelText('Add OT Record photos'), syntheticImage('image/png'));
    await user.click(screen.getByRole('button', { name: 'Upload 1 Photo' }));
    await within(group('OT Record')).findByRole('list', { name: 'Saved OT Record photos' });

    // A photo chosen in another section survives switching sections.
    await user.click(screen.getByRole('button', { name: 'Preoperative' }));
    await user.click(screen.getByRole('button', { name: 'Upload 1 Photo' }));
    await within(group('Preoperative')).findByRole('list', { name: 'Saved Preoperative photos' });

    expect([...photos.photos.values()].map((photo) => [photo.caseId, photo.section]).sort()).toEqual([
      [saved!.id, 'ot'],
      [saved!.id, 'preop'],
    ]);

    // Continue editing and complete the same case.
    await user.type(screen.getByRole('textbox', { name: 'Diagnosis' }), 'Synthetic diagnosis');
    await user.click(screen.getByRole('radio', { name: 'Primary surgeon' }));
    await user.click(screen.getByRole('button', { name: 'Save and Mark as Completed' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/cases/${saved!.id}`));
    expect(await repository.countCases()).toBe(1);
    expect((await repository.getCase(saved!.id))?.status).toBe('completed');
    expect(within(await screen.findByRole('group', { name: 'OT Record photos' })).getAllByRole('img')).toHaveLength(1);
  });
});
