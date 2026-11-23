import { unzipSync, zip as browserZip } from 'fflate/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { zip } from './fflateWithoutWorkers';

// The browser build of fflate compresses files over 160 kB in a Worker made
// from a blob: URL; the site's Content Security Policy blocks that.
const large = new TextEncoder().encode('<row>synthetic</row>'.repeat(20_000)); // 400 kB
const blockWorkers = () =>
  vi.stubGlobal('Worker', function Blocked() {
    throw new Error('blocked by the Content Security Policy');
  });
const run = (fn: typeof zip) =>
  new Promise<Uint8Array>((resolve, reject) => {
    try {
      fn({ 'sheet.xml': large }, (error, data) => (error ? reject(error) : resolve(data)));
    } catch (error) {
      reject(error);
    }
  });

afterEach(() => vi.unstubAllGlobals());

describe('fflate without Web Workers', () => {
  it('the browser build fails on large files when Workers are blocked', async () => {
    blockWorkers();
    await expect(run(browserZip)).rejects.toThrow(/Content Security Policy/);
  });

  it('this replacement zips them on the page, losslessly', async () => {
    blockWorkers();
    const archive = await run(zip);
    const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes); // (Typed arrays from two realms do not deep-equal.)
    expect(decode(unzipSync(archive)['sheet.xml']!)).toBe(decode(large));
  });

  it('is what the Excel export gets when it imports fflate', async () => {
    const viaAlias = await import('fflate');
    expect(viaAlias.zip).toBe(zip);
  });
});
