import { RouterProvider, type createBrowserRouter } from 'react-router';

import { AccountProvider } from './account/AccountContext';
import type { AccountService } from './account/accountService';
import { AuthProvider } from './auth/AuthContext';
import type { AuthService } from './auth/authService';
import type { CaseRepository } from './data/caseRepository';
import { RepositoryProvider } from './data/RepositoryContext';
import { NotificationProvider } from './lib/notifications';
import type { PhotoStore } from './photos/photoStore';
import { PhotoStoreProvider } from './photos/PhotoStoreContext';

export interface AppServices {
  auth: AuthService;
  repository: CaseRepository;
  photos: PhotoStore;
  account: AccountService;
}

interface AppProps {
  services: AppServices;
  router: ReturnType<typeof createBrowserRouter>;
}

export function App({ services, router }: AppProps) {
  return (
    <AuthProvider service={services.auth}>
      <RepositoryProvider repository={services.repository}>
        <PhotoStoreProvider store={services.photos}>
          <AccountProvider service={services.account}>
            <NotificationProvider>
              <RouterProvider router={router} />
            </NotificationProvider>
          </AccountProvider>
        </PhotoStoreProvider>
      </RepositoryProvider>
    </AuthProvider>
  );
}
