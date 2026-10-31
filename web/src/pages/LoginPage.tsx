import { LogoMark } from '../components/Icons';
import { Button, ButtonLink, Card, Notice } from '../components/ui';
import { useDocumentTitle } from '../lib/useDocumentTitle';

// Visual placeholder only. There is no authentication in this phase, and
// nothing here pretends otherwise: every control is disabled.
export function LoginPage() {
  useDocumentTitle('Sign In');
  return (
    <main className="shell__main" style={{ paddingBottom: 'var(--space-xxxl)' }}>
      <div className="shell__content form-width">
        <div className="row">
          <LogoMark size={48} />
          <div>
            <h1 className="brand__name">OG-LOG</h1>
            <p className="brand__tagline">Personal Surgical Logbook</p>
          </div>
        </div>

        <Notice title="Sign-in is not available yet">
          Accounts, passkeys and secure server storage will be added in a later phase. This page only shows the
          planned layout; the controls do not work.
        </Notice>

        <Card title="Sign in">
          <div className="field">
            <label className="field__label" htmlFor="login-email">
              Email
            </label>
            <input id="login-email" className="field__input" type="email" autoComplete="off" disabled />
          </div>
          <Button block disabled>
            Sign in with a passkey
          </Button>
          <Button variant="secondary" block disabled>
            Email me a sign-in code
          </Button>
          <p className="caption">
            With a passkey, Face ID or Touch ID is checked on your own device. OG-LOG will never receive or store
            biometric data.
          </p>
        </Card>

        <ButtonLink to="/" variant="plain">
          Continue to the demo with sample data
        </ButtonLink>
      </div>
    </main>
  );
}
