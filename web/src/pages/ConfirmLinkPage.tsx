import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useAuthService } from '../auth/AuthContext';
import { AuthLayout } from '../auth/AuthLayout';
import type { EmailLinkType } from '../auth/authService';
import { ButtonLink, Card, Loading } from '../components/ui';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const TYPES: EmailLinkType[] = ['invite', 'recovery'];

// Landing page for emailed invitation and password-reset links, which carry a
// single-use token: /auth/confirm?token_hash=…&type=invite|recovery. The token
// is removed from the address bar and history before it is used.
export function ConfirmLinkPage() {
  useDocumentTitle('Opening Your Link');
  const auth = useAuthService();
  const navigate = useNavigate();
  const location = useLocation();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) {
      return; // Never use a single-use token twice (e.g. React StrictMode).
    }
    started.current = true;
    const params = new URLSearchParams(location.search);
    const tokenHash = params.get('token_hash') ?? '';
    const type = params.get('type') as EmailLinkType | null;
    navigate('/auth/confirm', { replace: true }); // Removes the token from the address bar and history.

    if (!/^[A-Za-z0-9_-]{10,200}$/.test(tokenHash) || !type || !TYPES.includes(type)) {
      setError('This link is incomplete or not valid. Request a new one.');
      return;
    }
    void auth.verifyEmailLink(tokenHash, type).then((result) => {
      if (result.ok) {
        // The sign-in screens take over: reset → new password; invitation → Set New Password.
        navigate(type === 'recovery' ? '/reset-password' : '/set-password', { replace: true });
      } else {
        setError(result.message);
      }
    });
  }, [auth, navigate, location.search]);

  return (
    <AuthLayout>
      <Card title="Opening your link">
        {error ? (
          <div className="stack">
            <p className="callout" role="alert">
              {error} Links work once and expire after a short time.
            </p>
            <ButtonLink to="/forgot-password">Request a New Password Link</ButtonLink>
            <ButtonLink to="/login" variant="plain">
              Back to Sign In
            </ButtonLink>
          </div>
        ) : (
          <Loading label="Checking your link…" />
        )}
      </Card>
    </AuthLayout>
  );
}
