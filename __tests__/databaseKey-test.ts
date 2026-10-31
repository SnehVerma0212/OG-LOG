import {
  assertValidDatabaseKey,
  generateDatabaseKey,
  isValidDatabaseKey,
  sqlcipherRawKeyLiteral,
} from '../src/security/databaseKey';
import { nodeBuiltin, openRawTestDatabase } from '../test-utils/nodeDatabase';

const { randomBytes } = nodeBuiltin<{ randomBytes(size: number): Uint8Array }>('node:crypto');
const secureRandom = async (count: number) => new Uint8Array(randomBytes(count));

describe('generateDatabaseKey', () => {
  it('produces a 256-bit key as 64 lowercase hex characters', async () => {
    const key = await generateDatabaseKey(secureRandom);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(isValidDatabaseKey(key)).toBe(true);
  });

  it('produces a different key each time', async () => {
    const keys = new Set(await Promise.all(Array.from({ length: 20 }, () => generateDatabaseKey(secureRandom))));
    expect(keys.size).toBe(20);
  });

  it('asks the generator for exactly 32 bytes', async () => {
    const generator = jest.fn(secureRandom);
    await generateDatabaseKey(generator);
    expect(generator).toHaveBeenCalledWith(32);
  });

  it('rejects broken generator output', async () => {
    await expect(generateDatabaseKey(async () => new Uint8Array(16).fill(7))).rejects.toThrow();
    await expect(generateDatabaseKey(async () => new Uint8Array(32))).rejects.toThrow();
    await expect(generateDatabaseKey(async () => new Uint8Array(32).fill(255))).rejects.toThrow();
  });
});

describe('key validation and SQL formatting', () => {
  const key = 'ab'.repeat(32);

  it('accepts only 64 lowercase hex characters', () => {
    expect(isValidDatabaseKey(key)).toBe(true);
    for (const bad of ['', 'ab'.repeat(31), 'AB'.repeat(32), `${'ab'.repeat(31)}zz`, `${key}00`, null, 42]) {
      expect(isValidDatabaseKey(bad)).toBe(false);
    }
  });

  it('refuses anything else without echoing it', () => {
    const attempt = "' ; DROP TABLE cases; --";
    expect(() => assertValidDatabaseKey(attempt)).toThrow('Refusing to use a malformed database key.');
    expect(() => sqlcipherRawKeyLiteral(attempt)).toThrow();
    try {
      sqlcipherRawKeyLiteral(attempt);
    } catch (error) {
      expect(String(error)).not.toContain('DROP');
    }
  });

  it("is a SQL string literal whose value is SQLCipher's x'<hex>' raw-key form", async () => {
    const literal = sqlcipherRawKeyLiteral(key);
    const db = openRawTestDatabase();
    const row = await db.getFirstAsync<{ value: string }>(`SELECT ${literal} AS value`, []);
    expect(row?.value).toBe(`x'${key}'`);
    db.close();
  });
});
