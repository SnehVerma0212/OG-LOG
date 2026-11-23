import { useState, type FormEvent } from 'react';

import { TextField } from '../components/forms';
import { Button } from '../components/ui';
import { FormError } from './AuthLayout';
import { useAuthState } from './AuthContext';
import { MIN_PASSWORD_LENGTH, passwordProblem, type AuthResult } from './authService';

interface Props {
  submitLabel: string;
  // Settings asks for the current password; first login and reset links do not.
  askCurrent?: boolean;
  // Also asks for an authenticator code (two-step verification is on).
  askCode?: boolean;
  onSubmit: (newPassword: string, currentPassword: string, code: string) => Promise<AuthResult>;
  onSuccess: () => void;
}

// New password + confirmation, used by the first-login, reset-link and
// Settings screens. Passwords never leave this form except to the auth
// service, and are never shown in messages.
export function NewPasswordForm({ submitLabel, askCurrent = false, askCode = false, onSubmit, onSuccess }: Props) {
  const state = useAuthState();
  const email = 'user' in state ? state.user.email : null;
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) {
      return;
    }
    if (askCurrent && !current) {
      setError('Enter your current password.');
      return;
    }
    const problem = passwordProblem(password, email);
    if (problem) {
      setError(problem);
      return;
    }
    if (password !== confirmation) {
      setError('The two passwords do not match.');
      return;
    }
    if (askCurrent && password === current) {
      setError('Choose a password different from your current one.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await onSubmit(password, current, code.replace(/\s/g, ''));
    setBusy(false);
    if (result.ok) {
      setCurrent('');
      setPassword('');
      setConfirmation('');
      setCode('');
      onSuccess();
    } else {
      setError(result.message);
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void submit(event)} noValidate aria-busy={busy}>
      <FormError message={error} />
      {askCurrent ? (
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          disabled={busy}
        />
      ) : null}
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. A passphrase of several unrelated words works well.`}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        disabled={busy}
      />
      <TextField
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        disabled={busy}
      />
      {askCode ? (
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
      <Button type="submit" block disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}
