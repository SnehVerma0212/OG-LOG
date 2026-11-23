import { Navigate, Outlet, useLocation } from 'react-router';

import { Button, Card, Loading } from '../components/ui';
import { useAuthService, useAuthState } from './AuthContext';
import { AuthLayout } from './AuthLayout';
import { useIdleSignOut } from './useIdleSignOut';

// Wraps every private route. Authorization itself is enforced by the database
// (Row Level Security, including the first-login password policy); this only
// decides what to show.
export function RequireAuth() {
  const state = useAuthState();
  const auth = useAuthService();
  const location = useLocation();
  useIdleSignOut(state.status === 'signedIn');

  if (state.status === 'loading') {
    return (
      <main className="shell__main">
        <Loading label="Checking your session…" />
      </main>
    );
  }
  if (state.status === 'recovery') {
    return <Navigate to="/reset-password" replace />;
  }
  if (state.status === 'passwordChangeRequired') {
    return <Navigate to="/set-password" replace />;
  }
  if (state.status === 'mfaRequired') {
    return <Navigate to="/verify-mfa" replace state={{ from: location.pathname }} />;
  }
  if (state.status === 'signedOut') {
    // The return path travels in history state, not the URL.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (state.status === 'accountCheckFailed') {
    return (
      <AuthLayout>
        <Card title="Your account could not be checked">
          <div className="stack">
            <p className="callout" role="alert">
              OG-LOG could not confirm your account status, so your logbook stays closed. Check your connection and try
              again. If this keeps happening, the server setup may be incomplete; contact the administrator.
            </p>
            <Button onClick={() => void auth.retryAccountCheck()}>Try Again</Button>
            <Button variant="secondary" onClick={() => void auth.signOut()}>
              Sign Out
            </Button>
          </div>
        </Card>
      </AuthLayout>
    );
  }
  return <Outlet />;
}
