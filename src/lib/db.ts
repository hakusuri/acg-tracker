import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { CATEGORY_LABELS, STATUS_LABELS } from './constants';
import type { ActivityEntry, PlaySession, Work, WorkInput } from '../types';

let db: Database | null = null;
let dbPromise: Promise<Database> | null = null;

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
  start_date TEXT,
  end_date TEXT,
  playtime_minutes INTEGER DEFAULT 0,
  game_path TEXT,
  bangumi_id INTEGER,
  vndb_id TEXT,
  mal_id INTEGER,
  anilist_id INTEGER,
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
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
CREATE TABLE IF NOT EXISTS play_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_work ON play_sessions(work_id);
`;

const NEW_COLUMNS: Array<[string, string]> = [
  ['cover_url', 'TEXT'],
  ['start_date', 'TEXT'],
  ['end_date', 'TEXT'],
  ['playtime_minutes', 'INTEGER DEFAULT 0'],
  ['game_path', 'TEXT'],
  ['bangumi_id', 'INTEGER'],
  ['vndb_id', 'TEXT'],
  ['mal_id', 'INTEGER'],
  ['anilist_id', 'INTEGER'],
];

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
  for (const [name, def] of NEW_COLUMNS) {
    try {
      await d.execute(`ALTER TABLE works ADD COLUMN ${name} ${def}`);
    } catch {
      // 列已存在时忽略
    }
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

/** 获取共享数据库连接；并发调用时复用同一个初始化 Promise，避免重复迁移/多连接锁死。 */
export function getDb(): Promise<Database> {
  if (db) return Promise.resolve(db);
  if (!dbPromise) {
    dbPromise = openDatabase()
      .then((d) => {
        db = d;
        dbPromise = null;
        return d;
      })
      .catch((e) => {
        dbPromise = null;
        throw e;
      });
  }
  return dbPromise;
}

/** 关闭当前数据库连接（文件操作前使用，例如恢复备份）。 */
export async function closeDatabase(): Promise<void> {
  if (db) {
    try {
      await db.close();
    } catch {
      // 关闭失败不阻塞
    }
    db = null;
    dbPromise = null;
  }
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
  dbPromise = null;
  db = await openDatabase();
}

function normalizeExtra(input: WorkInput): {
  start_date: string | null;
  end_date: string | null;
  playtime_minutes: number;
  game_path: string;
  bangumi_id: number | null;
  vndb_id: string;
  mal_id: number | null;
  anilist_id: number | null;
} {
  return {
    start_date: input.start_date ?? null,
    end_date: input.end_date ?? null,
    playtime_minutes: input.playtime_minutes ?? 0,
    game_path: input.game_path ?? '',
    bangumi_id: input.bangumi_id ?? null,
    vndb_id: input.vndb_id ?? '',
    mal_id: input.mal_id ?? null,
    anilist_id: input.anilist_id ?? null,
  };
}

export async function addActivity(workId: number | null, action: string, detail: string): Promise<void> {
  const d = await getDb();
  await d.execute(
    'INSERT INTO activity_log (work_id, action, detail, created_at) VALUES ($1, $2, $3, $4)',
    [workId, action, detail, new Date().toISOString()],
  );
}

export async function listActivity(limit = 300): Promise<ActivityEntry[]> {
  const d = await getDb();
  return d.select<ActivityEntry[]>(
    'SELECT * FROM activity_log ORDER BY created_at DESC, id DESC LIMIT $1',
    [Math.max(1, Math.min(1000, limit))],
  );
}

export async function listActivityByWork(workId: number, limit = 10): Promise<ActivityEntry[]> {
  const d = await getDb();
  return d.select<ActivityEntry[]>(
    'SELECT * FROM activity_log WHERE work_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2',
    [workId, Math.max(1, Math.min(100, limit))],
  );
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

export function workToInput(w: Work): WorkInput {
  return {
    title: w.title,
    category: w.category,
    year: w.year,
    season: w.season,
    status: w.status,
    total_count: w.total_count,
    current_count: w.current_count,
    rating: w.rating,
    my_rating: w.my_rating,
    synopsis: w.synopsis,
    tags: w.tags,
    notes: w.notes,
    cover_path: w.cover_path,
    cover_url: w.cover_url,
    links: w.links,
    source: w.source,
    start_date: w.start_date ?? null,
    end_date: w.end_date ?? null,
    playtime_minutes: w.playtime_minutes ?? 0,
    game_path: w.game_path ?? '',
    bangumi_id: w.bangumi_id ?? null,
    vndb_id: w.vndb_id ?? '',
    mal_id: w.mal_id ?? null,
    anilist_id: w.anilist_id ?? null,
  };
}

export async function insertWork(input: WorkInput): Promise<number> {
  const d = await getDb();
  const now = new Date().toISOString();
  const extra = normalizeExtra(input);
  const res = await d.execute(
    `INSERT INTO works (title, category, year, season, status, total_count, current_count, rating, my_rating, synopsis, tags, notes, cover_path, cover_url, links, source, start_date, end_date, playtime_minutes, game_path, bangumi_id, vndb_id, mal_id, anilist_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)`,
    [
      input.title, input.category, input.year ?? null, input.season ?? null, input.status,
      input.total_count ?? null, input.current_count ?? 0, input.rating ?? null, input.my_rating ?? null,
      input.synopsis ?? '', input.tags ?? '', input.notes ?? '', input.cover_path ?? '', input.cover_url ?? '',
      input.links ?? '', input.source ?? 'manual',
      extra.start_date, extra.end_date, extra.playtime_minutes, extra.game_path,
      extra.bangumi_id, extra.vndb_id, extra.mal_id, extra.anilist_id,
      now, now,
    ],
  );
  const id = Number(res.lastInsertId ?? 0);
  await addActivity(id, 'add', `添加了《${input.title}》（${CATEGORY_LABELS[input.category] ?? input.category}）`);
  emitWorksChanged();
  return id;
}

async function rawUpdate(id: number, input: WorkInput): Promise<void> {
  const d = await getDb();
  const extra = normalizeExtra(input);
  await d.execute(
    `UPDATE works SET title=$1, category=$2, year=$3, season=$4, status=$5, total_count=$6, current_count=$7, rating=$8, my_rating=$9, synopsis=$10, tags=$11, notes=$12, cover_path=$13, cover_url=$14, links=$15, source=$16, start_date=$17, end_date=$18, playtime_minutes=$19, game_path=$20, bangumi_id=$21, vndb_id=$22, mal_id=$23, anilist_id=$24, updated_at=$25 WHERE id=$26`,
    [
      input.title, input.category, input.year ?? null, input.season ?? null, input.status,
      input.total_count ?? null, input.current_count ?? 0, input.rating ?? null, input.my_rating ?? null,
      input.synopsis ?? '', input.tags ?? '', input.notes ?? '', input.cover_path ?? '', input.cover_url ?? '',
      input.links ?? '', input.source ?? 'manual',
      extra.start_date, extra.end_date, extra.playtime_minutes, extra.game_path,
      extra.bangumi_id, extra.vndb_id, extra.mal_id, extra.anilist_id,
      new Date().toISOString(), id,
    ],
  );
}

export async function updateWork(id: number, input: WorkInput): Promise<void> {
  const old = await getWork(id);
  await rawUpdate(id, input);
  const title = input.title || old?.title || '';
  const parts: string[] = [];
  let progressChanged = false;
  let statusChanged = false;
  if ((old?.current_count ?? 0) !== (input.current_count ?? 0)) {
    parts.push(`进度 ${old?.current_count ?? 0} → ${input.current_count ?? 0}`);
    progressChanged = true;
  }
  if (old && old.status !== input.status) {
    parts.push(`状态 ${STATUS_LABELS[old.status] ?? old.status} → ${STATUS_LABELS[input.status] ?? input.status}`);
    statusChanged = true;
  }
  if (parts.length === 0) {
    await addActivity(id, 'update', `编辑了《${title}》`);
  } else if (input.status === 'completed' && old?.status !== 'completed') {
    await addActivity(id, 'complete', `《${title}》：${parts.join('；')}`);
  } else if (progressChanged && !statusChanged) {
    await addActivity(id, 'progress', `《${title}》：${parts.join('；')}`);
  } else if (statusChanged && !progressChanged) {
    await addActivity(id, 'status', `《${title}》：${parts.join('；')}`);
  } else {
    await addActivity(id, 'update', `《${title}》：${parts.join('；')}`);
  }
  emitWorksChanged();
}

export async function deleteWork(id: number): Promise<void> {
  const w = await getWork(id);
  const d = await getDb();
  await d.execute('DELETE FROM play_sessions WHERE work_id = $1', [id]);
  await d.execute('DELETE FROM works WHERE id = $1', [id]);
  if (w) await addActivity(null, 'delete', `删除了《${w.title}》`);
  emitWorksChanged();
}

export async function clearWorks(): Promise<void> {
  const d = await getDb();
  await d.execute('DELETE FROM works');
  await d.execute('DELETE FROM play_sessions');
  emitWorksChanged();
}

/** 按同源 ID（Bangumi / VNDB / MAL / AniList）查找已存在作品。 */
async function findMatch(input: WorkInput): Promise<Work | null> {
  const d = await getDb();
  const candidates: Array<[string, unknown]> = [
    ['bangumi_id', input.bangumi_id ?? null],
    ['vndb_id', input.vndb_id ?? ''],
    ['mal_id', input.mal_id ?? null],
    ['anilist_id', input.anilist_id ?? null],
  ];
  for (const [col, val] of candidates) {
    if (val === null || val === undefined || val === '') continue;
    const rows = await d.select<Work[]>(`SELECT * FROM works WHERE ${col} = $1 LIMIT 1`, [val as never]);
    if (rows[0]) return rows[0];
  }
  return null;
}

/** 同源 ID 合并：找到同 ID 作品则合并字段，否则新增。 */
export async function upsertBySourceId(input: WorkInput): Promise<{ id: number; merged: boolean }> {
  const existing = await findMatch(input);
  if (!existing) {
    const id = await insertWork(input);
    return { id, merged: false };
  }
  const merged: WorkInput = {
    ...workToInput(existing),
    title: existing.title,
    category: existing.category,
    year: existing.year ?? input.year ?? null,
    season: existing.category === 'anime' ? (existing.season ?? input.season ?? null) : null,
    status: existing.status,
    total_count: input.total_count ?? existing.total_count,
    current_count: existing.current_count ?? 0,
    rating: existing.rating ?? input.rating ?? null,
    my_rating: existing.my_rating,
    synopsis: existing.synopsis || input.synopsis || '',
    tags: existing.tags || input.tags || '',
    notes: existing.notes,
    cover_path: existing.cover_path || input.cover_path || '',
    cover_url: existing.cover_url || input.cover_url || '',
    links: existing.links || input.links || '',
    source: existing.source === 'manual' ? (input.source || 'manual') : existing.source,
    start_date: existing.start_date ?? input.start_date ?? null,
    end_date: existing.end_date ?? input.end_date ?? null,
    game_path: existing.game_path || input.game_path || '',
    bangumi_id: existing.bangumi_id ?? input.bangumi_id ?? null,
    vndb_id: existing.vndb_id || input.vndb_id || '',
    mal_id: existing.mal_id ?? input.mal_id ?? null,
    anilist_id: existing.anilist_id ?? input.anilist_id ?? null,
  };
  await rawUpdate(existing.id, merged);
  await addActivity(existing.id, 'import', `《${existing.title}》：同源合并（${input.source ?? '导入'}）`);
  emitWorksChanged();
  return { id: existing.id, merged: true };
}

/** 导入用：优先同源 ID 合并，其次标题+年份去重，最后新增。 */
export async function importWork(input: WorkInput): Promise<'inserted' | 'merged' | 'skipped'> {
  if (input.bangumi_id || input.vndb_id || input.mal_id || input.anilist_id) {
    const found = await findMatch(input);
    if (found) {
      await upsertBySourceId(input);
      return 'merged';
    }
  }
  const d = await getDb();
  const rows = await d.select<Array<{ id: number }>>(
    'SELECT id FROM works WHERE title = $1 AND (year = $2 OR (year IS NULL AND $2 IS NULL)) LIMIT 1',
    [input.title, input.year ?? null],
  );
  if (rows[0]) return 'skipped';
  await insertWork(input);
  return 'inserted';
}

export async function finishPlaySession(workId: number, startedAt: string, endedAt: string, durationSeconds: number): Promise<void> {
  const d = await getDb();
  const secs = Math.max(1, Math.round(durationSeconds));
  await d.execute(
    'INSERT INTO play_sessions (work_id, started_at, ended_at, duration_seconds) VALUES ($1, $2, $3, $4)',
    [workId, startedAt, endedAt, secs],
  );
  const mins = Math.max(1, Math.round(secs / 60));
  await d.execute(
    'UPDATE works SET playtime_minutes = COALESCE(playtime_minutes, 0) + $2, updated_at = $3 WHERE id = $1',
    [workId, mins, new Date().toISOString()],
  );
  await addActivity(workId, 'play', `游玩 ${formatMinutes(mins)}`);
  emitWorksChanged();
}

export async function listPlaySessions(workId: number, limit = 10): Promise<PlaySession[]> {
  const d = await getDb();
  return d.select<PlaySession[]>(
    'SELECT * FROM play_sessions WHERE work_id = $1 ORDER BY id DESC LIMIT $2',
    [workId, Math.max(1, Math.min(100, limit))],
  );
}

export function formatMinutes(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r > 0 ? `${h} 小时 ${r} 分钟` : `${h} 小时`;
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