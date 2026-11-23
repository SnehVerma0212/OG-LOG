import { render } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';

import { InMemoryAccountService } from '../account/inMemoryAccountService';
import type { AccountService } from '../account/accountService';
import { App } from '../App';
import type { CaseRepository } from '../data/caseRepository';
import { InMemoryCaseRepository } from '../data/inMemoryCaseRepository';
import { sampleCases } from '../data/sampleCases';
import { InMemoryPhotoStore } from '../photos/inMemoryPhotoStore';
import type { PhotoStore } from '../photos/photoStore';
import { routes } from '../routes';
import { FakeAuthService } from './fakeAuthService';

interface Options {
  auth?: FakeAuthService;
  photos?: PhotoStore;
  account?: AccountService;
}

// Renders the real route tree and providers at `path`, signed in as the
// synthetic test user unless another auth state is given.
export function renderApp(
  path: string,
  repository: CaseRepository = new InMemoryCaseRepository(sampleCases(new Date())),
  { auth = new FakeAuthService(), photos = new InMemoryPhotoStore(), account = new InMemoryAccountService() }: Options = {},
) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(<App services={{ auth, repository, photos, account }} router={router} />);
  return { ...view, router, repository, auth, photos, account };
}
