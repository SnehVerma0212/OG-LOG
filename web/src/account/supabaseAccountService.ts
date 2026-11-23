import type { SupabaseClient } from '@supabase/supabase-js';

import { AccountError, type AccountService, type AuditEvent } from './accountService';

const PAGE = 1000;

export class SupabaseAccountService implements AccountService {
  constructor(private readonly client: SupabaseClient) {}

  async auditEvents(): Promise<AuditEvent[]> {
    const all: AuditEvent[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.client
        .from('audit_events')
        .select('occurred_at, action, record_id')
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) {
        throw new AccountError('The activity log could not be loaded.');
      }
      const rows = (data ?? []) as { occurred_at: string; action: string; record_id: string | null }[];
      all.push(...rows.map((row) => ({ occurredAt: row.occurred_at, action: row.action, recordId: row.record_id })));
      if (rows.length < PAGE) {
        return all;
      }
    }
  }

  async recordExport(): Promise<void> {
    const { error } = await this.client.from('audit_events').insert({ action: 'export.downloaded' });
    if (error) {
      throw new AccountError('The export could not be recorded in your activity log.');
    }
  }

  async deleteAccount(): Promise<void> {
    const { error } = await this.client.rpc('delete_my_account');
    if (error) {
      throw new AccountError(
        error.code === 'P0001'
          ? 'Some photo files could not be removed, so the account was not deleted. Contact the administrator.'
          : error.code === '42501'
            ? 'The account could not be deleted: confirm your password (and code) again, and make sure your initial password was changed.'
            : 'The account could not be deleted. Nothing more was removed. Try again.',
      );
    }
  }
}
