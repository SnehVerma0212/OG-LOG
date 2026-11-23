import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';

import { useAuthService, useAuthState } from '../auth/AuthContext';
import { AuthLayout } from '../auth/AuthLayout';
import { NewPasswordForm } from '../auth/NewPasswordForm';
import { ButtonLink, Card, Loading } from '../components/ui';
import { useNotify } from '../lib/notifications';
import { useDocumentTitle } from '../lib/useDocumentTitle';

// Supabase reports a used or expired link with error parameters on the
// redirect (query string or fragment). Read once, on first render.
function linkErrorInUrl(): boolean {
  const params = `${window.location.search}&${window.location.hash.replace(/^#/, '')}`;
  return /(^|[?&])(error|error_code)=/.test(params);
}

export function ResetPasswordPage() {
  useDocumentTitle('Choose a New Password');
  const auth = useAuthService();
  const state = useAuthState();
  const navigate = useNavigate();
  const notify = useNotify();
  const [linkFailed] = useState(linkErrorInUrl);
  // Set while a new password is being saved, so the page does not flash the
  // "already signed in" message when the reset session becomes a normal one.
  const [saving, setSaving] = useState(false);
  // With two-step verification on, the new password also needs the
  // authenticator code (Supabase requires it; null while being checked).
  const [askCode, setAskCode] = useState<boolean | null>(null);
  const recovering = state.status === 'recovery';

  useEffect(() => {
    if (!recovering) {
      return;
    }
    let current = true;
    void auth.mfaStatus().then(
      ({ enrolled }) => current && setAskCode(enrolled),
      // Unknown: offer the field; it is used only if the account needs it.
      () => current && setAskCode(true),
    );
    return () => {
      current = false;
    };
  }, [auth, recovering]);

  if (state.status === 'passwordChangeRequired' && !saving) {
    return <Navigate to="/set-password" replace />;
  }
  if (state.status === 'mfaRequired' && !saving) {
    return <Navigate to="/verify-mfa" replace />;
  }

  let content;
  if (state.status === 'loading' || (saving && state.status !== 'recovery')) {
    content = <Loading label="Checking your reset link…" />;
  } else if (state.status === 'signedOut') {
    content = (
      <div className="stack">
        <p className="callout" role="alert">
          {linkFailed
            ? 'This reset link is invalid or has expired.'
            : 'Open the reset link from your email in this browser to choose a new password.'}{' '}
          Reset links work once, expire after a short time, and must be opened in the browser where you requested them.
        </p>
        <ButtonLink to="/forgot-password">Request a New Link</ButtonLink>
        <ButtonLink to="/login" variant="plain">
          Back to Sign In
        </ButtonLink>
      </div>
    );
  } else if (state.status === 'recovery' && askCode === null) {
    content = <Loading label="Checking your reset link…" />;
  } else if (state.status === 'recovery') {
    // Only a session from a reset link may set a password here without the
    // current one. (It also clears a pending initial-password requirement.)
    content = (
      <NewPasswordForm
        submitLabel="Save New Password"
        askCode={askCode ?? false}
        onSubmit={async (password, _current, code) => {
          setSaving(true);
          const result = await auth.updatePassword(password, askCode ? code : undefined);
          if (!result.ok) {
            setSaving(false);
          }
          return result;
        }}
        onSuccess={() => {
          notify('Password updated.');
          navigate('/', { replace: true });
        }}
      />
    );
  } else {
    // Signed in normally: changing the password needs the current one, in Settings.
    content = (
      <div className="stack">
        <p className="callout" role="status">
          You are already signed in. To change your password, use Settings, which asks for your current password. If
          you opened a reset link and then reloaded this page, request a new link after signing out.
        </p>
        <ButtonLink to="/settings">Go to Settings</ButtonLink>
        <ButtonLink to="/" variant="plain">
          Back to Dashboard
        </ButtonLink>
      </div>
    );
  }

  return (
    <AuthLayout>
      <Card title="Choose a new password">{content}</Card>
    </AuthLayout>
  );
}
