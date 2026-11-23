import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';

import { useAuthService, useAuthState } from '../auth/AuthContext';
import { AuthLayout, FormError } from '../auth/AuthLayout';
import { safeReturnPath } from '../auth/authService';
import { TextField } from '../components/forms';
import { Button, Card, Loading } from '../components/ui';
import { useDocumentTitle } from '../lib/useDocumentTitle';

// Second step for doctors who turned on two-step verification. The database
// withholds case data until this succeeds (assurance level aal2).
export function MfaChallengePage() {
  useDocumentTitle('Two-Step Verification');
  const auth = useAuthService();
  const state = useAuthState();
  const location = useLocation();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status === 'signedOut') {
    return <Navigate to="/login" replace />;
  }
  if (state.status === 'signedIn' || state.status === 'passwordChangeRequired' || state.status === 'accountCheckFailed') {
    return <Navigate to={safeReturnPath((location.state as { from?: unknown } | null)?.from)} replace />;
  }
  if (state.status === 'recovery') {
    return <Navigate to="/reset-password" replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const result = await auth.verifyMfa(code.replace(/\s/g, ''));
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      setCode('');
    }
  }

  return (
    <AuthLayout>
      <Card title="Two-step verification">
        {state.status === 'loading' ? (
          <Loading label="Checking your session…" />
        ) : (
          <form className="stack" onSubmit={(event) => void onSubmit(event)} noValidate aria-busy={busy}>
            <p className="callout">Enter the 6-digit code from the authenticator app on your phone.</p>
            <FormError message={error} />
            <TextField
              label="Authenticator code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              disabled={busy}
            />
            <Button type="submit" block disabled={busy}>
              {busy ? 'Checking…' : 'Verify'}
            </Button>
            <Button variant="plain" onClick={() => void auth.signOut()}>
              Sign Out
            </Button>
          </form>
        )}
      </Card>
    </AuthLayout>
  );
}
