// The database key is 32 random bytes, kept as 64 lowercase hex characters
// and passed to SQLCipher as a raw key (no passphrase derivation).

export const DATABASE_KEY_BYTES = 32;

const KEY_PATTERN = /^[0-9a-f]{64}$/;

export function isValidDatabaseKey(value: unknown): value is string {
  return typeof value === 'string' && KEY_PATTERN.test(value);
}

// Throws (without revealing the value) unless `key` is a well-formed key. Every
// place that puts the key into SQL text calls this first, so only hex digits
// can ever reach the statement.
export function assertValidDatabaseKey(key: string): void {
  if (!isValidDatabaseKey(key)) {
    throw new Error('Refusing to use a malformed database key.');
  }
}

// SQLCipher's raw-key syntax is the string x'<64 hex>', written here as a
// standard single-quoted SQL string literal (inner quotes doubled). Keys cannot
// be bound as parameters in PRAGMA statements; validation guarantees only hex
// digits reach the SQL text.
export function sqlcipherRawKeyLiteral(key: string): string {
  assertValidDatabaseKey(key);
  return `'x''${key}'''`;
}

// `randomBytes` must be a cryptographically secure generator.
export async function generateDatabaseKey(randomBytes: (count: number) => Promise<Uint8Array>): Promise<string> {
  const bytes = await randomBytes(DATABASE_KEY_BYTES);
  if (!(bytes instanceof Uint8Array) || bytes.length !== DATABASE_KEY_BYTES) {
    throw new Error('The random number generator returned an unexpected result.');
  }
  // A generator returning one repeated byte is broken; never use its output.
  if (bytes.every((byte) => byte === bytes[0])) {
    throw new Error('The random number generator returned an unusable result.');
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Where the key is persisted. Implemented with expo-secure-store on devices.
export interface KeyStore {
  read(): Promise<string | null>;
  write(key: string): Promise<void>;
}
