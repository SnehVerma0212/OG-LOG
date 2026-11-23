import type { PhotoType } from './photoFiles';

// Removes metadata from photos before they leave the browser: EXIF (GPS
// position, capture time, camera and phone details), XMP, IPTC, comments,
// embedded thumbnails and data appended after the image. Works on the file's
// bytes, so the picture itself is not re-encoded and loses no quality.
//
// Kept: what is needed to show the image correctly (JPEG structure, colour
// profile, Adobe colour marker, PNG/WebP image chunks) and, for JPEG, only the
// orientation value, rewritten into a minimal EXIF block so phone photos are
// not shown sideways.
//
// Throws MetadataError if the file is not a well-formed image of its type;
// such a file is refused rather than uploaded with its metadata.

export class MetadataError extends Error {
  constructor() {
    super('This photo could not be prepared safely (its file structure is not recognised), so it was not uploaded.');
    this.name = 'MetadataError';
  }
}

export async function stripImageMetadata(file: Blob, type: PhotoType): Promise<Blob> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const cleaned = type === 'image/jpeg' ? stripJpeg(bytes) : type === 'image/png' ? stripPng(bytes) : stripWebp(bytes);
  return new Blob([cleaned as BlobPart], { type });
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP14 = 0xee;
const COM = 0xfe;

export function stripJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== SOI) {
    throw new MetadataError();
  }
  const out: Uint8Array[] = [bytes.subarray(0, 2)];
  let orientation = 1;
  let wroteOrientation = false;
  let position = 2;

  const insertOrientation = () => {
    if (!wroteOrientation && orientation !== 1) {
      out.push(orientationSegment(orientation));
    }
    wroteOrientation = true;
  };

  while (position < bytes.length) {
    if (bytes[position] !== 0xff) {
      throw new MetadataError();
    }
    // Fill bytes may precede a marker.
    while (bytes[position + 1] === 0xff) {
      position += 1;
    }
    const marker = bytes[position + 1];
    if (marker === undefined) {
      throw new MetadataError();
    }
    if (marker === EOI) {
      insertOrientation();
      out.push(bytes.subarray(position, position + 2));
      return concat(out); // Anything after the image (e.g. extra images with their own EXIF) is dropped.
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      out.push(bytes.subarray(position, position + 2)); // Restart marker: no length.
      position += 2;
      continue;
    }
    const length = readUint16BE(bytes, position + 2);
    const end = position + 2 + length;
    if (length < 2 || end > bytes.length) {
      throw new MetadataError();
    }
    const segment = bytes.subarray(position, end);
    const payload = bytes.subarray(position + 4, end);

    if (marker === APP1) {
      if (startsWithAscii(payload, 'Exif\0\0')) {
        orientation = readExifOrientation(payload.subarray(6)) ?? orientation;
      }
      // EXIF and XMP are dropped; orientation is written back below.
    } else if (marker === APP0 || marker === APP14 || (marker === APP2 && startsWithAscii(payload, 'ICC_PROFILE\0'))) {
      out.push(segment); // JFIF header, Adobe colour marker, colour profile.
    } else if ((marker >= 0xe0 && marker <= 0xef) || marker === COM) {
      // Other application segments (MPF thumbnails, IPTC, maker data) and comments: dropped.
    } else {
      // Metadata segments come before the image structure, so the orientation
      // is known by now.
      insertOrientation();
      out.push(segment); // Image structure: tables, frame and scan headers.
    }
    position = end;

    if (marker === SOS) {
      // Entropy-coded image data runs until the next marker that is not a
      // stuffed byte (FF 00) or restart marker (FF D0-D7).
      const start = position;
      while (position < bytes.length) {
        if (bytes[position] === 0xff) {
          const next = bytes[position + 1];
          if (next !== 0x00 && !(next !== undefined && next >= 0xd0 && next <= 0xd7) && next !== 0xff) {
            break;
          }
          position += next === 0xff ? 1 : 2;
        } else {
          position += 1;
        }
      }
      out.push(bytes.subarray(start, position));
    }
  }
  throw new MetadataError(); // No end-of-image marker.
}

function readExifOrientation(tiff: Uint8Array): number | null {
  if (tiff.length < 8) {
    return null;
  }
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!little && !big) {
    return null;
  }
  const u16 = (offset: number) => (little ? tiff[offset]! | (tiff[offset + 1]! << 8) : (tiff[offset]! << 8) | tiff[offset + 1]!);
  const u32 = (offset: number) =>
    little
      ? (tiff[offset]! | (tiff[offset + 1]! << 8) | (tiff[offset + 2]! << 16) | (tiff[offset + 3]! << 24)) >>> 0
      : ((tiff[offset]! << 24) | (tiff[offset + 1]! << 16) | (tiff[offset + 2]! << 8) | tiff[offset + 3]!) >>> 0;
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) {
    return null;
  }
  const count = u16(ifd);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > tiff.length) {
      return null;
    }
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

// APP1 "Exif" block holding only IFD0 with the Orientation tag (big-endian TIFF).
export function orientationSegment(orientation: number): Uint8Array {
  const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  const payload = [...asciiBytes('Exif\0\0'), ...tiff];
  const length = payload.length + 2;
  return new Uint8Array([0xff, APP1, length >> 8, length & 0xff, ...payload]);
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// Text, EXIF and timestamp chunks can carry personal or device information.
const PNG_DROPPED = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', 'dSIG']);

export function stripPng(bytes: Uint8Array): Uint8Array {
  if (!PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    throw new MetadataError();
  }
  const out: Uint8Array[] = [bytes.subarray(0, 8)];
  let position = 8;
  while (position + 12 <= bytes.length) {
    const length = readUint32BE(bytes, position);
    const type = String.fromCharCode(...bytes.subarray(position + 4, position + 8));
    const end = position + 12 + length;
    if (end > bytes.length || !/^[A-Za-z]{4}$/.test(type)) {
      throw new MetadataError();
    }
    if (!PNG_DROPPED.has(type)) {
      out.push(bytes.subarray(position, end));
    }
    position = end;
    if (type === 'IEND') {
      return concat(out); // Data after the image end is dropped.
    }
  }
  throw new MetadataError();
}

// ---------------------------------------------------------------------------
// WebP
// ---------------------------------------------------------------------------

const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

export function stripWebp(bytes: Uint8Array): Uint8Array {
  if (!startsWithAscii(bytes, 'RIFF') || !startsWithAscii(bytes.subarray(8), 'WEBP')) {
    throw new MetadataError();
  }
  const riffEnd = Math.min(bytes.length, 8 + readUint32LE(bytes, 4));
  const chunks: Uint8Array[] = [];
  let position = 12;
  while (position + 8 <= riffEnd) {
    const fourcc = String.fromCharCode(...bytes.subarray(position, position + 4));
    const size = readUint32LE(bytes, position + 4);
    const end = position + 8 + size + (size % 2);
    if (position + 8 + size > riffEnd) {
      throw new MetadataError();
    }
    if (fourcc === 'EXIF' || fourcc === 'XMP ') {
      // Dropped.
    } else if (fourcc === 'VP8X') {
      const chunk = bytes.slice(position, Math.min(end, riffEnd));
      chunk[8] = chunk[8]! & ~(VP8X_EXIF | VP8X_XMP);
      chunks.push(chunk);
    } else {
      chunks.push(bytes.subarray(position, Math.min(end, riffEnd)));
    }
    position = end;
  }
  if (chunks.length === 0) {
    throw new MetadataError();
  }
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set(asciiBytes('RIFF'), 0);
  new DataView(header.buffer).setUint32(4, body.length + 4, true);
  header.set(asciiBytes('WEBP'), 8);
  return concat([header, body]);
}

// ---------------------------------------------------------------------------

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function asciiBytes(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0));
}

function startsWithAscii(bytes: Uint8Array, text: string): boolean {
  return asciiBytes(text).every((value, index) => bytes[index] === value);
}

const readUint16BE = (bytes: Uint8Array, offset: number) => (bytes[offset]! << 8) | bytes[offset + 1]!;
const readUint32BE = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
const readUint32LE = (bytes: Uint8Array, offset: number) =>
  (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
