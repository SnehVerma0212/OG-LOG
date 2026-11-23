import { createContext, useContext, type ReactNode } from 'react';

import type { PhotoStore } from './photoStore';

const PhotoStoreContext = createContext<PhotoStore | null>(null);

export function PhotoStoreProvider({ store, children }: { store: PhotoStore; children: ReactNode }) {
  return <PhotoStoreContext.Provider value={store}>{children}</PhotoStoreContext.Provider>;
}

export function usePhotoStore(): PhotoStore {
  const store = useContext(PhotoStoreContext);
  if (!store) {
    throw new Error('usePhotoStore must be used inside PhotoStoreProvider.');
  }
  return store;
}
