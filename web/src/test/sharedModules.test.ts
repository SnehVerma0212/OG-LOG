import { describe, expect, it } from 'vitest';

// The web app shares these mobile modules. Any package import in them (React,
// React Native, Expo...) would pull mobile code or a second React into the web
// bundle, so they may only import each other by relative path.
const shared = import.meta.glob(['../../../src/domain/*.ts', '../../../src/utils/singleFlight.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('modules shared with the mobile app', () => {
  it('are found', () => {
    expect(Object.keys(shared).length).toBeGreaterThanOrEqual(4);
  });

  it.each(Object.entries(shared))('%s imports nothing but relative files', (_path, source) => {
    const specifiers = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1] ?? match[2] ?? match[3],
    );
    expect(specifiers.filter((specifier) => !specifier!.startsWith('./'))).toEqual([]);
  });
});
