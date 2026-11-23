import type { ReactNode } from 'react';

import { LogoMark } from '../components/Icons';

// Shared frame for the public sign-in, forgot-password and reset screens.
export function AuthLayout({ children }: { children: ReactNode }) {
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
        {children}
      </div>
    </main>
  );
}

export function FormError({ message }: { message: string | null }) {
  return message ? (
    <div className="error-summary" role="alert">
      <strong>{message}</strong>
    </div>
  ) : null;
}
