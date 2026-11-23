// Account-level data: the activity log, and deleting the account itself.

export interface AuditEvent {
  occurredAt: string;
  action: string;
  recordId: string | null;
}

export interface AccountService {
  auditEvents(): Promise<AuditEvent[]>;
  // Adds "export downloaded" to the doctor's own activity log.
  recordExport(): Promise<void>;
  // Deletes the Auth account; the database removes the profile, cases,
  // attachment records and activity log with it. Photo files must already be
  // removed (the server refuses otherwise).
  deleteAccount(): Promise<void>;
}

export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountError';
  }
}
