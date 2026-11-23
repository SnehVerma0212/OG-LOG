import { describe, expect, it } from 'vitest';

import { InMemoryPhotoStore } from './inMemoryPhotoStore';
import { preparePhoto } from './photoFiles';
import { MetadataError, orientationSegment, stripJpeg, stripPng, stripWebp } from './stripMetadata';
import { JFIF, jpegSegment, pngChunk, riff, syntheticImageBytes, webpChunk } from '../test/syntheticImages';

// Synthetic files carrying fake metadata. "GPS-SECRET" stands in for location,
// time and device data that must never leave the browser.
const ascii = (text: string) => Array.from(text, (character) => character.charCodeAt(0));
const SECRET = 'GPS-SECRET 51.5N 0.12W 2026:10:15 PhoneModel';
const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

// EXIF with Orientation = 6 (rotate 90°) plus a second IFD entry holding text.
function exifSegment(orientation: number, littleEndian = false) {
  const u16 = (value: number) => (littleEndian ? [value & 0xff, value >> 8] : [value >> 8, value & 0xff]);
  const u32 = (value: number) =>
    littleEndian ? [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, value >>> 24] : [value >>> 24, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  const secret = ascii(`${SECRET}\0`);
  const valueOffset = 8 + 2 + 2 * 12 + 4;
  const tiff = [
    ...(littleEndian ? [0x49, 0x49, 0x2a, 0x00] : [0x4d, 0x4d, 0x00, 0x2a]),
    ...u32(8),
    ...u16(2),
    ...u16(0x010f), ...u16(2), ...u32(secret.length), ...u32(valueOffset), // Make (ASCII, stored after the IFD)
    ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0,
    ...u32(0),
    ...secret,
  ];
  return jpegSegment(0xe1, [...ascii('Exif\0\0'), ...tiff]);
}

const xmp = jpegSegment(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/\0'), ...ascii(`<x:xmpmeta>${SECRET}</x:xmpmeta>`)]);
const comment = jpegSegment(0xfe, ascii(SECRET));
const iptc = jpegSegment(0xed, ascii(`Photoshop 3.0\0${SECRET}`));
const mpf = jpegSegment(0xe2, ascii(`MPF\0${SECRET}`));
const icc = jpegSegment(0xe2, ascii('ICC_PROFILE\0\x01\x01profile-bytes'));

describe('JPEG metadata removal', () => {
  it('removes EXIF, XMP, IPTC, comments and appended images, keeping the image data and orientation', () => {
    const image = syntheticImageBytes('image/jpeg', 64, [...exifSegment(6), ...xmp, ...iptc, ...comment, ...mpf, ...icc]);
    // A second image appended after the end marker, as phones do for thumbnails.
    const withTrailer = new Uint8Array([...image, 0xff, 0xd8, ...exifSegment(1), 0xff, 0xd9]);

    const cleaned = stripJpeg(withTrailer);
    expect(text(cleaned)).not.toContain('GPS-SECRET');
    expect(text(cleaned)).not.toContain('xmpmeta');
    expect(text(cleaned)).toContain('ICC_PROFILE'); // Colour profile kept.
    expect(text(cleaned)).toContain('JFIF');
    // The orientation survives as the only EXIF data.
    expect(text(cleaned).split('Exif').length - 1).toBe(1);
    expect(Array.from(cleaned)).toEqual(expect.arrayContaining(Array.from(orientationSegment(6))));
    // Ends at the main image's end marker, with its scan data unchanged.
    expect(Array.from(cleaned.slice(-2))).toEqual([0xff, 0xd9]);
    const scan = Array.from(image.slice(image.length - 66, image.length - 2));
    expect(Array.from(cleaned.slice(cleaned.length - 66, cleaned.length - 2))).toEqual(scan);
  });

  it('reads little-endian EXIF and keeps EXIF only when orientation matters', () => {
    const rotated = stripJpeg(new Uint8Array(syntheticImageBytes('image/jpeg', 8, exifSegment(8, true))));
    expect(Array.from(rotated)).toEqual(expect.arrayContaining(Array.from(orientationSegment(8))));
    const upright = stripJpeg(new Uint8Array(syntheticImageBytes('image/jpeg', 8, exifSegment(1))));
    expect(text(upright)).not.toContain('Exif');
  });

  it('places the orientation after EXIF that follows the JFIF header', () => {
    const cleaned = stripJpeg(new Uint8Array(syntheticImageBytes('image/jpeg', 8, exifSegment(3))));
    const start = text(cleaned).indexOf('Exif');
    expect(start).toBeGreaterThan(text(cleaned).indexOf('JFIF'));
    expect(start).toBeLessThan(text(cleaned).indexOf('\xff\xda'));
  });

  it('keeps stuffed bytes and restart markers inside image data', () => {
    const data = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd3, 0x56];
    const image = new Uint8Array([0xff, 0xd8, ...JFIF, ...jpegSegment(0xda, [1, 1, 0, 0, 0x3f, 0]), ...data, 0xff, 0xd9]);
    expect(Array.from(stripJpeg(image))).toEqual(Array.from(image));
  });

  it('refuses files that are not well-formed JPEGs', () => {
    expect(() => stripJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]))).toThrow(MetadataError);
    expect(() => stripJpeg(new Uint8Array([0xff, 0xd8, ...JFIF]))).toThrow(MetadataError); // No end marker.
    expect(() => stripJpeg(new Uint8Array(ascii('%PDF')))).toThrow(MetadataError);
  });
});

describe('PNG metadata removal', () => {
  it('removes text, EXIF and timestamp chunks and anything after the end', () => {
    const extra = [
      ...pngChunk('tEXt', ascii(`Comment\0${SECRET}`)),
      ...pngChunk('iTXt', ascii(`XML:com.adobe.xmp\0\0\0\0\0${SECRET}`)),
      ...pngChunk('zTXt', ascii(`Author\0\0${SECRET}`)),
      ...pngChunk('eXIf', ascii(SECRET)),
      ...pngChunk('tIME', [7, 234, 10, 15, 9, 0, 0]),
      ...pngChunk('pHYs', [0, 0, 11, 19, 0, 0, 11, 19, 1]),
    ];
    const image = new Uint8Array([...syntheticImageBytes('image/png', 32, extra), ...ascii(SECRET)]);
    const cleaned = stripPng(image);
    expect(text(cleaned)).not.toContain('GPS-SECRET');
    expect(text(cleaned)).not.toContain('tIME');
    expect(text(cleaned)).toContain('pHYs');
    expect(Array.from(cleaned)).toEqual(syntheticImageBytes('image/png', 32, pngChunk('pHYs', [0, 0, 11, 19, 0, 0, 11, 19, 1])));
  });

  it('refuses a truncated PNG', () => {
    const image = syntheticImageBytes('image/png', 16);
    expect(() => stripPng(new Uint8Array(image.slice(0, image.length - 12)))).toThrow(MetadataError);
  });
});

describe('WebP metadata removal', () => {
  it('removes EXIF and XMP chunks, clears their flags and fixes the container size', () => {
    const vp8x = webpChunk('VP8X', [0x08 | 0x04 | 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const image = new Uint8Array(
      riff([...vp8x, ...webpChunk('VP8 ', new Array<number>(20).fill(0x22)), ...webpChunk('EXIF', ascii(SECRET)), ...webpChunk('XMP ', ascii(SECRET))]),
    );
    const cleaned = stripWebp(image);
    expect(text(cleaned)).not.toContain('GPS-SECRET');
    expect(cleaned[20]).toBe(0x10); // Only the alpha flag remains.
    const view = new DataView(cleaned.buffer);
    expect(view.getUint32(4, true)).toBe(cleaned.length - 8);
  });
});

describe('uploads', () => {
  it('sends only the cleaned image', async () => {
    const original = new File([new Uint8Array(syntheticImageBytes('image/jpeg', 32, [...exifSegment(1), ...comment]))], 'photo.jpg', {
      type: 'image/jpeg',
    });
    const prepared = await preparePhoto(original);
    expect(prepared.ok).toBe(true);
    const store = new InMemoryPhotoStore();
    const photo = await store.uploadPhoto('case', 'ot', original);
    const sent = new Uint8Array(await store.uploadedBlobs[0]!.arrayBuffer());
    expect(text(sent)).not.toContain('GPS-SECRET');
    expect(photo.byteSize).toBe(sent.length);
    expect(sent.length).toBeLessThan(original.size);
  });

  it('refuses a file that claims to be an image but cannot be parsed', async () => {
    const broken = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x00])], 'x.jpg', { type: 'image/jpeg' });
    expect(await preparePhoto(broken)).toEqual({
      ok: false,
      message: 'This photo could not be prepared safely (its file structure is not recognised), so it was not uploaded.',
    });
  });
});
