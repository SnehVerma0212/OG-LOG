import type { SupabaseClient } from '@supabase/supabase-js';

import type { SectionKey } from '@og-log/domain/cases';

import { generateId } from '../lib/ids';
import { preparePhoto, sha256Hex } from './photoFiles';
import { PhotoError, type CasePhoto, type PhotoStore, type UploadProgress } from './photoStore';
import { storageUploadFailure } from './storageErrors';

// Case photos in a PRIVATE Supabase Storage bucket, with one public.case_attachments
// record per photo. Object paths are '<owner>/<case>/<attachment id>': no names
// or clinical details. Storage policies (migration 20261101120000) only allow
// reading, uploading or deleting an object whose path matches an attachment
// record the signed-in user owns, so:
//   upload: record first, then the file (rolled back if the file fails);
//   delete: file first, then the record (each step safe to retry).
// Files are shown through signed URLs that expire after a few minutes and are
// never stored.

export const PHOTO_BUCKET = 'case-photos';
const VIEW_URL_SECONDS = 600;
const ATTACHMENT_COLUMNS = 'id, case_id, category, mime_type, byte_size, created_at';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface AttachmentRow {
  id: string;
  case_id: string;
  category: SectionKey;
  mime_type: string;
  byte_size: number;
  created_at: string;
}

export interface ObjectUpload {
  url: string;
  headers: Record<string, string>;
  body: Blob;
  onProgress?: UploadProgress;
}

// Sends one file to the Storage API. Rejects only if the request could not
// complete. The body is the Storage API's reply, used only to choose an error message.
export type ObjectUploader = (upload: ObjectUpload) => Promise<{ status: number; body: string }>;

// Browser uploads use XMLHttpRequest, the one browser API that reports upload progress.
export const xhrUploader: ObjectUploader = ({ url, headers, body, onProgress }) =>
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url);
    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(event.loaded / event.total);
      }
    };
    request.onload = () => resolve({ status: request.status, body: request.responseText });
    request.onerror = () => reject(new Error('Upload connection failed.'));
    request.onabort = () => reject(new Error('Upload was interrupted.'));
    request.ontimeout = () => reject(new Error('Upload timed out.'));
    request.send(body);
  });

// For environments without XMLHttpRequest (e.g. Node in the integration tests).
export const fetchUploader: ObjectUploader = async ({ url, headers, body, onProgress }) => {
  const response = await fetch(url, { method: 'POST', headers, body });
  const text = await response.text();
  if (response.ok) {
    onProgress?.(1);
  }
  return { status: response.status, body: text };
};

interface Options {
  uploader?: ObjectUploader;
  onSessionExpired?: () => void | Promise<void>;
}

export class SupabasePhotoStore implements PhotoStore {
  private readonly uploader: ObjectUploader;
  private readonly onSessionExpired: () => void | Promise<void>;

  constructor(
    private readonly client: SupabaseClient,
    private readonly projectUrl: string,
    private readonly publishableKey: string,
    options: Options = {},
  ) {
    this.uploader = options.uploader ?? (typeof XMLHttpRequest === 'undefined' ? fetchUploader : xhrUploader);
    this.onSessionExpired = options.onSessionExpired ?? (() => undefined);
  }

  async listPhotos(caseId: string): Promise<CasePhoto[]> {
    if (!UUID.test(caseId)) {
      return [];
    }
    const { data, error, status } = await this.client
      .from('case_attachments')
      .select(ATTACHMENT_COLUMNS)
      .eq('case_id', caseId)
      .order('created_at')
      .order('id');
    if (error) {
      await this.checkSession(status);
      throw new PhotoError('The photos could not be loaded.', 'record');
    }
    return ((data ?? []) as AttachmentRow[]).map(toPhoto);
  }

  async viewUrls(photos: CasePhoto[]): Promise<Map<string, string | null>> {
    const urls = new Map<string, string | null>();
    if (photos.length === 0) {
      return urls;
    }
    const paths = await this.pathsFor(photos);
    const { data, error } = await this.client.storage.from(PHOTO_BUCKET).createSignedUrls([...paths.values()], VIEW_URL_SECONDS);
    if (error) {
      throw new PhotoError('The photos could not be loaded.', 'file');
    }
    const byPath = new Map((data ?? []).map((item) => [item.path, item.error ? null : item.signedUrl]));
    for (const [id, path] of paths) {
      urls.set(id, byPath.get(path) ?? null);
    }
    return urls;
  }

  async uploadPhoto(caseId: string, section: SectionKey, file: File, onProgress?: UploadProgress): Promise<CasePhoto> {
    // Checked and stripped of location/time/device metadata before anything is sent.
    const check = await preparePhoto(file);
    if (!check.ok) {
      throw new PhotoError(check.message, 'record');
    }
    const upload = check.blob;
    const session = await this.session();
    const id = generateId();
    const path = `${session.user.id}/${caseId}/${id}`;
    const sha256 = await sha256Hex(upload).catch(() => null);

    const { data, error, status } = await this.client
      .from('case_attachments')
      .insert({ id, case_id: caseId, category: section, storage_path: path, mime_type: check.type, byte_size: upload.size, sha256 })
      .select(ATTACHMENT_COLUMNS)
      .single();
    if (error) {
      await this.checkSession(status);
      throw new PhotoError(
        error.code === '23503' ? 'This case no longer exists, so the photo was not added.' : 'The photo could not be saved. Try again.',
        'record',
      );
    }
    const photo = toPhoto(data as AttachmentRow);

    let uploaded = false;
    let failure = 'The upload did not finish. Check your connection and try again.';
    try {
      const response = await this.uploader({
        url: `${this.projectUrl}/storage/v1/object/${PHOTO_BUCKET}/${path}`,
        headers: {
          authorization: `Bearer ${session.access_token}`,
          apikey: this.publishableKey,
          'content-type': check.type,
          'cache-control': 'private, max-age=300',
          'x-upsert': 'false', // Never overwrite an existing object.
        },
        body: upload,
        onProgress,
      });
      uploaded = response.status >= 200 && response.status < 300;
      if (!uploaded) {
        const refused = storageUploadFailure(response.status, response.body);
        failure = refused.message;
        if (refused.sessionExpired) {
          await this.onSessionExpired();
        }
      }
    } catch {
      // Network failure or interruption: the file may or may not have arrived.
    }
    if (uploaded) {
      return photo;
    }
    try {
      await this.deletePhoto(photo);
    } catch {
      throw new PhotoError(`${failure} An incomplete entry remains and shows as unavailable; remove it before trying again.`, 'partial');
    }
    throw new PhotoError(failure, 'file');
  }

  async deletePhoto(photo: CasePhoto): Promise<void> {
    const paths = await this.pathsFor([photo]);
    const path = paths.get(photo.id);
    if (path) {
      // Removing a file that is already gone is not an error.
      const { error } = await this.client.storage.from(PHOTO_BUCKET).remove([path]);
      if (error) {
        throw new PhotoError('The photo could not be removed. Check your connection and try again.', 'file');
      }
    }
    const { error, status } = await this.client.from('case_attachments').delete().eq('id', photo.id);
    if (error) {
      await this.checkSession(status);
      throw new PhotoError('The photo file was removed, but its entry could not be deleted. Remove it again to finish.', 'partial');
    }
  }

  async deleteCasePhotos(caseId: string): Promise<void> {
    const photos = await this.listPhotos(caseId);
    if (photos.length === 0) {
      return;
    }
    const failed = () => new PhotoError("The case's photos could not be removed, so the case was not deleted. Try again.", 'file');
    const paths = [...(await this.pathsFor(photos)).values()];
    for (let start = 0; start < paths.length; start += 100) {
      const { error } = await this.client.storage.from(PHOTO_BUCKET).remove(paths.slice(start, start + 100));
      if (error) {
        throw failed();
      }
    }
    // Confirm nothing is left before the case (and with it the records) goes.
    const folder = paths[0]!.slice(0, paths[0]!.lastIndexOf('/'));
    const { data, error } = await this.client.storage.from(PHOTO_BUCKET).list(folder, { limit: 1 });
    if (error || (data ?? []).length > 0) {
      throw failed();
    }
  }

  async listAllPhotos(): Promise<CasePhoto[]> {
    const all: CasePhoto[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error, status } = await this.client
        .from('case_attachments')
        .select(ATTACHMENT_COLUMNS)
        .order('id')
        .range(from, from + 999);
      if (error) {
        await this.checkSession(status);
        throw new PhotoError('The photos could not be loaded.', 'record');
      }
      const rows = (data ?? []) as AttachmentRow[];
      all.push(...rows.map(toPhoto));
      if (rows.length < 1000) {
        return all;
      }
    }
  }

  async downloadPhoto(photo: CasePhoto): Promise<Blob> {
    const path = (await this.pathsFor([photo])).get(photo.id)!;
    const { data, error } = await this.client.storage.from(PHOTO_BUCKET).download(path);
    if (error || !data) {
      throw new PhotoError('A photo file could not be downloaded.', 'file');
    }
    return data;
  }

  // Paths are rebuilt from the record IDs and the signed-in user, exactly as
  // the database requires them to be; the database rejects any other path.
  private async pathsFor(photos: CasePhoto[]): Promise<Map<string, string>> {
    const session = await this.session();
    return new Map(photos.map((photo) => [photo.id, `${session.user.id}/${photo.caseId}/${photo.id}`]));
  }

  private async session() {
    const { data } = await this.client.auth.getSession();
    if (!data.session) {
      await this.onSessionExpired();
      throw new PhotoError('Your session has ended. Please sign in again.', 'record');
    }
    return data.session;
  }

  private async checkSession(status: number) {
    if (status === 401) {
      await this.onSessionExpired();
    }
  }
}

function toPhoto(row: AttachmentRow): CasePhoto {
  return {
    id: row.id,
    caseId: row.case_id,
    section: row.category,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    createdAt: row.created_at,
  };
}
