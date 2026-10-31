import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

// Brief confirmations ("Draft saved.") that survive a route change.

const NOTICE_DURATION_MS = 4000;

const NotifyContext = createContext<(message: string) => void>(() => undefined);

export function useNotify(): (message: string) => void {
  return useContext(NotifyContext);
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(null);

  const notify = useCallback((message: string) => {
    setNotice((current) => ({ id: (current?.id ?? 0) + 1, message }));
  }, []);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <NotifyContext.Provider value={notify}>
      {children}
      {/* Always mounted so screen readers announce new messages. */}
      <div role="status" aria-live="polite" className={notice ? 'toast' : 'visually-hidden'}>
        {notice?.message ?? ''}
      </div>
    </NotifyContext.Provider>
  );
}
