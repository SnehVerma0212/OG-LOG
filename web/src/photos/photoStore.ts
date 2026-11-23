import type { SectionKey } from '@og-log/domain/cases';

// The only way screens reach case photos. Photos belong to one of the case's
// three sections, using the same keys as the case sections: 'preop'
// (preoperative), 'ot' (operative / OT record) and 'postop' (postoperative).

export interface CasePhoto {
  id: string;
  caseId: string;
  section: SectionKey;
  mimeType: string;
  byteSize: number;
  createdAt: string;
}

export type UploadProgress = (fraction: number) => void;

export interface PhotoStore {
  listPhotos(caseId: string): Promise<CasePhoto[]>;
  // Short-lived URLs for displaying photos. Never stored; a photo whose file
  // is missing (an interrupted upload) maps to null.
  viewUrls(photos: CasePhoto[]): Promise<Map<string, string | null>>;
  // Resolves only when both the file and its record are saved. On failure,
  // anything partly saved is removed again where possible.
  uploadPhoto(caseId: string, section: SectionKey, file: File, onProgress?: UploadProgress): Promise<CasePhoto>;
  // Removes the file, then its record. Safe to retry after a partial failure.
  deletePhoto(photo: CasePhoto): Promise<void>;
  // Removes every photo file of a case, before the case itself is deleted.
  deleteCasePhotos(caseId: string): Promise<void>;
  // For the doctor's own data export.
  listAllPhotos(): Promise<CasePhoto[]>;
  downloadPhoto(photo: CasePhoto): Promise<Blob>;
}

export class PhotoError extends Error {
  constructor(
    message: string,
    // 'record': nothing was saved. 'file': the upload or removal of the file
    // failed and nothing changed. 'partial': a record without its file remains
    // and shows as unavailable until it is removed (removal is safe to retry).
    readonly stage: 'record' | 'file' | 'partial' = 'file',
  ) {
    super(message);
    this.name = 'PhotoError';
  }
}
