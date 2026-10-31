// Runs at most one task at a time. A call made while a task is still running
// is ignored and resolves to `undefined`. Unlike React state, the flag is
// updated synchronously, so two taps in the same frame cannot both start a save.
export function createSingleFlight() {
  let running = false;
  return {
    isRunning: () => running,
    async run<T>(task: () => Promise<T>): Promise<T | undefined> {
      if (running) {
        return undefined;
      }
      running = true;
      try {
        return await task();
      } finally {
        running = false;
      }
    },
  };
}
