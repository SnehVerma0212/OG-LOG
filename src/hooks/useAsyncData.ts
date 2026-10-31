import { useCallback, useEffect, useState, type DependencyList } from 'react';

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: Error };

// Loads data when the screen mounts and whenever `deps` change. Previous data
// stays on screen while a reload is in flight, and results from an outdated
// request are ignored.
export function useAsyncData<T>(load: () => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    load().then(
      (data) => {
        if (active) {
          setState({ status: 'ready', data });
        }
      },
      (error: unknown) => {
        if (active) {
          setState({ status: 'error', error: error instanceof Error ? error : new Error(String(error)) });
        }
      },
    );
    return () => {
      active = false;
    };
    // `load` is recreated every render; `deps` lists what it actually depends on.
  }, [...deps, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  return { state, retry };
}
