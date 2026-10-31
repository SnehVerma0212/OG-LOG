import { ButtonLink, Card, EmptyState } from '../components/ui';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function NotFoundPage() {
  useDocumentTitle('Page Not Found');
  return (
    <Card>
      <EmptyState
        title="Page not found"
        message="This page does not exist."
        action={<ButtonLink to="/" variant="secondary">Go to Dashboard</ButtonLink>}
      />
    </Card>
  );
}
