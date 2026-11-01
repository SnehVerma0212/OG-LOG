// Helpers that keep each integration run's synthetic rows identifiable and make
// cleanup failures loud. No network access here, so they are unit-tested
// locally (supabase/tests/integrationCleanup.test.ts).

// Unique per run: time plus random suffix. Letters, digits and hyphens only, so
// it is safe inside a PostgREST LIKE pattern (no `%` or `_` wildcards).
export function createRunId(now: number = Date.now(), random: string = crypto.randomUUID()): string {
  return `ITEST-${now.toString(36).toUpperCase()}-${random.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export interface CleanupStep {
  name: string;
  run: () => Promise<void>;
}

// Runs every step even if earlier ones fail (so sign-out still happens), then
// throws one error listing all failures. Vitest reports it as an afterAll
// failure alongside, not instead of, any test failures.
export async function runCleanupSteps(steps: CleanupStep[]): Promise<void> {
  const failures: string[] = [];
  for (const step of steps) {
    try {
      await step.run();
    } catch (error) {
      failures.push(`${step.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Integration cleanup failed; synthetic rows may remain in the development project.\n- ${failures.join('\n- ')}`,
    );
  }
}

// supabase-js reports API failures in the result instead of throwing.
export function throwIfError(result: { error: { code?: string; message: string } | null }, what: string): void {
  if (result.error) {
    throw new Error(`${what} failed (${result.error.code ?? 'no code'}: ${result.error.message})`);
  }
}
