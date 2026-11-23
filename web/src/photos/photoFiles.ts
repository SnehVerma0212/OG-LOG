import { MetadataError, stripImageMetadata } from './stripMetadata';

// Which photos can be uploaded. The private Storage bucket enforces the same
// type list and size limit on the server (migration 20261101120000); these
// checks only give a clear message before anything is sent.

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];

export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_ACCEPT = PHOTO_TYPES.join(',');

export type PhotoFileCheck = { ok: true; type: PhotoType } | { ok: false; message: string };

// Checks the declared type, the size, and that the file really starts like
// that image format (a renamed document is refused).
export async function checkPhotoFile(file: Blob): Promise<PhotoFileCheck> {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, message: 'Only JPEG, PNG and WebP photos can be added.' };
  }
  if (file.size === 0) {
    return { ok: false, message: 'This file is empty.' };
  }
  if (file.size > PHOTO_MAX_BYTES) {
    return { ok: false, message: `Photos must be ${PHOTO_MAX_BYTES / 1024 / 1024} MB or smaller.` };
  }
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (sniffType(header) !== file.type) {
    return { ok: false, message: 'This file is not a valid JPEG, PNG or WebP image.' };
  }
  return { ok: true, type: file.type as PhotoType };
}

export function sniffType(bytes: Uint8Array): PhotoType | null {
  const starts = (signature: number[], offset = 0) => signature.every((byte, index) => bytes[offset + index] === byte);
  if (starts([0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  return null;
}

// SHA-256 of the file, when the browser offers it (secure contexts only).
export async function sha256Hex(file: Blob): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return null;
  }
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// What is actually uploaded: a checked image with its metadata removed
// (location, time, device; see stripMetadata.ts).
export type PreparedPhoto = { ok: true; blob: Blob; type: PhotoType } | { ok: false; message: string };

export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  const check = await checkPhotoFile(file);
  if (!check.ok) {
    return check;
  }
  try {
    return { ok: true, blob: await stripImageMetadata(file, check.type), type: check.type };
  } catch (error) {
    if (error instanceof MetadataError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}
