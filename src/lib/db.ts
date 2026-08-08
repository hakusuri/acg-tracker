import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import type { Work, WorkInput } from '../types';

let db: Database | null = null;

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  year INTEGER,
  season TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  total_count INTEGER,
  current_count INTEGER DEFAULT 0,
  rating REAL,
  my_rating REAL,
  synopsis TEXT,
  tags TEXT,
  notes TEXT,
  cover_path TEXT,
  cover_url TEXT,
  links TEXT,
  source TEXT DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_works_category ON works(category);
CREATE INDEX IF NOT EXISTS idx_works_year ON works(year);
CREATE INDEX IF NOT EXISTS idx_works_status ON works(status);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function emitWorksChanged(): void {
  window.dispatchEvent(new CustomEvent('works-changed'));
}

export function onWorksChanged(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener('works-changed', handler);
  return () => window.removeEventListener('works-changed', handler);
}

async function migrate(d: Database): Promise<void> {
  for (const stmt of MIGRATIONS.split(';').map((s) => s.trim()).filter(Boolean)) {
    await d.execute(stmt);
  }
  try {
    await d.execute('ALTER TABLE works ADD COLUMN cover_url TEXT');
  } catch {
    // 列已存在时忽略
  }
}

async function openDatabase(): Promise<Database> {
  const custom = await invoke<string>('get_bootstrap_data_dir');
  if (custom && custom.trim()) {
    const dir = custom.trim();
    await invoke('ensure_data_dir', { dir });
    const path = `${dir.replace(/\\/g, '/')}/acg.db`;
    const d = await Database.load(`sqlite:${path}`);
    await migrate(d);
    return d;
  }
  await invoke('migrate_legacy_data');
  const defaultDir = await invoke<string>('get_data_dir');
  const path = `${defaultDir.replace(/\\/g, '/')}/acg.db`;
  const d = await Database.load(`sqlite:${path}`);
  await migrate(d);
  return d;
}

export async function getDb(): Promise<Database> {
  if (!db) {
    db = await openDatabase();
  }
  return db;
}

/** 数据目录变化后重载数据库连接（旧连接先关闭）。 */
export async function reloadDatabase(): Promise<void> {
  if (db) {
    try {
      await db.close();
    } catch {
      // 关闭失败不阻塞重新加载
    }
    db = null;
  }
  db = await openDatabase();
}

export async function listWorks(): Promise<Work[]> {
  const d = await getDb();
  return d.select<Work[]>('SELECT * FROM works ORDER BY created_at DESC, id DESC');
}

export async function getWork(id: number): Promise<Work | null> {
  const d = await getDb();
  const rows = await d.select<Work[]>('SELECT * FROM works WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function insertWork(input: WorkInput): Promise<number> {
  const d = await getDb();
  const now = new Date().toISOString();
  const res = await d.execute(
    `INSERT INTO works (title, category, year, season, status, total_count, current_count, rating, my_rating, synopsis, tags, notes, cover_path, cover_url, links, source, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [
      input.title, input.category, input.year, input.season, input.status,
      input.total_count, input.current_count, input.rating, input.my_rating,
      input.synopsis, input.tags, input.notes, input.cover_path, input.cover_url ?? '',
      input.links, input.source, now, now,
    ],
  );
  emitWorksChanged();
  return Number(res.lastInsertId ?? 0);
}

export async function updateWork(id: number, input: WorkInput): Promise<void> {
  const d = await getDb();
  const now = new Date().toISOString();
  await d.execute(
    `UPDATE works SET title=$1, category=$2, year=$3, season=$4, status=$5, total_count=$6, current_count=$7, rating=$8, my_rating=$9, synopsis=$10, tags=$11, notes=$12, cover_path=$13, cover_url=$14, links=$15, source=$16, updated_at=$17 WHERE id=$18`,
    [
      input.title, input.category, input.year, input.season, input.status,
      input.total_count, input.current_count, input.rating, input.my_rating,
      input.synopsis, input.tags, input.notes, input.cover_path, input.cover_url ?? '',
      input.links, input.source, now, id,
    ],
  );
  emitWorksChanged();
}

export async function deleteWork(id: number): Promise<void> {
  const d = await getDb();
  await d.execute('DELETE FROM works WHERE id = $1', [id]);
  emitWorksChanged();
}

export async function clearWorks(): Promise<void> {
  const d = await getDb();
  await d.execute('DELETE FROM works');
  emitWorksChanged();
}

export async function getSetting(key: string): Promise<string | null> {
  const d = await getDb();
  const rows = await d.select<Array<{ value: string }>>('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const d = await getDb();
  await d.execute(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}