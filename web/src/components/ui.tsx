import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';

type Variant = 'primary' | 'secondary' | 'plain' | 'danger';

function buttonClass(variant: Variant, block?: boolean) {
  return `button button--${variant}${block ? ' button--block' : ''}`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
}

export function Button({ variant = 'primary', block, type = 'button', className, ...props }: ButtonProps) {
  return <button type={type} className={`${buttonClass(variant, block)} ${className ?? ''}`.trim()} {...props} />;
}

export function ButtonLink({ variant = 'primary', block, ...props }: LinkProps & { variant?: Variant; block?: boolean }) {
  return <Link className={buttonClass(variant, block)} {...props} />;
}

export function Card({ title, trailing, children, labelledBy }: {
  title?: string;
  trailing?: ReactNode;
  children: ReactNode;
  labelledBy?: string;
}) {
  const headingId = labelledBy ?? (title ? `card-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : undefined);
  return (
    <section className="card" aria-labelledby={title ? headingId : undefined}>
      {title ? (
        <div className="card__header">
          <h2 className="card__title" id={headingId}>
            {title}
          </h2>
          {trailing}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Badge({ label, tone = 'notice' }: { label: string; tone?: 'notice' | 'accent' | 'neutral' }) {
  return <span className={`badge badge--${tone}`}>{label}</span>;
}

export function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="notice" role="note">
      <p className="notice__title">{title}</p>
      <p className="notice__message">{children}</p>
    </div>
  );
}

export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      <p className="empty__message">{message}</p>
      {action}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="loading" role="status">
      {label}
    </p>
  );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      title="Something went wrong"
      message="The data could not be loaded. Try again."
      action={<Button variant="secondary" onClick={onRetry}>Try Again</Button>}
    />
  );
}

// `null` while loading.
export function StatCard({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="stat">
      <span className="stat__value" aria-hidden="true">
        {value ?? '–'}
      </span>
      <span className="stat__label" aria-hidden="true">
        {label}
      </span>
      <span className="visually-hidden">{`${label}: ${value ?? 'loading'}`}</span>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </header>
  );
}

export function BarRow({ label, count, max }: { label: string; count: number; max: number }) {
  const share = max > 0 ? Math.min(1, count / max) : 0;
  return (
    <div className="bar">
      <div className="bar__header">
        <span className="bar__label">{label}</span>
        <span className="bar__count">{count}</span>
      </div>
      <div className="bar__track" aria-hidden="true">
        <div className="bar__fill" style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}
