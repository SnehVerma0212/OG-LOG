import { AccountError, type AccountService, type AuditEvent } from './accountService';

// TEST ONLY. Mirrors the server's behaviour, including refusing deletion
// while photo files remain.
export class InMemoryAccountService implements AccountService {
  readonly events: AuditEvent[] = [];
  deleted = false;
  filesRemain: () => boolean = () => false;

  async auditEvents(): Promise<AuditEvent[]> {
    return [...this.events];
  }

  async recordExport(): Promise<void> {
    this.events.push({ occurredAt: new Date().toISOString(), action: 'export.downloaded', recordId: null });
  }

  async deleteAccount(): Promise<void> {
    if (this.filesRemain()) {
      throw new AccountError('Some photo files could not be removed, so the account was not deleted. Contact the administrator.');
    }
    this.deleted = true;
  }
}
