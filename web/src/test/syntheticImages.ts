import { crc32 } from '../lib/crc32';

// Tiny synthetic "images": the minimum well-formed structure of each format
// with filler pixel data. No real photos are ever used in tests.
export const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0];
export const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const WEBP_HEADER = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

const ascii = (text: string) => Array.from(text, (character) => character.charCodeAt(0));
const u16be = (value: number) => [(value >> 8) & 0xff, value & 0xff];
const u32be = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
const u32le = (value: number) => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];

export const jpegSegment = (marker: number, payload: number[]) => [0xff, marker, ...u16be(payload.length + 2), ...payload];
export const JFIF = jpegSegment(0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const SOS_HEADER = jpegSegment(0xda, [1, 1, 0, 0, 0x3f, 0]);

export function pngChunk(type: string, data: number[]): number[] {
  const typed = [...ascii(type), ...data];
  return [...u32be(data.length), ...typed, ...u32be(crc32(new Uint8Array(typed)))];
}
const IHDR = pngChunk('IHDR', [...u32be(1), ...u32be(1), 8, 2, 0, 0, 0]);

export const webpChunk = (fourcc: string, data: number[]) => [...ascii(fourcc), ...u32le(data.length), ...data, ...(data.length % 2 ? [0] : [])];
export const riff = (chunks: number[]) => [...ascii('RIFF'), ...u32le(chunks.length + 4), ...ascii('WEBP'), ...chunks];

// `payload` bytes of filler image data; segments go between header and data.
export function syntheticImageBytes(type: ImageType, payload = 16, extra: number[] = []): number[] {
  const data = new Array<number>(payload).fill(0x11);
  if (type === 'image/jpeg') {
    return [0xff, 0xd8, ...JFIF, ...extra, ...SOS_HEADER, ...data, 0xff, 0xd9];
  }
  if (type === 'image/png') {
    return [...PNG_HEADER, ...IHDR, ...extra, ...pngChunk('IDAT', data), ...pngChunk('IEND', [])];
  }
  return riff([...extra, ...webpChunk('VP8 ', data)]);
}

export function syntheticImage(type: ImageType, payload = 16, name = 'synthetic') {
  if (payload <= 4096) {
    return new File([new Uint8Array(syntheticImageBytes(type, payload))], name, { type });
  }
  // Large files: build the structure around a typed-array payload (fast).
  const template = syntheticImageBytes(type, 0);
  const data = new Uint8Array(payload).fill(0x11);
  let parts: BlobPart[];
  if (type === 'image/jpeg') {
    parts = [new Uint8Array(template.slice(0, -2)), data, new Uint8Array([0xff, 0xd9])];
  } else if (type === 'image/png') {
    // IDAT length field + type, data, CRC (checksum not needed for size tests).
    const idatStart = template.length - 12 - 12;
    const header = template.slice(0, idatStart);
    const lengthAndType = [(payload >>> 24) & 0xff, (payload >>> 16) & 0xff, (payload >>> 8) & 0xff, payload & 0xff, 0x49, 0x44, 0x41, 0x54];
    parts = [new Uint8Array([...header, ...lengthAndType]), data, new Uint8Array([0, 0, 0, 0, ...template.slice(-12)])];
  } else {
    throw new Error('Large synthetic WebP files are not needed.');
  }
  return new File(parts, name, { type });
}

// A synthetic image of exactly `totalBytes`.
export function syntheticImageOfSize(type: ImageType, totalBytes: number) {
  const overhead = syntheticImageBytes(type, 0).length;
  return syntheticImage(type, totalBytes - overhead);
}
