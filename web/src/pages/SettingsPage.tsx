import { useState } from 'react';

import { DataCard } from '../account/DataCard';
import { TwoStepCard } from '../account/TwoStepCard';
import { useAuthService, useAuthState } from '../auth/AuthContext';
import { NewPasswordForm } from '../auth/NewPasswordForm';
import { Badge, Button, Card, PageHeader } from '../components/ui';
import { useNotify } from '../lib/notifications';
import { useRepository } from '../data/RepositoryContext';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function SettingsPage() {
  useDocumentTitle('Settings');
  const repository = useRepository();
  const auth = useAuthService();
  const authState = useAuthState();
  const email = authState.status === 'signedIn' ? authState.user.email : null;
  const notify = useNotify();
  const [passwordChanged, setPasswordChanged] = useState(false);
  const mfa = useAsync(() => auth.mfaStatus(), [auth]);
  const mfaEnrolled = mfa.state.status === 'ready' ? mfa.state.data.enrolled : null;

  return (
    <>
      <PageHeader title="Settings" />

      <Card title="Account">
        <div className="settings-row">
          <div className="settings-row__text">
            <span>Signed in</span>
            <span className="caption">{email ?? 'Your account'}</span>
          </div>
          <Button variant="secondary" onClick={() => void auth.signOut()}>
            Sign Out
          </Button>
        </div>
      </Card>

      <Card title="Change Password">
        {passwordChanged ? (
          <p className="callout" role="status">
            Your password was changed. Use the new password next time you sign in.
          </p>
        ) : null}
        <NewPasswordForm
          askCurrent
          askCode={mfaEnrolled === true}
          submitLabel="Change Password"
          onSubmit={(newPassword, currentPassword, code) => auth.changePassword(currentPassword, newPassword, code)}
          onSuccess={() => {
            setPasswordChanged(true);
            notify('Password changed.');
          }}
        />
      </Card>

      <TwoStepCard enrolled={mfaEnrolled} onChange={mfa.retry} />

      <DataCard mfaEnrolled={mfaEnrolled === true} />

      <Card title="About OG-LOG">
        <p className="callout">
          A personal surgical logbook for recording your own cases across preoperative, OT and postoperative stages.
        </p>
        <div className="settings-row">
          <div className="settings-row__text">
            <span>Data storage</span>
            <span className="caption">{repository.storageDescription}</span>
          </div>
          <Badge label={repository.kind === 'sample' ? 'Demo' : 'Development'} tone="neutral" />
        </div>
      </Card>
    </>
  );
}
