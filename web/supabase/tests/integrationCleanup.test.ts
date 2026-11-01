// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createRunId, runCleanupSteps, throwIfError } from '../integration/cleanup';

describe('integration test cleanup helpers', () => {
  it('creates run markers that are unique and safe in LIKE patterns', () => {
    const id = createRunId(1_793_476_769_028, '0a1b2c3d-4e5f-4789-abcd-ef0123456789');
    expect(id).toBe(`ITEST-${(1_793_476_769_028).toString(36).toUpperCase()}-0A1B2C3D`);
    expect(id).toMatch(/^ITEST-[0-9A-Z]+-[0-9A-F]{8}$/);
    expect(createRunId()).not.toBe(createRunId());
  });

  it('runs every step and reports all failures together', async () => {
    const ran: string[] = [];
    const promise = runCleanupSteps([
      { name: 'delete', run: async () => { ran.push('delete'); throw new Error('boom'); } },
      { name: 'restore', run: async () => { ran.push('restore'); } },
      { name: 'sign out', run: async () => { ran.push('sign out'); throw new Error('offline'); } },
    ]);
    await expect(promise).rejects.toThrow(/synthetic rows may remain[\s\S]*delete: boom[\s\S]*sign out: offline/);
    expect(ran).toEqual(['delete', 'restore', 'sign out']);
  });

  it('resolves when every step succeeds', async () => {
    await expect(runCleanupSteps([{ name: 'ok', run: async () => undefined }])).resolves.toBeUndefined();
  });

  it('turns a supabase-js error result into a thrown error', () => {
    expect(() => throwIfError({ error: null }, 'delete')).not.toThrow();
    expect(() => throwIfError({ error: { code: '42501', message: 'denied' } }, 'delete')).toThrow('delete failed (42501: denied)');
  });
});
