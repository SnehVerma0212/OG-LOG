import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';

import { useAuthService, useAuthState } from '../auth/AuthContext';
import { useRepository } from '../data/RepositoryContext';
import { LogoMark, NavIcon, type NavIconName } from './Icons';
import { Button, ButtonLink } from './ui';

const NAV: { to: string; label: string; icon: NavIconName; end?: boolean }[] = [
  { to: '/', label: 'Dashboard', icon: 'home', end: true },
  { to: '/cases', label: 'My Cases', icon: 'cases' },
  { to: '/statistics', label: 'Statistics', icon: 'statistics' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

function Brand() {
  return (
    <Link to="/" className="brand" aria-label="OG-LOG dashboard">
      <LogoMark size={36} />
      <span>
        <span className="brand__name">OG-LOG</span>
        <br />
        <span className="brand__tagline">Personal Surgical Logbook</span>
      </span>
    </Link>
  );
}

export function AppShell() {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  const repository = useRepository();
  const auth = useAuthService();
  const authState = useAuthState();
  const email = authState.status === 'signedIn' ? authState.user.email : null;

  // After navigating, move focus to the new page so keyboard and screen
  // reader users start at its content.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [pathname]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="shell__topbar">
        <Brand />
        <ButtonLink to="/cases/new" variant="primary">
          New Case
        </ButtonLink>
      </header>

      <aside className="shell__sidebar">
        <Brand />
        <ButtonLink to="/cases/new" variant="primary" block>
          New Case
        </ButtonLink>
        <nav className="sidenav" aria-label="Main">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="sidenav__link">
              <NavIcon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__footer">
          <p className="caption">{repository.storageDescription}</p>
          {email ? <p className="caption">Signed in as {email}</p> : null}
          <Button variant="secondary" block onClick={() => void auth.signOut()}>
            Sign Out
          </Button>
        </div>
      </aside>

      <main id="main" className="shell__main" ref={mainRef} tabIndex={-1}>
        <div className="shell__content">
          <Outlet />
        </div>
      </main>

      <nav className="tabbar" aria-label="Main">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="tabbar__link">
            <NavIcon name={item.icon} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
