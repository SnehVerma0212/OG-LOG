import type { SectionKey } from '@og-log/domain/cases';

import { generateId } from '../lib/ids';
import { preparePhoto } from './photoFiles';
import { PhotoError, type CasePhoto, type PhotoStore, type UploadProgress } from './photoStore';

// TEST ONLY. Holds photos in memory and can be told to fail specific steps, so
// screens can be tested against the same contract as the Supabase store.
export class InMemoryPhotoStore implements PhotoStore {
  readonly photos = new Map<string, CasePhoto & { hasFile: boolean }>();
  // What would have been sent to Storage, for checking metadata removal.
  readonly uploadedBlobs: Blob[] = [];
  private readonly files = new Map<string, Blob>();
  // Each counter makes the next N calls of that step fail.
  readonly failNext = { record: 0, upload: 0, deleteFile: 0, deleteRecord: 0, list: 0 };

  async listPhotos(caseId: string): Promise<CasePhoto[]> {
    if (this.take('list')) {
      throw new PhotoError('The photos could not be loaded.', 'record');
    }
    return [...this.photos.values()].filter((photo) => photo.caseId === caseId).map(({ hasFile: _hasFile, ...photo }) => photo);
  }

  async viewUrls(photos: CasePhoto[]): Promise<Map<string, string | null>> {
    return new Map(photos.map((photo) => [photo.id, this.photos.get(photo.id)?.hasFile ? `https://photos.test/${photo.id}` : null]));
  }

  async uploadPhoto(caseId: string, section: SectionKey, file: File, onProgress?: UploadProgress): Promise<CasePhoto> {
    const check = await preparePhoto(file);
    if (!check.ok) {
      throw new PhotoError(check.message, 'record');
    }
    this.uploadedBlobs.push(check.blob);
    if (this.take('record')) {
      throw new PhotoError('The photo could not be saved. Try again.', 'record');
    }
    onProgress?.(0.5);
    if (this.take('upload')) {
      // Rolled back, as the real store does: nothing remains.
      throw new PhotoError('The upload did not finish. Check your connection and try again.', 'file');
    }
    onProgress?.(1);
    const photo: CasePhoto = {
      id: generateId(),
      caseId,
      section,
      mimeType: check.type,
      byteSize: check.blob.size,
      createdAt: new Date().toISOString(),
    };
    this.photos.set(photo.id, { ...photo, hasFile: true });
    this.files.set(photo.id, check.blob);
    return photo;
  }

  async deletePhoto(photo: CasePhoto): Promise<void> {
    if (this.take('deleteFile')) {
      throw new PhotoError('The photo could not be removed. Check your connection and try again.', 'file');
    }
    const stored = this.photos.get(photo.id);
    if (stored) {
      stored.hasFile = false;
    }
    if (this.take('deleteRecord')) {
      throw new PhotoError('The photo file was removed, but its entry could not be deleted. Remove it again to finish.', 'partial');
    }
    this.photos.delete(photo.id);
  }

  async deleteCasePhotos(caseId: string): Promise<void> {
    if (this.take('deleteFile')) {
      throw new PhotoError("The case's photos could not be removed, so the case was not deleted. Try again.", 'file');
    }
    for (const photo of this.photos.values()) {
      if (photo.caseId === caseId) {
        this.photos.delete(photo.id);
      }
    }
  }

  async listAllPhotos(): Promise<CasePhoto[]> {
    return [...this.photos.values()].map(({ hasFile: _hasFile, ...photo }) => photo);
  }

  async downloadPhoto(photo: CasePhoto): Promise<Blob> {
    const file = this.photos.get(photo.id)?.hasFile ? this.files.get(photo.id) : undefined;
    if (!file) {
      throw new PhotoError('A photo file could not be downloaded.', 'file');
    }
    return file;
  }

  private take(step: keyof InMemoryPhotoStore['failNext']): boolean {
    if (this.failNext[step] > 0) {
      this.failNext[step] -= 1;
      return true;
    }
    return false;
  }
}
