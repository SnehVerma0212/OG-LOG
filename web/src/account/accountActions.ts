import type { AuthResult, AuthService, AuthUser } from '../auth/authService';
import type { CaseRepository } from '../data/caseRepository';
import { createZip, type ZipEntry } from '../lib/zip';
import { PhotoError, type PhotoStore } from '../photos/photoStore';
import { AccountError, type AccountService } from './accountService';
import { buildRecordsWorkbook, ExportError, photoFileName, sectionLabel } from './recordsWorkbook';

interface Services {
  auth: AuthService;
  repository: CaseRepository;
  photos: PhotoStore;
  account: AccountService;
}

export interface ExportFile {
  blob: Blob;
  filename: string;
}

// The doctor's own data. Records only: one Excel workbook (cases, the three
// sections, photo list, activity log). With photos: a ZIP holding the same
// workbook, the photo files, a photo manifest, and cases.json (the same
// records in a machine-readable form). File names use IDs only. Nothing is
// sent anywhere; the browser saves the file. Every read goes through the
// signed-in session, so Row Level Security limits it to the doctor's own data.
export async function buildExport(
  { repository, photos, account }: Omit<Services, 'auth'>,
  user: AuthUser,
  { includePhotos, onProgress, now = new Date() }: { includePhotos: boolean; onProgress?: (message: string) => void; now?: Date },
): Promise<ExportFile> {
  onProgress?.('Collecting cases…');
  const [cases, photoList, activity] = await Promise.all([repository.exportCases(), photos.listAllPhotos(), account.auditEvents()]);
  const data = { user, exportedAt: now, cases, photos: photoList, activity };
  onProgress?.('Building the Excel workbook…');
  const workbook = await buildRecordsWorkbook(data);
  const day = now.toISOString().slice(0, 10);
  const workbookName = `oglog-records-${day}.xlsx`;

  if (!includePhotos) {
    await account.recordExport().catch(() => undefined); // The export itself must not fail because logging did.
    return { blob: workbook, filename: workbookName };
  }

  const ordered = [...photoList].sort((a, b) => a.caseId.localeCompare(b.caseId) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const files: ZipEntry[] = [];
  const manifest = [['file', 'photo_id', 'case_id', 'section', 'mime_type', 'byte_size', 'added_at_utc', 'sha256']];
  for (const [index, photo] of ordered.entries()) {
    onProgress?.(`Adding photo ${index + 1} of ${ordered.length}…`);
    const bytes = new Uint8Array(await (await photos.downloadPhoto(photo)).arrayBuffer());
    if (bytes.length !== photo.byteSize) {
      throw new ExportError('A photo file did not download completely. Nothing was saved. Try again.');
    }
    files.push({ name: photoFileName(photo), data: bytes });
    manifest.push([photoFileName(photo), photo.id, photo.caseId, sectionLabel(photo.section), photo.mimeType, String(photo.byteSize), photo.createdAt, await sha256(bytes)]);
  }
  const document = {
    format: 'og-log-export',
    version: 1,
    exportedAt: now.toISOString(),
    account: { id: user.id, email: user.email },
    cases,
    photos: photoList.map((photo) => ({ ...photo, file: photoFileName(photo) })),
    activity,
  };
  const encode = (value: string) => new TextEncoder().encode(value);
  const entries: ZipEntry[] = [
    { name: workbookName, data: new Uint8Array(await workbook.arrayBuffer()) },
    // UTF-8 with a byte order mark so Excel reads it correctly. System values only (no clinical text).
    { name: 'photo-manifest.csv', data: encode(`\uFEFF${manifest.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`) },
    { name: 'cases.json', data: encode(JSON.stringify(document, null, 2)) },
    {
      name: 'README.txt',
      data: encode(
        `OG-LOG data export.\n${workbookName}: every case, its preoperative, operative and postoperative sections, the photo list and your activity log, linked by Case ID.\n` +
          'photo-manifest.csv: each photo file with its case, section, type, size, time added (UTC) and SHA-256 checksum.\n' +
          'photos/<case id>/: the photo files.\ncases.json: the same records in a machine-readable form.\n' +
          'This export may contain sensitive clinical information: store it encrypted and delete copies you no longer need.\n',
      ),
    },
    ...files,
  ];
  await account.recordExport().catch(() => undefined); // The export itself must not fail because logging did.
  return { blob: createZip(entries, now), filename: `oglog-records-and-photos-${day}.zip` };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Permanently deletes the account: confirms identity, removes every photo
// file (Storage), then the account, whose records the database deletes.
export async function deleteAccountCompletely(
  { auth, repository, photos, account }: Services,
  password: string,
  code: string | undefined,
  onProgress?: (message: string) => void,
): Promise<AuthResult> {
  onProgress?.('Confirming your identity…');
  const confirmed = await auth.reauthenticate(password, code);
  if (!confirmed.ok) {
    return confirmed;
  }
  try {
    const cases = await repository.exportCases();
    for (const [index, record] of cases.entries()) {
      onProgress?.(`Removing photos (${index + 1} of ${cases.length} cases)…`);
      await photos.deleteCasePhotos(record.id);
    }
    onProgress?.('Deleting the account…');
    await account.deleteAccount();
  } catch (error) {
    const message =
      error instanceof AccountError || error instanceof PhotoError
        ? error.message
        : 'The account could not be deleted. Some photos may already have been removed; try again.';
    return { ok: false, message };
  }
  await auth.signOut('accountDeleted');
  return { ok: true };
}
