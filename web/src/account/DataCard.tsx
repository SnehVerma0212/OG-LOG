import { useState, type FormEvent } from 'react';

import { FormError } from '../auth/AuthLayout';
import { useAuthService, useAuthState } from '../auth/AuthContext';
import { TextField } from '../components/forms';
import { Button, Card } from '../components/ui';
import { useRepository } from '../data/RepositoryContext';
import { saveFile } from '../lib/download';
import { usePhotoStore } from '../photos/PhotoStoreContext';
import { buildExport, deleteAccountCompletely } from './accountActions';
import { ExportError } from './recordsWorkbook';
import { useAccountService } from './AccountContext';

// Settings: download all of your data, or delete the account and everything in it.
export function DataCard({ mfaEnrolled }: { mfaEnrolled: boolean }) {
  const auth = useAuthService();
  const state = useAuthState();
  const repository = useRepository();
  const photos = usePhotoStore();
  const account = useAccountService();
  const services = { auth, repository, photos, account };

  const [progress, setProgress] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const busy = progress !== null;

  async function exportData(includePhotos: boolean) {
    if (busy || !('user' in state)) {
      return;
    }
    setExportError(null);
    setProgress('Preparing your export…');
    try {
      const { blob, filename } = await buildExport(services, state.user, { includePhotos, onProgress: setProgress });
      saveFile(blob, filename);
    } catch (error) {
      setExportError(error instanceof ExportError ? error.message : 'The export could not be completed. Nothing was saved. Try again.');
    } finally {
      setProgress(null);
    }
  }

  async function deleteAccount(event: FormEvent) {
    event.preventDefault();
    if (busy) {
      return;
    }
    if (confirmText !== 'DELETE') {
      setDeleteError('Type DELETE in capital letters to confirm.');
      return;
    }
    if (!password) {
      setDeleteError('Enter your password.');
      return;
    }
    setDeleteError(null);
    setProgress('Deleting…');
    const result = await deleteAccountCompletely(services, password, mfaEnrolled ? code.replace(/\s/g, '') : undefined, setProgress);
    setProgress(null);
    setPassword('');
    if (!result.ok) {
      setDeleteError(result.message);
    }
    // On success the sign-in page takes over.
  }

  return (
    <Card title="Your Data">
      <div className="stack">
        <div className="settings-row">
          <div className="settings-row__text">
            <span>Export</span>
            <span className="caption">
              Export Records downloads an Excel workbook of every case, section, photo list and your activity log.
              Export Records and Photos adds the photo files in a ZIP. Both may contain sensitive clinical information:
              keep them encrypted.
            </span>
          </div>
        </div>
        <div className="row">
          <Button variant="secondary" onClick={() => void exportData(false)} disabled={busy}>
            Export Records
          </Button>
          <Button variant="secondary" onClick={() => void exportData(true)} disabled={busy}>
            Export Records and Photos
          </Button>
        </div>
        <FormError message={exportError} />
        {progress ? (
          <p className="caption" role="status">
            {progress}
          </p>
        ) : null}

        <div className="settings-row">
          <div className="settings-row__text">
            <span>Delete account</span>
            <span className="caption">
              Permanently deletes your account, every case, every photo and your activity log. Export first if you want
              a copy. This cannot be undone.
            </span>
          </div>
          {!deleting ? (
            <Button variant="danger" onClick={() => setDeleting(true)} disabled={busy}>
              Delete Account
            </Button>
          ) : null}
        </div>
        {deleting ? (
          <form className="stack" onSubmit={(event) => void deleteAccount(event)} noValidate aria-busy={busy}>
            <FormError message={deleteError} />
            <TextField label="Type DELETE to confirm" autoComplete="off" value={confirmText} onChange={(event) => setConfirmText(event.target.value)} disabled={busy} />
            <TextField
              label="Your password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
            {mfaEnrolled ? (
              <TextField
                label="Authenticator code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                disabled={busy}
              />
            ) : null}
            <div className="row">
              <Button type="submit" variant="danger" disabled={busy}>
                Permanently Delete Everything
              </Button>
              <Button variant="secondary" onClick={() => setDeleting(false)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </Card>
  );
}
