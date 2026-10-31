// SVG ports of the mobile app's LogoMark and TabIcon (same geometry).

const NAVY = 'var(--color-text)';
const TEAL = 'var(--color-accent-on-navy)';

export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="16" fill={NAVY} />
      <line x1="20" y1="19" x2="20" y2="40" stroke={TEAL} strokeWidth="3" strokeLinecap="round" />
      <circle cx="20" cy="19" r="5" fill={TEAL} />
      <circle cx="20" cy="32" r="5" fill={TEAL} />
      <circle cx="20" cy="45" r="5" fill={NAVY} stroke={TEAL} strokeWidth="3" />
      <line x1="31" y1="19" x2="47" y2="19" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <line x1="31" y1="32" x2="43" y2="32" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <line x1="31" y1="45" x2="45" y2="45" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

export type NavIconName = 'home' | 'cases' | 'statistics' | 'settings';

export function NavIcon({ name, size = 22 }: { name: NavIconName; size?: number }) {
  const stroke = {
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    fill: 'none',
  } as const;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {name === 'home' && <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" {...stroke} />}
      {name === 'cases' && (
        <>
          <rect x="5" y="4.5" width="14" height="16" rx="2" {...stroke} />
          <rect x="9" y="2.5" width="6" height="3.5" rx="1" {...stroke} />
          <line x1="9" y1="11" x2="15" y2="11" {...stroke} />
          <line x1="9" y1="15" x2="13" y2="15" {...stroke} />
        </>
      )}
      {name === 'statistics' && (
        <>
          <line x1="6" y1="20" x2="6" y2="13" {...stroke} strokeWidth={2.5} />
          <line x1="12" y1="20" x2="12" y2="5" {...stroke} strokeWidth={2.5} />
          <line x1="18" y1="20" x2="18" y2="10" {...stroke} strokeWidth={2.5} />
        </>
      )}
      {name === 'settings' && (
        <>
          <line x1="4" y1="7" x2="20" y2="7" {...stroke} />
          <line x1="4" y1="12" x2="20" y2="12" {...stroke} />
          <line x1="4" y1="17" x2="20" y2="17" {...stroke} />
          <circle cx="9" cy="7" r="2.25" {...stroke} fill="var(--color-surface)" />
          <circle cx="15" cy="12" r="2.25" {...stroke} fill="var(--color-surface)" />
          <circle cx="8" cy="17" r="2.25" {...stroke} fill="var(--color-surface)" />
        </>
      )}
    </svg>
  );
}
