import { Badge, Card, Notice, PageHeader } from '../components/ui';
import { useRepository } from '../data/RepositoryContext';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const PLANNED = <Badge label="Not available yet" />;

function Row({ label, description }: { label: string; description: string }) {
  return (
    <div className="settings-row">
      <div className="settings-row__text">
        <span>{label}</span>
        <span className="caption">{description}</span>
      </div>
      {PLANNED}
    </div>
  );
}

export function SettingsPage() {
  useDocumentTitle('Settings');
  const repository = useRepository();

  return (
    <>
      <PageHeader title="Settings" />

      <Notice title="Accounts and security are not implemented yet">
        This is the website foundation. There is no sign-in, no server storage and no data protection yet. None of
        the features below are active.
      </Notice>

      <Card title="Profile">
        <Row label="Your profile" description="Name and email for your account." />
      </Card>

      <Card title="Sign-in and Passkeys">
        <Row label="Passkeys" description="Sign in with a passkey. Face ID or Touch ID stays on your device." />
        <Row label="Active sessions" description="See where you are signed in and sign out other devices." />
        <Row label="Account recovery" description="Regain access if you lose your passkey." />
      </Card>

      <Card title="Your Data">
        <Row label="Export" description="Download a copy of your logbook." />
        <Row label="Delete account" description="Permanently delete your account and records." />
      </Card>

      <Card title="About OG-LOG">
        <p className="callout">
          A personal surgical logbook for recording your own cases across preoperative, OT and postoperative stages.
        </p>
        <div className="settings-row">
          <div className="settings-row__text">
            <span>Data storage</span>
            <span className="caption">{repository.storageDescription}</span>
          </div>
          <Badge label="Demo" tone="neutral" />
        </div>
      </Card>
    </>
  );
}
