import { roleLabel, SECTIONS, type CaseRecord, type SectionDefinition } from '@og-log/domain/cases';

import type { AuthUser } from '../auth/authService';
import type { CasePhoto } from '../photos/photoStore';
import type { AuditEvent } from './accountService';

// The doctor's records as an Excel workbook (.xlsx): one sheet per kind of
// record, linked by the case ID. Built in the browser; nothing is sent
// anywhere. Every stored field is included: section fields the app does not
// know (yet) get their own "Other: <key>" columns, so nothing is dropped.

export interface RecordsData {
  user: AuthUser;
  exportedAt: Date;
  cases: CaseRecord[];
  photos: CasePhoto[];
  activity: AuditEvent[];
}

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const SHEET_NAMES = ['Cases', 'Preoperative', 'Operative', 'Postoperative', 'Photos', 'Activity Log', 'Export Info'] as const;

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };
const SECTION_SHEETS: Record<SectionDefinition['key'], string> = { preop: 'Preoperative', ot: 'Operative', postop: 'Postoperative' };
const SECTION_LABELS: Record<SectionDefinition['key'], string> = { preop: 'Preoperative', ot: 'Operative (OT)', postop: 'Postoperative' };
const ACTIONS: Record<string, string> = {
  'case.created': 'Case created',
  'case.updated': 'Case updated',
  'case.deleted': 'Case deleted',
  'photo.added': 'Photo added',
  'photo.removed': 'Photo removed',
  'password.changed': 'Password changed',
  'export.downloaded': 'Export downloaded',
};
// Excel's limit for one cell.
const CELL_MAX_CHARACTERS = 32_767;
const DATE_FORMAT = 'yyyy-mm-dd';
const TIME_FORMAT = 'yyyy-mm-dd hh:mm:ss';

// Where a photo is stored inside the "Records and Photos" ZIP. IDs only.
export function photoFileName(photo: CasePhoto): string {
  return `photos/${photo.caseId}/${photo.section}-${photo.id}.${EXTENSIONS[photo.mimeType] ?? 'bin'}`;
}

export function sectionLabel(section: CasePhoto['section']): string {
  return SECTION_LABELS[section];
}

type Cell = { value?: string | number | Date; type?: StringConstructor | NumberConstructor | DateConstructor; format?: string; wrap?: boolean; fontWeight?: 'bold'; alignVertical?: 'top' } | null;

interface Column {
  header: string;
  width: number;
  cell: (row: never) => Cell;
}

function column<Row>(header: string, width: number, cell: (row: Row) => Cell): Column {
  return { header, width, cell: cell as (row: never) => Cell };
}

// Text exactly as stored. Characters XML cannot carry (control characters)
// use Excel's own _xHHHH_ escape instead of being dropped, and a literal
// "_xHHHH_" in the text is protected so Excel does not decode it.
function text(value: string | null | undefined, wrap = false): Cell {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (value.length > CELL_MAX_CHARACTERS) {
    throw new ExportError('One of your records has a field longer than Excel allows in a cell (32,767 characters). Nothing was saved.');
  }
  const escaped = value
    .replace(/_(x[0-9A-Fa-f]{4}_)/g, '_x005F_$1')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, (c) => `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`);
  return { value: escaped, type: String, wrap, alignVertical: 'top' };
}

function number(value: number): Cell {
  return { value, type: Number, alignVertical: 'top' };
}

// A calendar date (YYYY-MM-DD) as an Excel date. Excel cannot show dates
// before 1900, so those stay as text rather than turning into wrong numbers.
function calendarDate(value: string): Cell {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || Number(match[1]) < 1900) {
    return text(value);
  }
  return { value: new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))), type: Date, format: DATE_FORMAT, alignVertical: 'top' };
}

// A timestamp, shown in UTC (the headers say so).
function timestamp(value: string | null | undefined): Cell {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1900) {
    return text(value);
  }
  return { value: date, type: Date, format: TIME_FORMAT, alignVertical: 'top' };
}

// Section values are text in the app; anything else stored there is kept as JSON.
function fieldValue(value: unknown): Cell {
  if (value === null || value === undefined) {
    return null;
  }
  return text(typeof value === 'string' ? value : JSON.stringify(value), true);
}

interface SheetSpec<Row> {
  sheet: string;
  columns: Column[];
  rows: Row[];
}

function sheet<Row>(name: string, columns: Column[], rows: Row[]): SheetSpec<Row> {
  return { sheet: name, columns, rows };
}

export function compareCases(a: CaseRecord, b: CaseRecord): number {
  return a.surgeryDate.localeCompare(b.surgeryDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

// The sheets as plain rows and columns (also used by tests).
export function workbookSheets({ user, exportedAt, cases, photos, activity }: RecordsData): SheetSpec<unknown>[] {
  const caseIds = new Set(cases.map((record) => record.id));
  // Photos and cases are read separately; a photo of a case that is not in the
  // export means the records changed meanwhile. Never write a partial export.
  if (photos.some((photo) => !caseIds.has(photo.caseId))) {
    throw new ExportError('Your records changed while the export was being prepared. Nothing was saved. Try again.');
  }
  const ordered = [...cases].sort(compareCases);
  const byId = new Map(ordered.map((record) => [record.id, record]));
  const photoCounts = new Map<string, number>();
  for (const photo of photos) {
    photoCounts.set(photo.caseId, (photoCounts.get(photo.caseId) ?? 0) + 1);
  }
  const caseOrder = new Map(ordered.map((record, index) => [record.id, index]));
  const orderedPhotos = [...photos].sort(
    (a, b) => caseOrder.get(a.caseId)! - caseOrder.get(b.caseId)! || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );

  const caseColumns = [
    column<CaseRecord>('Case ID', 38, (record) => text(record.id)),
    column<CaseRecord>('Reference', 16, (record) => text(record.reference)),
    column<CaseRecord>('Surgery date', 13, (record) => calendarDate(record.surgeryDate)),
    column<CaseRecord>('Procedure', 36, (record) => text(record.procedure, true)),
  ];

  const sectionSheets = SECTIONS.map((section) => {
    const known = new Set(section.fields.map((field) => field.key));
    const extra = [...new Set(ordered.flatMap((record) => Object.keys(record.sections[section.key].fields)))].filter((key) => !known.has(key)).sort();
    return sheet(SECTION_SHEETS[section.key], [
      ...caseColumns,
      ...section.fields.map((field) =>
        column<CaseRecord>(field.label, field.multiline ? 48 : 22, (record) => fieldValue(record.sections[section.key].fields[field.key])),
      ),
      ...extra.map((key) => column<CaseRecord>(`Other: ${key}`, 30, (record) => fieldValue(record.sections[section.key].fields[key]))),
      column<CaseRecord>('Section updated (UTC)', 20, (record) => timestamp(record.sections[section.key].updatedAt)),
    ], ordered);
  });

  return [
    sheet('Cases', [
      ...caseColumns,
      column<CaseRecord>('Diagnosis', 40, (record) => text(record.diagnosis, true)),
      column<CaseRecord>('Surgical role', 16, (record) => (record.role ? text(roleLabel(record.role)) : null)),
      column<CaseRecord>('Status', 11, (record) => text(record.status === 'completed' ? 'Completed' : 'Draft')),
      column<CaseRecord>('Photos', 8, (record) => number(photoCounts.get(record.id) ?? 0)),
      column<CaseRecord>('Created (UTC)', 20, (record) => timestamp(record.createdAt)),
      column<CaseRecord>('Updated (UTC)', 20, (record) => timestamp(record.updatedAt)),
    ], ordered),
    ...sectionSheets,
    sheet('Photos', [
      column<CasePhoto>('Photo ID', 38, (photo) => text(photo.id)),
      column<CasePhoto>('Case ID', 38, (photo) => text(photo.caseId)),
      column<CasePhoto>('Reference', 16, (photo) => text(byId.get(photo.caseId)?.reference)),
      column<CasePhoto>('Procedure', 30, (photo) => text(byId.get(photo.caseId)?.procedure, true)),
      column<CasePhoto>('Section', 16, (photo) => text(sectionLabel(photo.section))),
      column<CasePhoto>('File in the photo export', 60, (photo) => text(photoFileName(photo))),
      column<CasePhoto>('File type', 12, (photo) => text(photo.mimeType)),
      column<CasePhoto>('Size (bytes)', 12, (photo) => number(photo.byteSize)),
      column<CasePhoto>('Added (UTC)', 20, (photo) => timestamp(photo.createdAt)),
    ], orderedPhotos),
    sheet('Activity Log', [
      column<AuditEvent>('Time (UTC)', 20, (event) => timestamp(event.occurredAt)),
      column<AuditEvent>('Action', 20, (event) => text(ACTIONS[event.action] ?? event.action)),
      column<AuditEvent>('Action code', 18, (event) => text(event.action)),
      column<AuditEvent>('Record ID', 38, (event) => text(event.recordId)),
      column<AuditEvent>('Case reference', 16, (event) => text(event.recordId ? byId.get(event.recordId)?.reference : null)),
    ], activity),
    sheet('Export Info', [
      column<[string, Cell]>('Item', 24, ([item]) => text(item)),
      column<[string, Cell]>('Value', 70, ([, value]) => value),
    ], [
      ['Exported (UTC)', timestamp(exportedAt.toISOString())],
      ['Account email', text(user.email)],
      ['Account ID', text(user.id)],
      ['Cases', number(ordered.length)],
      ['Photos', number(orderedPhotos.length)],
      ['Activity log entries', number(activity.length)],
      ['How sheets connect', text('Every sheet lists the Case ID; use it to match sections and photos to their case.', true)],
      ['Times', text('All times are in UTC.')],
      ['Sensitive data', text('This file may contain sensitive clinical information. Store it encrypted and delete copies you no longer need.', true)],
    ] as [string, Cell][]),
  ];
}

export async function buildRecordsWorkbook(data: RecordsData): Promise<Blob> {
  const sheets = workbookSheets(data);
  // Loaded only when someone exports, so the app itself stays small.
  const { default: writeXlsxFile } = await import('write-excel-file/universal');
  const filters = sheets.map((spec) => `A1:${columnLetter(spec.columns.length - 1)}${spec.rows.length + 1}`);
  const blob = await writeXlsxFile(
    sheets.map((spec) => ({
      sheet: spec.sheet,
      columns: spec.columns.map((item) => ({ width: item.width })),
      stickyRowsCount: 1,
      data: [
        spec.columns.map((item) => ({ value: item.header, type: String, fontWeight: 'bold' as const, wrap: true })),
        ...spec.rows.map((row) => spec.columns.map((item) => item.cell(row as never))),
      ],
    })),
    { fontFamily: 'Calibri', fontSize: 11, features: [autoFilter(filters)] },
  ).toBlob();
  return new Blob([blob], { type: XLSX_TYPE });
}

function columnLetter(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

// Adds a filter to each sheet's header row (not built into the library).
function autoFilter(ranges: string[]) {
  return {
    files: {
      transform: {
        'xl/worksheets/sheet{id}.xml': {
          transform: (xml: string, _options: unknown, { sheetIndex }: { sheetIndex: number }) =>
            xml.includes('<autoFilter') ? xml : xml.replace('</sheetData>', `</sheetData><autoFilter ref="${ranges[sheetIndex]}"/>`),
        },
      },
    },
  };
}
