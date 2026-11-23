import { describe, expect, it } from 'vitest';

import { crc32 } from './crc32';
import { createZip, readZip } from './zip';

describe('ZIP export format', () => {
  it('round-trips files with UTF-8 names and correct checksums', async () => {
    const entries = [
      { name: 'cases.json', data: new TextEncoder().encode('{"a":1}') },
      { name: 'photos/ü/x.jpg', data: new Uint8Array([1, 2, 3, 255]) },
    ];
    const bytes = new Uint8Array(await createZip(entries, new Date(2026, 10, 2, 10, 30, 0)).arrayBuffer());
    const plain = (list: { name: string; data: Uint8Array }[]) => list.map((entry) => ({ name: entry.name, data: Array.from(entry.data) }));
    expect(plain(readZip(bytes))).toEqual(plain(entries));
    expect(new DataView(bytes.buffer).getUint32(bytes.length - 22, true)).toBe(0x06054b50); // End of central directory.
  });

  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
