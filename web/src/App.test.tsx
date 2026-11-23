import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryCaseRepository } from './data/inMemoryCaseRepository';
import { renderApp } from './test/renderApp';

const mainNav = () => screen.getAllByRole('navigation', { name: 'Main' })[0]!;

describe('application shell', () => {
  it('shows the dashboard with sample data clearly labelled as demo data', async () => {
    renderApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeTruthy();
    // Where the data lives stays visible in the sidebar; no warning banner.
    expect(screen.getByText(/lost when the page reloads/, { selector: '.caption' })).toBeTruthy();
    expect(screen.queryByText(/Development beta|Demo mode/)).toBeNull();
    expect(await screen.findByText('Total Cases: 5')).toBeTruthy();
    expect(screen.getByText('Drafts: 2')).toBeTruthy();
    expect(screen.getAllByText(/Ref SAMPLE-00\d/).length).toBeGreaterThan(0);
  });

  it('navigates between the main sections', async () => {
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });

    for (const [link, heading] of [
      ['My Cases', 'My Cases'],
      ['Statistics', 'Statistics'],
      ['Settings', 'Settings'],
      ['Dashboard', 'Dashboard'],
    ] as const) {
      await user.click(within(mainNav()).getByRole('link', { name: link }));
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeTruthy();
      expect(within(mainNav()).getByRole('link', { name: link }).getAttribute('aria-current')).toBe('page');
    }
  });

  it('shows an empty dashboard and case list when there are no cases', async () => {
    renderApp('/cases', new InMemoryCaseRepository());
    expect(await screen.findByText('No saved cases')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Create First Case' }).length).toBeGreaterThan(0);
  });

  it('shows a not-found page for unknown routes', async () => {
    renderApp('/does-not-exist');
    expect(await screen.findByText('Page not found')).toBeTruthy();
  });
});

describe('My Cases', () => {
  it('searches and filters the list', async () => {
    const user = userEvent.setup();
    renderApp('/cases');
    expect(await screen.findByText('5 cases')).toBeTruthy();

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'hernia');
    expect(await screen.findByText('Showing 1 of 1 matching case (5 in total)')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Inguinal hernia repair/ })).toBeTruthy();

    await user.clear(screen.getByRole('searchbox', { name: 'Search' }));
    await user.click(within(screen.getByRole('group', { name: 'Status' })).getByRole('radio', { name: 'Drafts' }));
    expect(await screen.findByText('Showing 2 of 2 matching cases (5 in total)')).toBeTruthy();

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'no such case');
    expect(await screen.findByText('No matching cases')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear Search and Filters' }));
    expect(await screen.findByText('5 cases')).toBeTruthy();
  });

  it('keeps search terms out of the URL', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/cases');
    await user.type(await screen.findByRole('searchbox', { name: 'Search' }), 'appendicitis');
    expect(router.state.location.search).toBe('');
    expect(router.state.location.pathname).toBe('/cases');
  });
});

describe('New Case', () => {
  it('shows accessible validation errors and saves nothing when invalid', async () => {
    const user = userEvent.setup();
    const repository = new InMemoryCaseRepository();
    renderApp('/cases/new', repository);

    await user.click(await screen.findByRole('button', { name: 'Save Draft' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    const procedure = screen.getByRole('textbox', { name: 'Procedure' });
    expect(procedure.getAttribute('aria-invalid')).toBe('true');
    expect(procedure.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(procedure.getAttribute('aria-describedby')!.split(' ')[0]!)?.textContent).toBe(
      'Enter the procedure name.',
    );
    expect(await repository.countCases()).toBe(0);
  });

  it('saves a draft, stays in the editor for it, then lists it in My Cases', async () => {
    const user = userEvent.setup();
    const repository = new InMemoryCaseRepository();
    const { router } = renderApp('/cases/new', repository);

    await user.type(await screen.findByRole('textbox', { name: 'Procedure' }), 'Synthetic test procedure');
    await user.click(screen.getByRole('button', { name: 'OT Record' }));
    await user.type(screen.getByRole('textbox', { name: 'Intraoperative findings' }), 'Synthetic finding');
    await user.click(screen.getByRole('button', { name: 'Preoperative' }));
    await user.click(screen.getByRole('button', { name: 'OT Record' }));
    // Input survives moving between sections.
    expect((screen.getByRole('textbox', { name: 'Intraoperative findings' }) as HTMLTextAreaElement).value).toBe(
      'Synthetic finding',
    );
    await user.click(screen.getByRole('button', { name: 'Save Draft' }));

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/cases\/[0-9a-f-]{36}\/edit$/));
    expect(await screen.findByText('Draft saved. You can now add photos.')).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit Case' })).toBeTruthy();

    await user.click(within(mainNav()).getByRole('link', { name: 'My Cases' }));
    expect(await screen.findByRole('link', { name: /Synthetic test procedure.*Draft/ })).toBeTruthy();
    const [saved] = await repository.listCases();
    expect(saved).toMatchObject({ procedure: 'Synthetic test procedure', status: 'draft' });
    expect((await repository.getCase(saved!.id))?.sections.ot.fields).toEqual({ findings: 'Synthetic finding' });
  });

  it('requires a diagnosis and role before marking completed', async () => {
    const user = userEvent.setup();
    const repository = new InMemoryCaseRepository();
    const { router } = renderApp('/cases/new', repository);

    await user.type(await screen.findByRole('textbox', { name: 'Procedure' }), 'Synthetic procedure');
    await user.click(screen.getByRole('button', { name: 'Save and Mark as Completed' }));
    expect(await screen.findByText('The case cannot be marked as completed yet.')).toBeTruthy();
    expect(await repository.countCases()).toBe(0);

    await user.type(screen.getByRole('textbox', { name: 'Diagnosis' }), 'Synthetic diagnosis');
    await user.click(screen.getByRole('radio', { name: 'Primary surgeon' }));
    await user.click(screen.getByRole('button', { name: 'Save and Mark as Completed' }));

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/cases\/[0-9a-f-]{36}$/));
    expect(await screen.findByText('Case marked as completed.')).toBeTruthy();
    expect(await screen.findByText('Completed')).toBeTruthy();
  });

  it('asks before discarding unsaved changes', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { router } = renderApp('/cases/new');

    await user.type(await screen.findByRole('textbox', { name: 'Procedure' }), 'Unsaved');
    await user.click(screen.getByRole('link', { name: 'Cancel' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe('/cases/new');

    await user.click(screen.getByRole('link', { name: 'Cancel' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/cases'));
  });

  it('saves only once when Save Draft is clicked repeatedly', async () => {
    const user = userEvent.setup();
    const repository = new InMemoryCaseRepository();
    renderApp('/cases/new', repository);
    await user.type(await screen.findByRole('textbox', { name: 'Procedure' }), 'Synthetic procedure');
    const save = screen.getByRole('button', { name: 'Save Draft' });
    await Promise.all([user.click(save), user.click(save), user.click(save)]);
    await screen.findByText('Draft saved. You can now add photos.');
    expect(await repository.countCases()).toBe(1);
  });
});

describe('Case details', () => {
  it('shows the case and its three sections, and deletes after confirmation', async () => {
    const user = userEvent.setup();
    const repository = new InMemoryCaseRepository();
    const created = await repository.createCase({
      reference: 'SAMPLE-900',
      surgeryDate: '2026-10-01',
      procedure: 'Synthetic procedure',
      diagnosis: 'Synthetic diagnosis',
      role: 'assistant',
      status: 'draft',
      sections: { preop: { asaGrade: 'ASA I' }, ot: {}, postop: { lengthOfStay: '2 days' } },
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { router } = renderApp(`/cases/${created.id}`, repository);

    expect(await screen.findByRole('heading', { level: 1, name: 'Synthetic procedure' })).toBeTruthy();
    for (const section of ['Preoperative', 'OT Record', 'Postoperative']) {
      expect(screen.getByRole('heading', { level: 2, name: section })).toBeTruthy();
    }
    expect(screen.getByText('ASA I')).toBeTruthy();
    expect(screen.getByText('2 days')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await repository.getCase(created.id)).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/cases'));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(await repository.getCase(created.id)).toBeNull();
    expect(await screen.findByText('Case deleted.')).toBeTruthy();
  });

  it('edits an existing case without creating a duplicate', async () => {
    const user = userEvent.setup();
    const repository = new InMemoryCaseRepository();
    const created = await repository.createCase({
      reference: '',
      surgeryDate: '2026-10-01',
      procedure: 'Before',
      diagnosis: '',
      role: null,
      status: 'draft',
      sections: { preop: {}, ot: {}, postop: {} },
    });
    const { router } = renderApp(`/cases/${created.id}/edit`, repository);

    const procedure = await screen.findByRole('textbox', { name: 'Procedure' });
    await user.clear(procedure);
    await user.type(procedure, 'After');
    await user.click(screen.getByRole('button', { name: 'Save Draft' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/cases'));
    expect(await repository.countCases()).toBe(1);
    expect((await repository.getCase(created.id))?.procedure).toBe('After');
  });

  it('refuses to overwrite a case that changed elsewhere after it was opened', async () => {
    const user = userEvent.setup();
    const repository = new InMemoryCaseRepository();
    const base = {
      reference: '',
      surgeryDate: '2026-10-01',
      diagnosis: '',
      role: null,
      status: 'draft' as const,
      sections: { preop: {}, ot: {}, postop: {} },
    };
    const created = await repository.createCase({ ...base, procedure: 'Original' });
    renderApp(`/cases/${created.id}/edit`, repository);
    const procedure = await screen.findByRole('textbox', { name: 'Procedure' });

    await repository.updateCase(created.id, { ...base, procedure: 'Saved in another tab' }); // e.g. a second device
    await user.clear(procedure);
    await user.type(procedure, 'Edited here');
    await user.click(screen.getByRole('button', { name: 'Save Draft' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/changed somewhere else after you opened it/);
    expect((await repository.getCase(created.id))?.procedure).toBe('Saved in another tab');
  });

  it('does not create a second copy when a save is retried after a lost response', async () => {
    const user = userEvent.setup();
    class LostResponseRepository extends InMemoryCaseRepository {
      lost = 1;
      override async createCase(...args: Parameters<InMemoryCaseRepository['createCase']>) {
        const record = await super.createCase(...args);
        if (this.lost-- > 0) {
          throw new Error('Network connection lost.'); // Saved, but the reply never arrived.
        }
        return record;
      }
    }
    const repository = new LostResponseRepository();
    const { router } = renderApp('/cases/new', repository);
    await user.type(await screen.findByRole('textbox', { name: 'Procedure' }), 'Synthetic procedure');
    await user.click(screen.getByRole('button', { name: 'Save Draft' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be saved/);

    await user.click(screen.getByRole('button', { name: 'Save Draft' }));
    const [saved] = await repository.listCases();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/cases/${saved!.id}/edit`));
    expect(await repository.countCases()).toBe(1);
  });

  it('reports a missing case', async () => {
    renderApp('/cases/00000000-0000-4000-8000-000000000000');
    expect(await screen.findByText('Case not found')).toBeTruthy();
  });
});

describe('Statistics and Settings', () => {
  it('calculates statistics from the repository', async () => {
    renderApp('/statistics');
    expect(await screen.findByText('Total Cases: 5')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Most Frequent Procedures' })).toBeTruthy();
  });

  it('shows the account, security and data sections, and no placeholders for unbuilt features', async () => {
    renderApp('/settings');
    expect(await screen.findByText('oglog-test-a@example.com')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Sign Out' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Change Password' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Set Up' })).toBeTruthy(); // Two-step verification
    expect(screen.getByRole('button', { name: 'Export Records and Photos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete Account' })).toBeTruthy();
    // Unbuilt features are not shown at all.
    expect(screen.queryByText('Not available yet')).toBeNull();
    expect(screen.queryByText(/Passkeys|Active sessions|Your profile/)).toBeNull();
    // The storage indicator still names the environment (demo data in tests).
    const storage = screen.getByText('Data storage').closest('.settings-row') as HTMLElement;
    expect(within(storage).getByText('Demo')).toBeTruthy();
  });

  it('updates the dashboard totals from saved records after creating a case', async () => {
    const user = userEvent.setup();
    const repository = new InMemoryCaseRepository();
    const { router } = renderApp('/', repository);
    expect(await screen.findByText('Total Cases: 0')).toBeTruthy();
    expect(screen.getByText('No cases yet')).toBeTruthy();

    await user.click(screen.getAllByRole('link', { name: 'Create First Case' })[0]!);
    await user.type(await screen.findByRole('textbox', { name: 'Procedure' }), 'Synthetic procedure');
    await user.click(screen.getByRole('button', { name: 'Save Draft' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/edit$/));

    await user.click(within(mainNav()).getByRole('link', { name: 'Dashboard' }));
    expect(await screen.findByText('Total Cases: 1')).toBeTruthy();
    expect(screen.getByText('Drafts: 1')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Synthetic procedure/ })).toBeTruthy();
  });
});
