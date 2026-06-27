import { getDb } from '../index';
import type { Profile, Preferences, Experience, Education } from '../../types';

export interface ProfileRow {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  location: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  base_resume: string | null;
  base_cover_letter: string | null;
  preferences: string;
  skills: string;
  experience: string;
  education: string;
  created_at: string;
  updated_at: string;
}

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? undefined,
    location: row.location ?? undefined,
    linkedin_url: row.linkedin_url ?? undefined,
    github_url: row.github_url ?? undefined,
    portfolio_url: row.portfolio_url ?? undefined,
    base_resume: row.base_resume ?? undefined,
    base_cover_letter: row.base_cover_letter ?? undefined,
    preferences: safeJsonParse<Preferences>(row.preferences, {} as Preferences),
    skills: safeJsonParse<string[]>(row.skills, []),
    experience: safeJsonParse<Experience[]>(row.experience, []),
    education: safeJsonParse<Education[]>(row.education, []),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class ProfileRepository {
  create(profile: Omit<Profile, 'id' | 'created_at' | 'updated_at'>): Profile {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO profiles (
        name, email, phone, location, linkedin_url, github_url, portfolio_url,
        base_resume, base_cover_letter, preferences, skills, experience, education
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      profile.name,
      profile.email,
      profile.phone ?? null,
      profile.location ?? null,
      profile.linkedin_url ?? null,
      profile.github_url ?? null,
      profile.portfolio_url ?? null,
      profile.base_resume ?? null,
      profile.base_cover_letter ?? null,
      JSON.stringify(profile.preferences ?? {}),
      JSON.stringify(profile.skills ?? []),
      JSON.stringify(profile.experience ?? []),
      JSON.stringify(profile.education ?? [])
    );

    const created = this.findById(Number(result.lastInsertRowid));
    if (!created) {
      throw new Error('Failed to retrieve profile after creation');
    }
    return created;
  }

  findById(id: number): Profile | null {
    const db = getDb();
    const row = db.query<ProfileRow, [number]>('SELECT * FROM profiles WHERE id = ?').get(id);
    return row ? rowToProfile(row) : null;
  }

  findFirst(): Profile | null {
    const db = getDb();
    const row = db.query<ProfileRow, []>('SELECT * FROM profiles ORDER BY id LIMIT 1').get();
    return row ? rowToProfile(row) : null;
  }

  findAll(): Profile[] {
    const db = getDb();
    const rows = db.query<ProfileRow, []>('SELECT * FROM profiles ORDER BY id').all();
    return rows.map(rowToProfile);
  }

  update(id: number, profile: Partial<Profile>): Profile | null {
    const db = getDb();
    const existing = this.findById(id);
    if (!existing) return null;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (profile.name !== undefined) {
      updates.push('name = ?');
      values.push(profile.name);
    }
    if (profile.email !== undefined) {
      updates.push('email = ?');
      values.push(profile.email);
    }
    if (profile.phone !== undefined) {
      updates.push('phone = ?');
      values.push(profile.phone);
    }
    if (profile.location !== undefined) {
      updates.push('location = ?');
      values.push(profile.location);
    }
    if (profile.linkedin_url !== undefined) {
      updates.push('linkedin_url = ?');
      values.push(profile.linkedin_url);
    }
    if (profile.github_url !== undefined) {
      updates.push('github_url = ?');
      values.push(profile.github_url);
    }
    if (profile.portfolio_url !== undefined) {
      updates.push('portfolio_url = ?');
      values.push(profile.portfolio_url);
    }
    if (profile.base_resume !== undefined) {
      updates.push('base_resume = ?');
      values.push(profile.base_resume);
    }
    if (profile.base_cover_letter !== undefined) {
      updates.push('base_cover_letter = ?');
      values.push(profile.base_cover_letter);
    }
    if (profile.preferences !== undefined) {
      updates.push('preferences = ?');
      values.push(JSON.stringify(profile.preferences));
    }
    if (profile.skills !== undefined) {
      updates.push('skills = ?');
      values.push(JSON.stringify(profile.skills));
    }
    if (profile.experience !== undefined) {
      updates.push('experience = ?');
      values.push(JSON.stringify(profile.experience));
    }
    if (profile.education !== undefined) {
      updates.push('education = ?');
      values.push(JSON.stringify(profile.education));
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);
      db.run(
        `UPDATE profiles SET ${updates.join(', ')} WHERE id = ?`,
        values as (string | number | null)[]
      );
    }

    return this.findById(id);
  }

  delete(id: number): boolean {
    const db = getDb();
    const result = db.run('DELETE FROM profiles WHERE id = ?', [id]);
    return result.changes > 0;
  }

  count(): number {
    const db = getDb();
    const result = db.query<{ count: number }, []>('SELECT COUNT(*) as count FROM profiles').get();
    return result?.count ?? 0;
  }
}

export const profileRepository = new ProfileRepository();
