import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router';

import { useAuthService, useAuthState } from '../auth/AuthContext';
import { AuthLayout, FormError } from '../auth/AuthLayout';
import { safeReturnPath } from '../auth/authService';
import { IDLE_MINUTES } from '../auth/useIdleSignOut';
import { TextField } from '../components/forms';
import { Button, Card, Loading, Notice } from '../components/ui';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function LoginPage() {
  useDocumentTitle('Sign In');
  const auth = useAuthService();
  const state = useAuthState();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status === 'signedIn') {
    return <Navigate to={safeReturnPath((location.state as { from?: unknown } | null)?.from)} replace />;
  }
  if (state.status === 'recovery') {
    return <Navigate to="/reset-password" replace />;
  }
  if (state.status === 'passwordChangeRequired') {
    return <Navigate to="/set-password" replace />;
  }
  if (state.status === 'mfaRequired') {
    return <Navigate to="/verify-mfa" replace state={location.state} />;
  }
  if (state.status === 'accountCheckFailed') {
    return <Navigate to="/" replace />; // The private area explains and offers a retry.
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) {
      return;
    }
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await auth.signIn(email, password);
    // On success the auth state changes and this page redirects.
    if (!result.ok) {
      setError(result.message);
      setPassword('');
    }
    setBusy(false);
  }

  return (
    <AuthLayout>
      {state.status === 'signedOut' && state.reason === 'expired' ? (
        <Notice title="Your session has ended">Please sign in again to continue.</Notice>
      ) : null}
      {state.status === 'signedOut' && state.reason === 'signedOut' ? <p className="callout">You have signed out.</p> : null}
      {state.status === 'signedOut' && state.reason === 'accountDeleted' ? (
        <p className="callout" role="status">
          Your account and all its records and photos were deleted.
        </p>
      ) : null}
      {state.status === 'signedOut' && state.reason === 'idle' ? (
        <Notice title="Signed out after inactivity">
          For your patients' privacy, OG-LOG signs you out after {IDLE_MINUTES} minutes without activity. Unsaved changes were
          not kept.
        </Notice>
      ) : null}

      {state.status === 'loading' ? (
        <Loading label="Checking your session…" />
      ) : (
        <Card title="Sign in">
          <form className="stack" onSubmit={(event) => void onSubmit(event)} noValidate aria-busy={busy}>
            <FormError message={error} />
            <TextField
              label="Email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
            />
            <TextField
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
            <Button type="submit" block disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
            <Link to="/forgot-password" className="button button--plain">
              Forgot your password?
            </Link>
          </form>
        </Card>
      )}
    </AuthLayout>
  );
}
