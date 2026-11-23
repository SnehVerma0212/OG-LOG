import { useCallback, useEffect, useState } from 'react';

import type { CasePhoto } from './photoStore';
import { usePhotoStore } from './PhotoStoreContext';

export interface CasePhotosState {
  status: 'loading' | 'ready' | 'error';
  photos: CasePhoto[];
  // Short-lived display URLs by photo ID; null when the file is unavailable.
  urls: Map<string, string | null>;
}

// Loads a case's saved photos (all sections) and their display URLs. The list
// only changes after the store confirms an upload or removal. `null` means the
// case is not saved yet: nothing is loaded.
export function useCasePhotos(caseId: string | null) {
  const store = usePhotoStore();
  const [state, setState] = useState<CasePhotosState>({ status: 'loading', photos: [], urls: new Map() });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!caseId) {
      setState({ status: 'ready', photos: [], urls: new Map() });
      return;
    }
    let active = true;
    (async () => {
      const photos = await store.listPhotos(caseId);
      const urls = await store.viewUrls(photos);
      return { photos, urls };
    })().then(
      ({ photos, urls }) => active && setState({ status: 'ready', photos, urls }),
      () => active && setState((current) => ({ ...current, status: 'error' })),
    );
    return () => {
      active = false;
    };
  }, [store, caseId, attempt]);

  const reload = useCallback(() => {
    setState((current) => ({ ...current, status: 'loading' }));
    setAttempt((value) => value + 1);
  }, []);

  const added = useCallback(
    async (photo: CasePhoto) => {
      const urls = await store.viewUrls([photo]).catch(() => new Map<string, string | null>());
      setState((current) => ({
        ...current,
        photos: [...current.photos.filter((item) => item.id !== photo.id), photo],
        urls: new Map([...current.urls, [photo.id, urls.get(photo.id) ?? null]]),
      }));
    },
    [store],
  );

  const removed = useCallback((id: string) => {
    setState((current) => ({ ...current, photos: current.photos.filter((photo) => photo.id !== id) }));
  }, []);

  return { state, reload, added, removed };
}
