// Turns a failed Storage API upload response into a message that is safe to
// show. Storage replies with JSON such as
//   { "statusCode": "404", "error": "Bucket not found", "message": "Bucket not found" }
// often with HTTP status 400. Only recognised errors are described; nothing
// from the response body is ever shown verbatim (it can contain paths), and
// tokens, keys and URLs are never part of the message.

export interface StorageFailure {
  message: string;
  sessionExpired: boolean;
}

interface StorageErrorBody {
  statusCode?: unknown;
  error?: unknown;
  message?: unknown;
  code?: unknown;
}

function parse(body: string): StorageErrorBody {
  try {
    const value = JSON.parse(body) as unknown;
    return value && typeof value === 'object' ? (value as StorageErrorBody) : {};
  } catch {
    return {};
  }
}

export function storageUploadFailure(status: number, body = ''): StorageFailure {
  const parsed = parse(body);
  const code = String(parsed.statusCode ?? status);
  const text = [parsed.error, parsed.message, parsed.code].filter((value) => typeof value === 'string').join(' ').toLowerCase();
  const failure = (message: string, sessionExpired = false) => ({ message, sessionExpired });

  if (/bucket not found/.test(text)) {
    return failure('Photo storage is not set up on the server yet, so the photo was not saved. Ask the administrator to finish the storage setup.');
  }
  if (status === 401 || /invalidjwt|jwt expired|exp.* claim|invalid jwt/.test(text)) {
    return failure('Your session has ended. Please sign in again.', true);
  }
  if (/row-level security|unauthorized|not authorized|access denied/.test(text) || code === '403' || status === 403) {
    return failure('You do not have permission to add this photo. It may belong to a case you cannot change.');
  }
  if (/payload too large|entitytoolarge|maximum allowed size|too large/.test(text) || code === '413' || status === 413) {
    return failure('This photo is larger than the server allows (10 MB).');
  }
  if (/mime type|invalid_mime_type|content type/.test(text) || code === '415' || status === 415) {
    return failure('The server does not accept this type of file. Use JPEG, PNG or WebP.');
  }
  if (/duplicate|already exists/.test(text) || code === '409' || status === 409) {
    return failure('A file already exists for this photo. Remove the photo and add it again.');
  }
  if (status === 429 || code === '429') {
    return failure('Too many uploads at once. Wait a moment, then try again.');
  }
  if (status >= 500) {
    return failure(`The storage server had a problem (error ${status}). Try again later.`);
  }
  return failure(`The server refused this upload (error ${status}).`);
}
