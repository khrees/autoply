import { getDb } from '../index';
import type { Application, ApplicationStatus, Platform } from '../../types';
import type { SQLQueryBindings } from 'bun:sqlite';

export interface ApplicationRow {
  id: number;
  profile_id: number;
  url: string;
  platform: string;
  company: string;
  job_title: string;
  status: string;
  generated_resume: string | null;
  generated_cover_letter: string | null;
  form_data: string | null;
  error_message: string | null;
  time_saved: number | null;
  applied_at: string | null;
  created_at: string;
}

function rowToApplication(row: ApplicationRow): Application {
  return {
    id: row.id,
    profile_id: row.profile_id,
    url: row.url,
    platform: row.platform as Platform,
    company: row.company,
    job_title: row.job_title,
    status: row.status as ApplicationStatus,
    generated_resume: row.generated_resume ?? undefined,
    generated_cover_letter: row.generated_cover_letter ?? undefined,
    form_data: row.form_data
      ? (() => {
          try {
            return JSON.parse(row.form_data);
          } catch {
            return undefined;
          }
        })()
      : undefined,
    error_message: row.error_message ?? undefined,
    time_saved: row.time_saved ?? undefined,
    applied_at: row.applied_at ?? undefined,
    created_at: row.created_at,
  };
}

export class ApplicationRepository {
  create(application: Omit<Application, 'id' | 'created_at'>): Application {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO applications (
        profile_id, url, platform, company, job_title, status,
        generated_resume, generated_cover_letter, form_data, error_message, time_saved, applied_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      application.profile_id,
      application.url,
      application.platform,
      application.company,
      application.job_title,
      application.status,
      application.generated_resume ?? null,
      application.generated_cover_letter ?? null,
      application.form_data ? JSON.stringify(application.form_data) : null,
      application.error_message ?? null,
      application.time_saved ?? 0,
      application.applied_at ?? null
    );

    const created = this.findById(Number(result.lastInsertRowid));
    if (!created) {
      throw new Error('Failed to retrieve application after creation');
    }
    return created;
  }

  findById(id: number): Application | null {
    const db = getDb();
    const row = db
      .query<ApplicationRow, [number]>('SELECT * FROM applications WHERE id = ?')
      .get(id);
    return row ? rowToApplication(row) : null;
  }

  findByUrl(url: string): Application[] {
    const db = getDb();
    const rows = db
      .query<
        ApplicationRow,
        [string]
      >('SELECT * FROM applications WHERE url = ? ORDER BY created_at DESC')
      .all(url);
    return rows.map(rowToApplication);
  }

  existsByUrl(url: string, excludeFailedStatus = true): boolean {
    const db = getDb();
    // Only consider successfully submitted applications as "existing"
    // Failed applications should be retryable
    const query = excludeFailedStatus
      ? 'SELECT COUNT(*) as count FROM applications WHERE url = ? AND status = ?'
      : 'SELECT COUNT(*) as count FROM applications WHERE url = ?';
    const params = excludeFailedStatus ? [url, 'submitted'] : [url];
    const row = db.query<{ count: number }, string[]>(query).get(...params);
    return (row?.count ?? 0) > 0;
  }

  findAll(filters?: {
    status?: ApplicationStatus;
    company?: string;
    profile_id?: number;
  }): Application[] {
    const db = getDb();
    let query = 'SELECT * FROM applications WHERE 1=1';
    const params: unknown[] = [];

    if (filters?.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters?.company) {
      query += ' AND company LIKE ?';
      params.push(`%${filters.company}%`);
    }
    if (filters?.profile_id) {
      query += ' AND profile_id = ?';
      params.push(filters.profile_id);
    }

    query += ' ORDER BY created_at DESC';

    const stmt = db.query<ApplicationRow, SQLQueryBindings[]>(query);
    const rows = stmt.all(...(params as SQLQueryBindings[]));
    return rows.map(rowToApplication);
  }

  update(id: number, updates: Partial<Application>): Application | null {
    const db = getDb();
    const existing = this.findById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.generated_resume !== undefined) {
      fields.push('generated_resume = ?');
      values.push(updates.generated_resume);
    }
    if (updates.generated_cover_letter !== undefined) {
      fields.push('generated_cover_letter = ?');
      values.push(updates.generated_cover_letter);
    }
    if (updates.form_data !== undefined) {
      fields.push('form_data = ?');
      values.push(JSON.stringify(updates.form_data));
    }
    if (updates.error_message !== undefined) {
      fields.push('error_message = ?');
      values.push(updates.error_message);
    }
    if (updates.applied_at !== undefined) {
      fields.push('applied_at = ?');
      values.push(updates.applied_at);
    }
    if (updates.time_saved !== undefined) {
      fields.push('time_saved = ?');
      values.push(updates.time_saved);
    }

    if (fields.length > 0) {
      values.push(id);
      db.run(
        `UPDATE applications SET ${fields.join(', ')} WHERE id = ?`,
        values as SQLQueryBindings[]
      );
    }

    return this.findById(id);
  }

  delete(id: number): boolean {
    const db = getDb();
    const result = db.run('DELETE FROM applications WHERE id = ?', [id]);
    return result.changes > 0;
  }

  count(filters?: { status?: ApplicationStatus }): number {
    const db = getDb();
    let query = 'SELECT COUNT(*) as count FROM applications';
    const params: unknown[] = [];

    if (filters?.status) {
      query += ' WHERE status = ?';
      params.push(filters.status);
    }

    const stmt = db.query<{ count: number }, SQLQueryBindings[]>(query);
    const result = stmt.get(...(params as SQLQueryBindings[]));
    return result?.count ?? 0;
  }

  markStaleAsFailed(staleHours = 24): number {
    const db = getDb();
    const cutoff = new Date(Date.now() - staleHours * 60 * 60 * 1000).toISOString();
    const result = db.run(
      `UPDATE applications SET status = 'failed', error_message = 'Auto-failed: stuck in pending for > ${staleHours} hours' WHERE status = 'pending' AND created_at < ?`,
      [cutoff]
    );
    return result.changes;
  }
}

export const applicationRepository = new ApplicationRepository();
