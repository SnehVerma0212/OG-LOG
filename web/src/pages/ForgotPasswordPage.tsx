import { useState, type FormEvent } from 'react';

import { useAuthService } from '../auth/AuthContext';
import { AuthLayout, FormError } from '../auth/AuthLayout';
import { TextField } from '../components/forms';
import { Button, ButtonLink, Card } from '../components/ui';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function ForgotPasswordPage() {
  useDocumentTitle('Reset Password');
  const auth = useAuthService();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) {
      return;
    }
    if (!/^[^\s@]+@[^\s@]+$/.test(email.trim())) {
      setError('Enter the email address you sign in with.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await auth.requestPasswordReset(email);
    setBusy(false);
    if (result.ok) {
      setSent(true);
    } else {
      setError(result.message);
    }
  }

  return (
    <AuthLayout>
      <Card title="Reset your password">
        {sent ? (
          <div className="stack">
            <p className="callout" role="status">
              If an account exists for that email, a reset link is on its way. Open it in this browser on this device;
              it works once and expires after a short time.
            </p>
            <ButtonLink to="/login" variant="secondary">
              Back to Sign In
            </ButtonLink>
          </div>
        ) : (
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
            <Button type="submit" block disabled={busy}>
              {busy ? 'Sending…' : 'Send Reset Link'}
            </Button>
            <ButtonLink to="/login" variant="plain">
              Back to Sign In
            </ButtonLink>
          </form>
        )}
      </Card>
    </AuthLayout>
  );
}
