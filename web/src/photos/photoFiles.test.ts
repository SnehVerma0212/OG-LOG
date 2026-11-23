import { describe, expect, it } from 'vitest';

import { JPEG_HEADER as JPEG, PNG_HEADER as PNG, syntheticImage, syntheticImageOfSize, WEBP_HEADER as WEBP } from '../test/syntheticImages';
import { checkPhotoFile, PHOTO_MAX_BYTES, sniffType } from './photoFiles';

describe('photo file checks', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'] as const)('accepts a %s image', async (type) => {
    expect(await checkPhotoFile(syntheticImage(type))).toEqual({ ok: true, type });
  });

  it('refuses other types, including HEIC and documents', async () => {
    for (const type of ['image/heic', 'image/gif', 'application/pdf', 'text/plain', '']) {
      expect(await checkPhotoFile(new File(['x'], 'file', { type }))).toEqual({ ok: false, message: 'Only JPEG, PNG and WebP photos can be added.' });
    }
  });

  it('refuses a file whose contents do not match its declared type', async () => {
    const renamed = new File(['%PDF-1.7 synthetic'], 'document.jpg', { type: 'image/jpeg' });
    expect(await checkPhotoFile(renamed)).toEqual({ ok: false, message: 'This file is not a valid JPEG, PNG or WebP image.' });
    const pngCalledJpeg = new File([new Uint8Array([...PNG, 0, 0])], 'x.jpg', { type: 'image/jpeg' });
    expect((await checkPhotoFile(pngCalledJpeg)).ok).toBe(false);
  });

  it('refuses empty files and files over the size limit', async () => {
    expect(await checkPhotoFile(new File([], 'empty', { type: 'image/png' }))).toEqual({ ok: false, message: 'This file is empty.' });
    const atLimit = syntheticImageOfSize('image/png', PHOTO_MAX_BYTES);
    expect(atLimit.size).toBe(PHOTO_MAX_BYTES);
    expect((await checkPhotoFile(atLimit)).ok).toBe(true);
    expect(await checkPhotoFile(syntheticImageOfSize('image/png', PHOTO_MAX_BYTES + 1))).toEqual({
      ok: false,
      message: 'Photos must be 10 MB or smaller.',
    });
  });

  it('recognises formats by their signature', () => {
    expect(sniffType(new Uint8Array(JPEG))).toBe('image/jpeg');
    expect(sniffType(new Uint8Array(PNG))).toBe('image/png');
    expect(sniffType(new Uint8Array(WEBP))).toBe('image/webp');
    expect(sniffType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]))).toBeNull(); // AVI
  });
});
