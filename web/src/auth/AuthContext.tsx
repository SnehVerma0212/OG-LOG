import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';

import type { AuthService, AuthState } from './authService';

const AuthContext = createContext<AuthService | null>(null);

export function AuthProvider({ service, children }: { service: AuthService; children: ReactNode }) {
  return <AuthContext.Provider value={service}>{children}</AuthContext.Provider>;
}

export function useAuthService(): AuthService {
  const service = useContext(AuthContext);
  if (!service) {
    throw new Error('useAuthService must be used inside AuthProvider.');
  }
  return service;
}

export function useAuthState(): AuthState {
  const service = useAuthService();
  return useSyncExternalStore(
    (listener) => service.subscribe(listener),
    () => service.getState(),
  );
}
