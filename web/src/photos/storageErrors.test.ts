import { describe, expect, it } from 'vitest';

import { storageUploadFailure } from './storageErrors';

const body = (value: object) => JSON.stringify(value);

describe('Storage upload error messages', () => {
  it('explains a missing bucket (Storage answers HTTP 400 with statusCode 404)', () => {
    const result = storageUploadFailure(400, body({ statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' }));
    expect(result).toEqual({
      message: 'Photo storage is not set up on the server yet, so the photo was not saved. Ask the administrator to finish the storage setup.',
      sessionExpired: false,
    });
  });

  it('explains a policy refusal', () => {
    const result = storageUploadFailure(400, body({ statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }));
    expect(result.message).toBe('You do not have permission to add this photo. It may belong to a case you cannot change.');
  });

  it('explains size and type limits', () => {
    expect(storageUploadFailure(413, body({ statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' })).message).toBe(
      'This photo is larger than the server allows (10 MB).',
    );
    expect(storageUploadFailure(400, body({ statusCode: '415', error: 'invalid_mime_type', message: 'mime type text/plain is not supported' })).message).toBe(
      'The server does not accept this type of file. Use JPEG, PNG or WebP.',
    );
  });

  it('flags an expired session', () => {
    expect(storageUploadFailure(400, body({ statusCode: '403', error: 'InvalidJWT', message: '"exp" claim timestamp check failed' }))).toEqual({
      message: 'Your session has ended. Please sign in again.',
      sessionExpired: true,
    });
    expect(storageUploadFailure(401).sessionExpired).toBe(true);
  });

  it('explains duplicates, rate limits and server errors', () => {
    expect(storageUploadFailure(409, body({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' })).message).toMatch(/already exists/);
    expect(storageUploadFailure(429).message).toMatch(/Too many uploads/);
    expect(storageUploadFailure(503, '<html>gateway</html>').message).toBe('The storage server had a problem (error 503). Try again later.');
  });

  it('never repeats the response body, which may contain paths or other details', () => {
    const secretish = body({
      statusCode: '400',
      error: 'Something odd',
      message: 'object 11111111-1111-4111-8111-111111111111/case/photo token=abc.def.ghi https://x.supabase.co/storage',
    });
    const result = storageUploadFailure(400, secretish);
    expect(result.message).toBe('The server refused this upload (error 400).');
    expect(storageUploadFailure(400, 'not json').message).toBe('The server refused this upload (error 400).');
  });
});
