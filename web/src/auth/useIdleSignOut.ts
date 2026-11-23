import { useEffect } from 'react';

import { useAuthService } from './AuthContext';

export const IDLE_MINUTES = 30;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
const CHECK_EVERY_MS = 15_000;

// Signs the user out after IDLE_MINUTES without keyboard, pointer or touch
// activity in this tab. Time is measured from timestamps, so it also applies
// after the computer has been asleep.
export function useIdleSignOut(active: boolean, now: () => number = Date.now) {
  const auth = useAuthService();

  useEffect(() => {
    if (!active) {
      return;
    }
    let lastActivity = now();
    let signedOut = false;
    const markActive = () => {
      lastActivity = now();
    };
    const check = () => {
      if (!signedOut && now() - lastActivity >= IDLE_MINUTES * 60_000) {
        signedOut = true;
        void auth.signOut('idle');
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && check();
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, markActive, { passive: true }));
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, markActive));
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [active, auth, now]);
}
