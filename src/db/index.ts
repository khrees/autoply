import { Database } from 'bun:sqlite';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

const AUTOPLY_DIR = process.env.AUTOPLY_HOME || join(homedir(), '.autoply');
const DB_PATH = join(AUTOPLY_DIR, 'autoply.db');

let db: Database | null = null;

export function getDbPath(): string {
  return DB_PATH;
}

export function getAutoplyDir(): string {
  return AUTOPLY_DIR;
}

export function ensureAutoplyDir(): void {
  if (!existsSync(AUTOPLY_DIR)) {
    mkdirSync(AUTOPLY_DIR, { recursive: true });
  }
}

export function getDb(): Database {
  if (!db) {
    ensureAutoplyDir();
    db = new Database(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    runMigrations(db);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function runMigrations(database: Database): void {
  // Create migrations table
  database.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const migrations = [
    {
      name: '001_create_profiles',
      sql: `
        CREATE TABLE IF NOT EXISTS profiles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          phone TEXT,
          location TEXT,
          linkedin_url TEXT,
          github_url TEXT,
          portfolio_url TEXT,
          base_resume TEXT,
          base_cover_letter TEXT,
          preferences TEXT DEFAULT '{}',
          skills TEXT DEFAULT '[]',
          experience TEXT DEFAULT '[]',
          education TEXT DEFAULT '[]',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
    },
    {
      name: '002_create_applications',
      sql: `
        CREATE TABLE IF NOT EXISTS applications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL,
          url TEXT NOT NULL,
          platform TEXT NOT NULL,
          company TEXT NOT NULL,
          job_title TEXT NOT NULL,
          status TEXT DEFAULT 'pending',
          generated_resume TEXT,
          generated_cover_letter TEXT,
          form_data TEXT,
          error_message TEXT,
          applied_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (profile_id) REFERENCES profiles(id)
        )
      `,
    },
    {
      name: '003_create_config',
      sql: `
        CREATE TABLE IF NOT EXISTS config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `,
    },
  ];

  const appliedMigrations = database
    .query<{ name: string }, []>('SELECT name FROM migrations')
    .all()
    .map((row) => row.name);

  for (const migration of migrations) {
    if (!appliedMigrations.includes(migration.name)) {
      database.exec(migration.sql);
      database.run('INSERT INTO migrations (name) VALUES (?)', [migration.name]);
    }
  }
}

export { Database };
