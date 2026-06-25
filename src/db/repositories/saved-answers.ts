import { getDb } from '../index';
import { createHash } from 'crypto';

export interface SavedAnswer {
  id?: number;
  profile_id: number;
  question_hash: string;
  question: string;
  answer: string;
  used_count: number;
  created_at?: string;
  updated_at?: string;
}

function hashQuestion(question: string): string {
  // Normalize: lowercase, strip punctuation, collapse whitespace
  const normalized = question
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export class SavedAnswersRepository {
  upsert(profileId: number, question: string, answer: string): SavedAnswer {
    const db = getDb();
    const hash = hashQuestion(question);
    db.run(
      `INSERT INTO saved_answers (profile_id, question_hash, question, answer, used_count, updated_at)
       VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(profile_id, question_hash) DO UPDATE SET
         answer = excluded.answer,
         used_count = used_count + 1,
         updated_at = CURRENT_TIMESTAMP`,
      [profileId, hash, question, answer]
    );
    return this.findByHash(profileId, hash)!;
  }

  findSimilar(profileId: number, question: string, limit = 5): SavedAnswer[] {
    const db = getDb();
    const hash = hashQuestion(question);
    // Exact hash match first
    const exact = this.findByHash(profileId, hash);
    if (exact) return [exact];

    // Keyword-based fuzzy match: look for rows where the question contains key words
    const keywords = question
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .slice(0, 5);

    if (keywords.length === 0) return [];

    const conditions = keywords.map(() => 'LOWER(question) LIKE ?').join(' OR ');
    const params: (string | number)[] = [profileId, ...keywords.map((k) => `%${k}%`), limit];
    const rows = db
      .query<
        SavedAnswer,
        (string | number)[]
      >(`SELECT * FROM saved_answers WHERE profile_id = ? AND (${conditions}) ORDER BY used_count DESC LIMIT ?`)
      .all(...params);
    return rows;
  }

  findByHash(profileId: number, hash: string): SavedAnswer | null {
    const db = getDb();
    return (
      db
        .query<
          SavedAnswer,
          [number, string]
        >('SELECT * FROM saved_answers WHERE profile_id = ? AND question_hash = ?')
        .get(profileId, hash) ?? null
    );
  }

  findAll(profileId: number): SavedAnswer[] {
    const db = getDb();
    return db
      .query<
        SavedAnswer,
        [number]
      >('SELECT * FROM saved_answers WHERE profile_id = ? ORDER BY used_count DESC')
      .all(profileId);
  }

  delete(id: number): boolean {
    const db = getDb();
    return db.run('DELETE FROM saved_answers WHERE id = ?', [id]).changes > 0;
  }
}

export const savedAnswersRepository = new SavedAnswersRepository();
