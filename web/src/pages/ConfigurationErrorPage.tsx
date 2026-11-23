import { Card, Notice } from '../components/ui';

// Shown instead of the app when the Supabase connection is not configured.
// The reason names environment variables only, never their values.
export function ConfigurationErrorPage({ reason }: { reason: string }) {
  return (
    <main className="shell__main">
      <div className="shell__content form-width">
        <h1 className="brand__name">OG-LOG</h1>
        <Notice title="OG-LOG is not configured">{reason}</Notice>
        <Card title="For the administrator">
          <p className="callout">
            Copy web/.env.example to web/.env.local, add the project URL and the publishable key of the development
            project, then restart the server. See web/supabase/DEVELOPMENT.md. Never use a secret or service-role key.
          </p>
        </Card>
      </div>
    </main>
  );
}
