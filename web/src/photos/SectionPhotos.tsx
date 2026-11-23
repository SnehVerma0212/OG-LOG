import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';

import type { SectionKey } from '@og-log/domain/cases';
import { createSingleFlight } from '@og-log/single-flight';

import { Button } from '../components/ui';
import { checkPhotoFile, PHOTO_ACCEPT, PHOTO_MAX_BYTES } from './photoFiles';
import { PhotoError, type CasePhoto } from './photoStore';
import { usePhotoStore } from './PhotoStoreContext';
import type { CasePhotosState } from './useCasePhotos';

interface PendingPhoto {
  key: number;
  file: File;
  previewUrl: string | null;
  status: 'ready' | 'uploading' | 'failed';
  progress: number;
  error: string | null;
}

interface Props {
  caseId: string;
  section: SectionKey;
  sectionLabel: string;
  state: CasePhotosState;
  onAdded: (photo: CasePhoto) => Promise<void>;
  onRemoved: (id: string) => void;
  onReload: () => void;
}

const errorMessage = (error: unknown, fallback: string) => (error instanceof PhotoError ? error.message : fallback);

// Photos for one section of a case: saved thumbnails with a larger view and
// removal, plus choosing, previewing and uploading new ones. A photo appears
// as saved only after the store confirms both its file and its record.
export function SectionPhotos({ caseId, section, sectionLabel, state, onAdded, onRemoved, onReload }: Props) {
  const store = usePhotoStore();
  const inputId = useId();
  const nextKey = useRef(1);
  const [uploadGuard] = useState(createSingleFlight);
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [removing, setRemoving] = useState<Record<string, { busy: boolean; error: string | null }>>({});
  const [viewer, setViewer] = useState<{ photo: CasePhoto; index: number; url: string | null; error: string | null } | null>(null);

  const saved = state.photos.filter((photo) => photo.section === section);
  const uploading = pending.some((item) => item.status === 'uploading');

  // Leaving mid-upload would interrupt it.
  useEffect(() => {
    if (!uploading) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uploading]);

  // Release local previews when this section goes away.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => () => pendingRef.current.forEach((item) => revoke(item.previewUrl)), []);

  function update(key: number, change: Partial<PendingPhoto>) {
    setPending((items) => items.map((item) => (item.key === key ? { ...item, ...change } : item)));
  }

  async function onChoose(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ''; // Allows choosing the same file again later.
    if (files.length === 0) {
      return; // Selection cancelled.
    }
    const accepted: PendingPhoto[] = [];
    const problems: string[] = [];
    for (const [index, file] of files.entries()) {
      const check = await checkPhotoFile(file);
      if (check.ok) {
        accepted.push({ key: nextKey.current++, file, previewUrl: preview(file), status: 'ready', progress: 0, error: null });
      } else {
        // File names can contain identifying details, so they are never shown.
        problems.push(`Photo ${index + 1} of ${files.length} was not added: ${check.message}`);
      }
    }
    setSkipped(problems);
    setPending((items) => [...items, ...accepted]);
  }

  async function upload(items: PendingPhoto[]) {
    await uploadGuard.run(async () => {
      for (const item of items) {
        update(item.key, { status: 'uploading', progress: 0, error: null });
        try {
          const photo = await store.uploadPhoto(caseId, section, item.file, (progress) => update(item.key, { progress }));
          await onAdded(photo);
          revoke(item.previewUrl);
          setPending((current) => current.filter((entry) => entry.key !== item.key));
        } catch (error) {
          update(item.key, { status: 'failed', error: errorMessage(error, 'The upload did not finish. Try again.') });
          if (error instanceof PhotoError && error.stage === 'partial') {
            onReload(); // Show the leftover entry so it can be removed.
          }
        }
      }
    });
  }

  function discard(key: number) {
    setPending((items) => {
      items.filter((item) => item.key === key).forEach((item) => revoke(item.previewUrl));
      return items.filter((item) => item.key !== key);
    });
  }

  async function remove(photo: CasePhoto) {
    if (removing[photo.id]?.busy) {
      return;
    }
    if (!window.confirm(`Remove this ${sectionLabel} photo? It will be permanently deleted.`)) {
      return;
    }
    setRemoving((current) => ({ ...current, [photo.id]: { busy: true, error: null } }));
    try {
      await store.deletePhoto(photo);
      onRemoved(photo.id);
      if (viewer?.photo.id === photo.id) {
        setViewer(null);
      }
      setRemoving(({ [photo.id]: _done, ...rest }) => rest);
    } catch (error) {
      const message = errorMessage(error, 'The photo could not be removed. Try again.');
      setRemoving((current) => ({ ...current, [photo.id]: { busy: false, error: message } }));
    }
  }

  async function open(photo: CasePhoto, index: number) {
    setViewer({ photo, index, url: null, error: null });
    try {
      // A fresh URL, in case the thumbnail's has expired.
      const url = (await store.viewUrls([photo])).get(photo.id) ?? null;
      setViewer((current) =>
        current?.photo.id === photo.id ? { ...current, url, error: url ? null : 'This photo is not available.' } : current,
      );
    } catch {
      setViewer((current) => (current?.photo.id === photo.id ? { ...current, error: 'This photo could not be loaded.' } : current));
    }
  }

  const ready = pending.filter((item) => item.status === 'ready');

  return (
    <div className="photos" aria-label={`${sectionLabel} photos`} role="group">
      <div className="photos__header">
        <h3 className="photos__title">
          {sectionLabel} photos <span className="caption">({state.status === 'ready' ? saved.length : '…'})</span>
        </h3>
        <label className="button button--secondary" htmlFor={inputId}>
          Add Photos
        </label>
        <input
          id={inputId}
          className="visually-hidden"
          type="file"
          accept={PHOTO_ACCEPT}
          multiple
          onChange={(event) => void onChoose(event)}
          aria-label={`Add ${sectionLabel} photos`}
        />
      </div>
      <p className="caption">JPEG, PNG or WebP, up to {PHOTO_MAX_BYTES / 1024 / 1024} MB each. Use synthetic images only.</p>

      {state.status === 'loading' ? <p className="caption" role="status">Loading photos…</p> : null}
      {state.status === 'error' ? (
        <div className="row">
          <p className="field__error">The photos could not be loaded.</p>
          <Button variant="secondary" onClick={onReload}>
            Try Again
          </Button>
        </div>
      ) : null}
      {state.status === 'ready' && saved.length === 0 && pending.length === 0 ? (
        <p className="caption">No {sectionLabel} photos yet.</p>
      ) : null}

      {saved.length > 0 ? (
        <ul className="photo-grid" aria-label={`Saved ${sectionLabel} photos`}>
          {saved.map((photo, index) => {
            const url = state.urls.get(photo.id) ?? null;
            const removal = removing[photo.id];
            const label = `${sectionLabel} photo ${index + 1}`;
            return (
              <li key={photo.id} className="photo-tile">
                {url ? (
                  <button type="button" className="photo-tile__open" onClick={() => void open(photo, index)} aria-label={`Open ${label}`}>
                    <img className="photo-tile__image" src={url} alt={label} loading="lazy" />
                  </button>
                ) : (
                  <div className="photo-tile__missing">Unavailable</div>
                )}
                <Button variant="plain" onClick={() => void remove(photo)} disabled={removal?.busy} aria-label={`Remove ${label}`}>
                  {removal?.busy ? 'Removing…' : removal?.error ? 'Retry Removal' : 'Remove'}
                </Button>
                {removal?.error ? (
                  <p className="field__error" role="alert">
                    {removal.error}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {skipped.length > 0 ? (
        <div className="error-summary" role="alert">
          <ul>
            {skipped.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {pending.length > 0 ? (
        <div className="stack stack--sm">
          <ul className="photo-grid" aria-label={`${sectionLabel} photos not uploaded yet`}>
            {pending.map((item, index) => (
              <li key={item.key} className="photo-tile">
                {item.previewUrl ? (
                  <img className="photo-tile__image" src={item.previewUrl} alt={`New ${sectionLabel} photo ${index + 1} (not uploaded)`} />
                ) : (
                  <div className="photo-tile__missing">New photo {index + 1}</div>
                )}
                {item.status === 'uploading' ? (
                  <progress max={1} value={item.progress} aria-label={`Uploading new ${sectionLabel} photo ${index + 1}`} />
                ) : null}
                {item.status === 'failed' ? (
                  <>
                    <p className="field__error" role="alert">
                      {item.error}
                    </p>
                    <div className="row">
                      <Button variant="secondary" onClick={() => void upload([item])} disabled={uploading}>
                        Retry
                      </Button>
                      <Button variant="plain" onClick={() => discard(item.key)} disabled={uploading}>
                        Discard
                      </Button>
                    </div>
                  </>
                ) : null}
                {item.status === 'ready' ? (
                  <Button variant="plain" onClick={() => discard(item.key)} disabled={uploading} aria-label={`Discard new ${sectionLabel} photo ${index + 1}`}>
                    Discard
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {ready.length > 0 ? (
            <div className="row">
              <Button onClick={() => void upload(ready)} disabled={uploading}>
                {uploading ? 'Uploading…' : `Upload ${ready.length} ${ready.length === 1 ? 'Photo' : 'Photos'}`}
              </Button>
              <Button variant="secondary" onClick={() => ready.forEach((item) => discard(item.key))} disabled={uploading}>
                Cancel
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {viewer ? (
        <PhotoViewer
          label={`${sectionLabel} photo ${viewer.index + 1}`}
          url={viewer.url}
          error={viewer.error}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </div>
  );
}

function PhotoViewer({ label, url, error, onClose }: { label: string; url: string | null; error: string | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="photo-viewer" role="dialog" aria-modal="true" aria-label={label} onClick={onClose}>
      <div className="photo-viewer__body" onClick={(event) => event.stopPropagation()}>
        <div className="row photo-viewer__bar">
          <span className="photo-viewer__title">{label}</span>
          <button type="button" className="button button--secondary" onClick={onClose} ref={closeRef}>
            Close
          </button>
        </div>
        {error ? <p className="field__error">{error}</p> : null}
        {!error && !url ? <p className="caption" role="status">Loading photo…</p> : null}
        {url ? <img className="photo-viewer__image" src={url} alt={label} /> : null}
      </div>
    </div>
  );
}

function preview(file: File): string | null {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
}

function revoke(url: string | null) {
  if (url && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url);
  }
}
