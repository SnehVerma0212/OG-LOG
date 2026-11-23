import { useState, type FormEvent } from 'react';

import { FormError } from '../auth/AuthLayout';
import { useAuthService } from '../auth/AuthContext';
import type { MfaEnrollment } from '../auth/authService';
import { TextField } from '../components/forms';
import { Button, Card, Loading } from '../components/ui';
import { useNotify } from '../lib/notifications';

// Settings: turn two-step verification (authenticator app) on or off.
export function TwoStepCard({ enrolled, onChange }: { enrolled: boolean | null; onChange: () => void }) {
  const auth = useAuthService();
  const notify = useNotify();
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    const result = await auth.startMfaEnrollment();
    setBusy(false);
    if (result.ok) {
      setEnrollment(result);
    } else {
      setError(result.message);
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!enrollment || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const result = await auth.confirmMfaEnrollment(enrollment.factorId, code.replace(/\s/g, ''));
    setBusy(false);
    if (result.ok) {
      setEnrollment(null);
      setCode('');
      notify('Two-step verification is on.');
      onChange();
    } else {
      setError(result.message);
    }
  }

  async function turnOff() {
    if (!window.confirm('Turn off two-step verification? Your logbook will then be protected by your password only.')) {
      return;
    }
    setBusy(true);
    const result = await auth.disableMfa();
    setBusy(false);
    if (result.ok) {
      notify('Two-step verification is off.');
      onChange();
    } else {
      setError(result.message);
    }
  }

  return (
    <Card title="Two-Step Verification">
      <FormError message={error} />
      {enrolled === null ? <Loading /> : null}
      {enrolled === true ? (
        <div className="settings-row">
          <div className="settings-row__text">
            <span>On</span>
            <span className="caption">Signing in needs your password and a code from your authenticator app.</span>
          </div>
          <Button variant="secondary" onClick={() => void turnOff()} disabled={busy}>
            Turn Off
          </Button>
        </div>
      ) : null}
      {enrolled === false && !enrollment ? (
        <div className="settings-row">
          <div className="settings-row__text">
            <span>Off</span>
            <span className="caption">Strongly recommended: protects your logbook even if your password is stolen.</span>
          </div>
          <Button onClick={() => void start()} disabled={busy}>
            Set Up
          </Button>
        </div>
      ) : null}
      {enrollment ? (
        <form className="stack" onSubmit={(event) => void confirm(event)} noValidate aria-busy={busy}>
          <p className="callout">
            Scan this code with an authenticator app (for example Google Authenticator, Microsoft Authenticator or
            2FAS), then enter the 6-digit code it shows.
          </p>
          <img src={enrollment.qrCode} alt="QR code for your authenticator app" width={200} height={200} />
          <p className="caption">
            Or enter this key manually: <code>{enrollment.secret}</code>
          </p>
          <TextField
            label="Code from the app"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={busy}
          />
          <div className="row">
            <Button type="submit" disabled={busy}>
              Turn On
            </Button>
            <Button variant="secondary" onClick={() => setEnrollment(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
