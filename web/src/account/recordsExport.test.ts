import { strFromU8, unzipSync } from 'fflate';
import readXlsxFile from 'read-excel-file/universal';
import { describe, expect, it } from 'vitest';

import type { CaseInput, CaseRecord } from '@og-log/domain/cases';

import { InMemoryCaseRepository } from '../data/inMemoryCaseRepository';
import { readZip } from '../lib/zip';
import { InMemoryPhotoStore } from '../photos/inMemoryPhotoStore';
import { TEST_USER } from '../test/fakeAuthService';
import { syntheticImage } from '../test/syntheticImages';
import { buildExport } from './accountActions';
import { InMemoryAccountService } from './inMemoryAccountService';
import { buildRecordsWorkbook, ExportError, SHEET_NAMES, XLSX_TYPE } from './recordsWorkbook';

// Excel exports of synthetic records: the workbook is read back with an
// independent reader, and its XML checked for layout (frozen header, filters,
// column widths, date formats).
const NOW = new Date('2026-11-02T10:00:00Z');
const UNICODE = 'Laparoscopic cholecystectomy — पित्ताशय 🩺 Ünïcödé, «מבחן»';
const MULTILINE = 'Line one\nLine two, with "quotes", <tags> & ampersands\n\n=SUM(1,2) stays text';

const input = (overrides: Partial<CaseInput> = {}): CaseInput => ({
  reference: '',
  surgeryDate: '2026-10-01',
  procedure: 'Synthetic procedure',
  diagnosis: '',
  role: null,
  status: 'draft',
  sections: { preop: {}, ot: {}, postop: {} },
  ...overrides,
});

async function seeded() {
  const repository = new InMemoryCaseRepository();
  const photos = new InMemoryPhotoStore();
  const account = new InMemoryAccountService();
  const full = await repository.createCase(
    input({
      reference: 'SYN-001',
      surgeryDate: '2026-09-15',
      procedure: UNICODE,
      diagnosis: 'Synthetic diagnosis',
      role: 'primary',
      status: 'completed',
      sections: {
        preop: { indication: MULTILINE, asaGrade: 'ASA II', futureField: 'kept although the app has no field for it' },
        ot: { anaesthesia: 'General', findings: 'Synthetic finding' },
        postop: { followUp: 'Reviewed at 2 weeks' },
      },
    }),
  );
  const empty = await repository.createCase(input({ surgeryDate: '2026-10-20' })); // No reference, diagnosis, role or sections.
  const jpeg = await photos.uploadPhoto(full.id, 'ot', syntheticImage('image/jpeg'));
  const png = await photos.uploadPhoto(full.id, 'postop', syntheticImage('image/png'));
  account.events.push(
    { occurredAt: '2026-10-01T08:00:00.000Z', action: 'case.created', recordId: full.id },
    { occurredAt: '2026-10-01T08:05:00.000Z', action: 'photo.added', recordId: jpeg.id },
  );
  return { repository, photos, account, full, empty, jpeg, png };
}

// Excel keeps times as fractions of a day; the reader floors them, so a
// time can come back up to a millisecond early (Excel itself rounds).
function nearTime(value: unknown, expected: string | Date) {
  expect(value).toBeInstanceOf(Date);
  expect(Math.abs((value as Date).getTime() - new Date(expected).getTime())).toBeLessThanOrEqual(1);
}

const unzip = async (blob: Blob) => unzipSync(new Uint8Array(await blob.arrayBuffer()));
const rowsOf = (sheets: { sheet: string; data: unknown[][] }[], name: string) => sheets.find((item) => item.sheet === name)!.data;

describe('Export Records (Excel workbook)', () => {
  it('downloads a valid .xlsx with every sheet, column and record, linked by case ID', async () => {
    const { repository, photos, account, full, empty, jpeg, png } = await seeded();
    const { blob, filename } = await buildExport({ repository, photos, account }, TEST_USER, { includePhotos: false, now: NOW });
    expect(filename).toBe('oglog-records-2026-11-02.xlsx');
    expect(blob.type).toBe(XLSX_TYPE);

    const sheets = await readXlsxFile(blob);
    expect(sheets.map((item) => item.sheet)).toEqual([...SHEET_NAMES]);

    const cases = rowsOf(sheets, 'Cases');
    expect(cases[0]).toEqual(['Case ID', 'Reference', 'Surgery date', 'Procedure', 'Diagnosis', 'Surgical role', 'Status', 'Photos', 'Created (UTC)', 'Updated (UTC)']);
    // Ordered by surgery date; text, dates, counts and empty values as stored.
    expect(cases.slice(1).map((row) => row[0])).toEqual([full.id, empty.id]);
    expect(cases[1]!.slice(1, 8)).toEqual(['SYN-001', new Date('2026-09-15T00:00:00Z'), UNICODE, 'Synthetic diagnosis', 'Primary surgeon', 'Completed', 2]);
    nearTime(cases[1]![8], full.createdAt);
    expect(cases[2]!.slice(1, 8)).toEqual([null, new Date('2026-10-20T00:00:00Z'), 'Synthetic procedure', null, null, 'Draft', 0]);

    const preop = rowsOf(sheets, 'Preoperative');
    expect(preop[0]).toEqual([
      'Case ID', 'Reference', 'Surgery date', 'Procedure',
      'Indication for surgery', 'Relevant investigations', 'ASA grade', 'Consent and planning notes',
      'Other: futureField', 'Section updated (UTC)',
    ]);
    expect(preop[1]!.slice(0, 9)).toEqual([full.id, 'SYN-001', new Date('2026-09-15T00:00:00Z'), UNICODE, MULTILINE, null, 'ASA II', null, 'kept although the app has no field for it']);
    expect(preop[2]!.slice(4, 9)).toEqual([null, null, null, null, null]);
    expect(rowsOf(sheets, 'Operative')[0]).toEqual([
      'Case ID', 'Reference', 'Surgery date', 'Procedure',
      'Anaesthesia type', 'Approach and technique', 'Intraoperative findings', 'Duration', 'Intraoperative complications',
      'Section updated (UTC)',
    ]);
    expect(rowsOf(sheets, 'Operative')[1]!.slice(4, 7)).toEqual(['General', null, 'Synthetic finding']);
    expect(rowsOf(sheets, 'Postoperative')[1]![7]).toBe('Reviewed at 2 weeks');

    const photoRows = rowsOf(sheets, 'Photos');
    expect(photoRows[0]).toEqual(['Photo ID', 'Case ID', 'Reference', 'Procedure', 'Section', 'File in the photo export', 'File type', 'Size (bytes)', 'Added (UTC)']);
    expect(photoRows.slice(1).map((row) => [row[0], row[1], row[4], row[5], row[6], row[7]]).sort()).toEqual([
      [jpeg.id, full.id, 'Operative (OT)', `photos/${full.id}/ot-${jpeg.id}.jpg`, 'image/jpeg', jpeg.byteSize],
      [png.id, full.id, 'Postoperative', `photos/${full.id}/postop-${png.id}.png`, 'image/png', png.byteSize],
    ].sort());

    const activity = rowsOf(sheets, 'Activity Log');
    expect(activity[0]).toEqual(['Time (UTC)', 'Action', 'Action code', 'Record ID', 'Case reference']);
    nearTime(activity[1]![0], '2026-10-01T08:00:00Z');
    expect(activity[1]!.slice(1)).toEqual(['Case created', 'case.created', full.id, 'SYN-001']);
    expect(activity[2]![3]).toBe(jpeg.id);

    const info = Object.fromEntries(rowsOf(sheets, 'Export Info').slice(1).map((row) => [row[0], row[1]]));
    nearTime(info['Exported (UTC)'], NOW);
    expect(info).toMatchObject({ 'Account email': TEST_USER.email, 'Account ID': TEST_USER.id, Cases: 2, Photos: 2, 'Activity log entries': 2 });
    // The export is recorded in the activity log.
    expect(account.events.at(-1)?.action).toBe('export.downloaded');
  });

  it('is laid out for reading: frozen bold headers, filters, column widths and date formats', async () => {
    const { repository, photos, account } = await seeded();
    const { blob } = await buildExport({ repository, photos, account }, TEST_USER, { includePhotos: false, now: NOW });
    const files = await unzip(blob);
    const cases = strFromU8(files['xl/worksheets/sheet1.xml']!);
    expect(cases).toMatch(/<pane [^>]*ySplit="1"[^>]*state="frozen"/);
    expect(cases).toContain('<autoFilter ref="A1:J3"/>');
    expect(cases).toMatch(/<col [^>]*width="38"/);
    for (const [index] of SHEET_NAMES.entries()) {
      const xml = strFromU8(files[`xl/worksheets/sheet${index + 1}.xml`]!);
      expect(xml).toContain('state="frozen"');
      expect(xml).toMatch(/<autoFilter ref="A1:[A-Z]+\d+"\/>/);
    }
    const styles = strFromU8(files['xl/styles.xml']!);
    expect(styles).toContain('formatCode="yyyy-mm-dd"');
    expect(styles).toContain('formatCode="yyyy-mm-dd hh:mm:ss"');
    expect(styles).toMatch(/<b\s*\/>/); // Bold header font.
    expect(styles).toMatch(/wrapText="1"/); // Multiline notes wrap.
  });

  it('keeps characters XML cannot carry instead of dropping them', async () => {
    const record: CaseRecord = {
      id: '22222222-2222-4222-8222-222222222222',
      reference: null,
      surgeryDate: '1899-12-31', // Before Excel's calendar: kept as text.
      procedure: 'Bell\u0007 and literal _x0041_',
      diagnosis: '',
      role: null,
      status: 'draft',
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-01T08:00:00.000Z',
      sections: {
        preop: { fields: {}, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z' },
        ot: { fields: {}, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z' },
        postop: { fields: {}, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z' },
      },
    };
    const blob = await buildRecordsWorkbook({ user: TEST_USER, exportedAt: NOW, cases: [record], photos: [], activity: [] });
    const strings = strFromU8((await unzip(blob))['xl/sharedStrings.xml']!);
    expect(strings).toContain('Bell_x0007_ and literal _x005F_x0041_');
    expect(strings).toContain('1899-12-31');
  });

  it('builds large workbooks (sheets over the 160 kB at which fflate would use a Worker; see fflateWithoutWorkers.test.ts)', async () => {
    const { full } = await seeded();
    const cases = Array.from({ length: 300 }, (_, index) => ({
      ...full,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      sections: { ...full.sections, preop: { ...full.sections.preop, fields: { indication: `Synthetic note ${index} `.repeat(120) } } },
    }));
    const blob = await buildRecordsWorkbook({ user: TEST_USER, exportedAt: NOW, cases, photos: [], activity: [] });
    expect(strFromU8((await unzip(blob))['xl/sharedStrings.xml']!).length).toBeGreaterThan(160_000);
    expect(rowsOf(await readXlsxFile(blob), 'Preoperative')).toHaveLength(301);
  });

  it('refuses to produce an incomplete workbook', async () => {
    const base = { user: TEST_USER, exportedAt: NOW, activity: [] };
    const { full } = await seeded();
    // A photo whose case is missing: the records changed during the export.
    const orphan = { id: '3', caseId: 'not-in-export', section: 'ot' as const, mimeType: 'image/jpeg', byteSize: 10, createdAt: NOW.toISOString() };
    await expect(buildRecordsWorkbook({ ...base, cases: [full], photos: [orphan] })).rejects.toThrow(ExportError);
    // A value longer than an Excel cell holds is never silently cut.
    const long = { ...full, diagnosis: 'x'.repeat(32_768) };
    await expect(buildRecordsWorkbook({ ...base, cases: [long], photos: [] })).rejects.toThrow(/longer than Excel allows/);
  });
});

describe('Export Records and Photos (ZIP)', () => {
  it('contains the workbook, every photo, a matching manifest, cases.json and a README', async () => {
    const { repository, photos, account, full, jpeg, png } = await seeded();
    account.recordExport = async () => undefined; // Keep the activity log identical for the comparison below.
    const { blob, filename } = await buildExport({ repository, photos, account }, TEST_USER, { includePhotos: true, now: NOW });
    expect(filename).toBe('oglog-records-and-photos-2026-11-02.zip');
    expect(blob.type).toBe('application/zip');
    const entries = readZip(new Uint8Array(await blob.arrayBuffer()));
    const byName = new Map(entries.map((entry) => [entry.name, entry.data]));
    const jpegFile = `photos/${full.id}/ot-${jpeg.id}.jpg`;
    const pngFile = `photos/${full.id}/postop-${png.id}.png`;
    expect(entries.map((entry) => entry.name).slice(0, 4)).toEqual(['oglog-records-2026-11-02.xlsx', 'photo-manifest.csv', 'cases.json', 'README.txt']);
    expect(entries.map((entry) => entry.name).slice(4).sort()).toEqual([jpegFile, pngFile].sort());

    // The same workbook as Export Records.
    const fromZip = await readXlsxFile(new Blob([byName.get('oglog-records-2026-11-02.xlsx')! as Uint8Array<ArrayBuffer>]));
    const alone = await readXlsxFile((await buildExport({ repository, photos, account }, TEST_USER, { includePhotos: false, now: NOW })).blob);
    expect(fromZip).toEqual(alone);

    // Photo files are the stored (metadata-free) bytes.
    const stored = new Uint8Array(await (await photos.downloadPhoto(jpeg)).arrayBuffer());
    expect([...byName.get(jpegFile)!]).toEqual([...stored]);

    const manifestBytes = byName.get('photo-manifest.csv')!;
    expect([...manifestBytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 byte order mark, for Excel.
    const csv = new TextDecoder().decode(manifestBytes); // (The decoder drops the mark.)
    const [header, ...rows] = csv.trimEnd().split('\r\n').map((line) => line.split(','));
    expect(header).toEqual(['file', 'photo_id', 'case_id', 'section', 'mime_type', 'byte_size', 'added_at_utc', 'sha256']);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const data = byName.get(row[0]!)!;
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>))].map((b) => b.toString(16).padStart(2, '0')).join('');
      expect(row[2]).toBe(full.id);
      expect(Number(row[5])).toBe(data.length);
      expect(row[7]).toBe(digest);
    }
    expect(rows.map((row) => [row[0], row[1], row[3], row[4]]).sort()).toEqual([
      [jpegFile, jpeg.id, 'Operative (OT)', 'image/jpeg'],
      [pngFile, png.id, 'Postoperative', 'image/png'],
    ].sort());

    // cases.json keeps the complete records in machine-readable form.
    const document = JSON.parse(new TextDecoder().decode(byName.get('cases.json')!)) as { cases: CaseRecord[]; photos: { file: string }[] };
    expect(document.cases.find((record) => record.id === full.id)?.sections.preop.fields.indication).toBe(MULTILINE);
    expect(document.photos.map((photo) => photo.file).sort()).toEqual([jpegFile, pngFile].sort());
    // File names use IDs only; no clinical text.
    expect(entries.map((entry) => entry.name).join(' ')).not.toMatch(/Synthetic|SYN-001/);
  });

  it('fails without saving anything when a photo cannot be downloaded completely', async () => {
    const { repository, photos, account, jpeg } = await seeded();
    const download = photos.downloadPhoto.bind(photos);
    photos.downloadPhoto = async (photo) => (photo.id === jpeg.id ? new Blob([new Uint8Array(3)]) : download(photo));
    await expect(buildExport({ repository, photos, account }, TEST_USER, { includePhotos: true, now: NOW })).rejects.toThrow(/did not download completely/);
    expect(account.events.map((event) => event.action)).not.toContain('export.downloaded');
  });
});
