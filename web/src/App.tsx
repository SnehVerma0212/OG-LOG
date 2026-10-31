import { RouterProvider, type createBrowserRouter } from 'react-router';

import type { CaseRepository } from './data/caseRepository';
import { RepositoryProvider } from './data/RepositoryContext';
import { NotificationProvider } from './lib/notifications';

interface AppProps {
  repository: CaseRepository;
  router: ReturnType<typeof createBrowserRouter>;
}

export function App({ repository, router }: AppProps) {
  return (
    <RepositoryProvider repository={repository}>
      <NotificationProvider>
        <RouterProvider router={router} />
      </NotificationProvider>
    </RepositoryProvider>
  );
}
