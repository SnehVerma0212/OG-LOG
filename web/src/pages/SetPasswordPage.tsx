import { Navigate, useNavigate } from 'react-router';

import { useAuthService, useAuthState } from '../auth/AuthContext';
import { AuthLayout } from '../auth/AuthLayout';
import { NewPasswordForm } from '../auth/NewPasswordForm';
import { Button, Card, Loading } from '../components/ui';
import { useNotify } from '../lib/notifications';
import { useDocumentTitle } from '../lib/useDocumentTitle';

// Mandatory after signing in with an administrator-issued initial password.
// Every other private page redirects here until the server confirms the
// password has changed.
export function SetPasswordPage() {
  useDocumentTitle('Set a New Password');
  const auth = useAuthService();
  const state = useAuthState();
  const navigate = useNavigate();
  const notify = useNotify();

  if (state.status === 'loading') {
    return (
      <AuthLayout>
        <Loading label="Checking your session…" />
      </AuthLayout>
    );
  }
  if (state.status === 'signedOut') {
    return <Navigate to="/login" replace />;
  }
  if (state.status === 'recovery') {
    return <Navigate to="/reset-password" replace />;
  }
  if (state.status === 'mfaRequired') {
    return <Navigate to="/verify-mfa" replace />;
  }
  if (state.status !== 'passwordChangeRequired') {
    return <Navigate to="/" replace />;
  }

  return (
    <AuthLayout>
      <Card title="Set a new password">
        <div className="stack">
          <p className="callout">
            You signed in with an initial password from the administrator. Choose your own password to open your
            logbook. Your logbook stays locked until you do.
          </p>
          <NewPasswordForm
            submitLabel="Save New Password"
            onSubmit={(password) => auth.updatePassword(password)}
            onSuccess={() => {
              notify('Password updated.');
              navigate('/', { replace: true });
            }}
          />
          <Button variant="plain" onClick={() => void auth.signOut()}>
            Sign Out
          </Button>
        </div>
      </Card>
    </AuthLayout>
  );
}
