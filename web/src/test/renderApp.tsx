import { render } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';

import { App } from '../App';
import type { CaseRepository } from '../data/caseRepository';
import { InMemoryCaseRepository } from '../data/inMemoryCaseRepository';
import { sampleCases } from '../data/sampleCases';
import { routes } from '../routes';

// Renders the real route tree and providers at `path`.
export function renderApp(path: string, repository: CaseRepository = new InMemoryCaseRepository(sampleCases(new Date()))) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(<App repository={repository} router={router} />);
  return { ...view, router, repository };
}
