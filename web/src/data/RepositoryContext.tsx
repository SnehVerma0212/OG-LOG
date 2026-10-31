import { createContext, useContext, type ReactNode } from 'react';

import type { CaseRepository } from './caseRepository';

const RepositoryContext = createContext<CaseRepository | null>(null);

export function RepositoryProvider({ repository, children }: { repository: CaseRepository; children: ReactNode }) {
  return <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>;
}

export function useRepository(): CaseRepository {
  const repository = useContext(RepositoryContext);
  if (!repository) {
    throw new Error('useRepository must be used inside RepositoryProvider.');
  }
  return repository;
}
