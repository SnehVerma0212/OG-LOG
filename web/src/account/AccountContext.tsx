import { createContext, useContext, type ReactNode } from 'react';

import type { AccountService } from './accountService';

const AccountContext = createContext<AccountService | null>(null);

export function AccountProvider({ service, children }: { service: AccountService; children: ReactNode }) {
  return <AccountContext.Provider value={service}>{children}</AccountContext.Provider>;
}

export function useAccountService(): AccountService {
  const service = useContext(AccountContext);
  if (!service) {
    throw new Error('useAccountService must be used inside AccountProvider.');
  }
  return service;
}
