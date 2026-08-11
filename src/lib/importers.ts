import type { Category, ImportRow, Season, Status } from '../types';

const SEASON_MONTHS: Record<number, Season> = {
  1: 'winter', 2: 'winter', 3: 'winter',
  4: 'spring', 5: 'spring', 6: 'spring',
  7: 'summer', 8: 'summer', 9: 'summer',
  10: 'autumn', 11: 'autumn', 12: 'autumn',
};

export function normalizeTitle(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function seasonFromDate(dateStr: string): Season | null {
  const m = parseInt(dateStr.slice(5, 7), 10);
  if (!Number.isNaN(m) && m >= 1 && m <= 12) return SEASON_MONTHS[m];
  return null;
}

function intOrNull(s: string): number | null {
  const cleaned = s.replace(/[^\d]/g, '');
  if (!cleaned) return null;
  const n = parseInt(cleaned, 10);
  return Number.isNaN(n) ? null : n;
}

function numOrNull(s: string): number | null {
  if (!s.trim()) return null;
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

function mapMalStatus(v: string): Status {
  const s = v.toLowerCase();
  if (s.includes('plan')) return 'planned';
  if (s.includes('hold')) return 'on_hold';
  if (s.includes('drop')) return 'dropped';
  if (s.includes('rewatch') || s.includes('reread')) return 'watching';
  if (s.includes('watch') || s.includes('read')) return 'watching';
  if (s.includes('complete')) return 'completed';
  return 'planned';
}

function malLinks(url: string, label: string): string {
  if (!url) return '';
  return JSON.stringify([{ label, url }]);
}

function parseDatePart(v: string): string | null {
  const m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v.trim());
  if (!m) return null;
  const y = m[1];
  const mo = m[2].padStart(2, '0');
  const d = m[3].padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

export function parseMalXml(xml: string): ImportRow[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const rows: ImportRow[] = [];

  const parseSection = (sectionName: 'anime' | 'manga') => {
    const sections = doc.getElementsByTagName(sectionName);
    for (const sec of Array.from(sections)) {
      const text = (tag: string) => {
        const el = sec.getElementsByTagName(tag)[0];
        return el?.textContent?.trim() ?? '';
      };
      const title = text('series_title');
      if (!title) continue;
      const start = text('series_start');
      const year = intOrNull(start.slice(0, 4));
      const season = sectionName === 'anime' ? seasonFromDate(start) : null;
      const totalCount = intOrNull(text('series_episodes') || text('series_chapters') || text('series_volumes'));
      const currentCount = intOrNull(text('my_watched_episodes') || text('my_read_chapters') || text('my_read_volumes'));
      const score = numOrNull(text('my_score'));
      rows.push({
        title,
        category: sectionName,
        year,
        season,
        status: mapMalStatus(text('my_status')),
        total_count: totalCount,
        current_count: currentCount,
        rating: null,
        my_rating: score,
        synopsis: text('series_synopsis'),
        tags: '',
        notes: text('my_comments'),
        cover_path: '',
        links: malLinks(text('series_url'), 'MAL'),
        source: 'mal',
        start_date: parseDatePart(text('my_start_date')),
        end_date: parseDatePart(text('my_finish_date')),
        mal_id: intOrNull(text('series_animedb_id')),
        conflict: false,
        selected: true,
      });
    }
  };

  parseSection('anime');
  parseSection('manga');
  return rows;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.length > 1 || field.trim()) rows.push(row);
  return rows;
}

function mapBangumiStatus(v: string): Status {
  const s = v.trim();
  if (s.includes('想看')) return 'planned';
  if (s.includes('在看')) return 'watching';
  if (s.includes('看过') || s.includes('读过') || s.includes('玩过')) return 'completed';
  if (s.includes('搁置')) return 'on_hold';
  if (s.includes('抛弃')) return 'dropped';
  return 'planned';
}

export function parseBangumiCsv(csvText: string): ImportRow[] {
  const rows = parseCsv(csvText);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const cId = header.findIndex((h) => h.trim() === 'id');
  const cTitle = col('中文名', '原名', '名称', '标题', 'title', 'name');
  const cYear = col('年份', '放送开始', '发售日', '日期', 'year', 'date', '开始');
  const cTotal = col('话数', '册数', '集数', 'episodes', 'total', '总数');
  const cStatus = col('状态', '收藏状态', '我的状态', 'status');
  const cRating = col('我的评分', '我的评价', '评分', 'rating', 'score');
  const cSynopsis = col('简介', '介绍', 'summary');
  const cTags = col('标签', 'tags');
  const cNotes = col('备注', '评论', '感想', 'notes');
  const cSeason = col('季度', 'season');

  const dataRows = rows.slice(1).filter((r) => r.some((cell) => cell.trim() !== ''));
  const out: ImportRow[] = [];

  for (const r of dataRows) {
    const get = (idx: number) => (idx >= 0 && idx < r.length ? r[idx].trim() : '');
    const title = cTitle >= 0 ? get(cTitle) : (r.find((cell) => cell.trim() !== '') ?? '');
    if (!title) continue;
    const start = get(cYear);
    const year = intOrNull(start.slice(0, 4));
    const seasonRaw = get(cSeason).toLowerCase();
    const season: Season | null =
      seasonRaw === 'winter' || seasonRaw === 'spring' || seasonRaw === 'summer' || seasonRaw === 'autumn'
        ? (seasonRaw as Season)
        : seasonFromDate(start);
    out.push({
      title,
      category: 'anime',
      year,
      season,
      status: mapBangumiStatus(get(cStatus)),
      total_count: intOrNull(get(cTotal)),
      current_count: null,
      rating: numOrNull(get(cRating)),
      my_rating: null,
      synopsis: get(cSynopsis),
      tags: get(cTags),
      notes: get(cNotes),
      cover_path: '',
      links: cId >= 0 ? JSON.stringify([{ label: 'Bangumi', url: `https://bgm.tv/subject/${intOrNull(get(cId)) ?? ''}` }]) : '',
      source: 'bangumi',
      bangumi_id: cId >= 0 ? intOrNull(get(cId)) : null,
      conflict: false,
      selected: true,
    });
  }
  return out;
}

function stripHtml(html: string): string {
  if (!html) return '';
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const text = doc.body?.textContent ?? '';
    return text.replace(/\s+/g, ' ').trim();
  } catch {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

function mapAnilistStatus(v: string): Status {
  const s = (v ?? '').toUpperCase();
  if (s === 'PLANNING') return 'planned';
  if (s === 'CURRENT' || s === 'REPEATING') return 'watching';
  if (s === 'COMPLETED') return 'completed';
  if (s === 'PAUSED') return 'on_hold';
  if (s === 'DROPPED') return 'dropped';
  return 'planned';
}

function formatAnilistDate(d: { year?: number | null; month?: number | null; day?: number | null } | null | undefined): string | null {
  if (!d || !d.year) return null;
  const mo = d.month ? String(d.month).padStart(2, '0') : '01';
  const day = d.day ? String(d.day).padStart(2, '0') : '01';
  return `${d.year}-${mo}-${day}`;
}

/** 解析 AniList 导出的 JSON 备份（data.mediaListCollection.lists[].entries[]）。 */
export function parseAniListJson(jsonText: string): ImportRow[] {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return [];
  }
  const root = data as {
    data?: { mediaListCollection?: { lists?: Array<{ entries?: unknown[] }> }; MediaListCollection?: { lists?: Array<{ entries?: unknown[] }> } };
  };
  const collection = root?.data?.mediaListCollection ?? root?.data?.MediaListCollection;
  const lists = Array.isArray(collection?.lists) ? collection.lists : [];
  const entries: Array<Record<string, unknown>> = [];
  for (const list of lists) {
    if (Array.isArray(list?.entries)) entries.push(...(list.entries as Array<Record<string, unknown>>));
  }
  if (entries.length === 0) return [];

  const out: ImportRow[] = [];
  for (const e of entries) {
    const media = (e.media ?? {}) as Record<string, unknown>;
    const type = String(media.type ?? '').toUpperCase();
    const format = String(media.format ?? '').toUpperCase();
    const category: Category = type === 'ANIME' ? 'anime' : format === 'NOVEL' ? 'light_novel' : 'manga';
    const titleRaw = (media.title ?? {}) as Record<string, unknown>;
    const title = String(titleRaw.userPreferred || titleRaw.romaji || titleRaw.english || titleRaw.native || '');
    if (!title.trim()) continue;

    const startedAt = e.startedAt as { year?: number; month?: number; day?: number } | null | undefined;
    const completedAt = e.completedAt as { year?: number; month?: number; day?: number } | null | undefined;
    const year = (media.seasonYear as number | null | undefined) ?? startedAt?.year ?? null;
    const seasonRaw = String(media.season ?? '').toUpperCase();
    const season: Season | null =
      category === 'anime' && ['WINTER', 'SPRING', 'SUMMER', 'FALL'].includes(seasonRaw)
        ? (seasonRaw.toLowerCase() as Season)
        : null;
    const totalCount =
      category === 'anime'
        ? ((media.episodes as number | null | undefined) ?? null)
        : ((media.volumes as number | null | undefined) ?? (media.chapters as number | null | undefined) ?? null);
    const scoreRaw = typeof e.score === 'number' ? e.score : null;
    const score = scoreRaw != null ? (scoreRaw > 20 ? scoreRaw / 10 : scoreRaw) : null;
    const myRating = score != null ? Math.round(score * 10) / 10 : null;

    const tags: string[] = [];
    if (Array.isArray(media.genres)) {
      for (const g of media.genres) {
        if (typeof g === 'string' && g.trim() && tags.length < 10) tags.push(g.trim());
      }
    }
    if (Array.isArray(media.tags)) {
      for (const t of media.tags) {
        const name = (t as Record<string, unknown>)?.name;
        if (typeof name === 'string' && name.trim() && tags.length < 10 && !tags.includes(name.trim())) tags.push(name.trim());
      }
    }

    const mediaId = (media.id as number | null | undefined) ?? null;
    const idMal = (media.idMal as number | null | undefined) ?? null;
    const linksArr: Array<{ label: string; url: string }> = [];
    if (mediaId) linksArr.push({ label: 'AniList', url: `https://anilist.co/${category === 'anime' ? 'anime' : 'manga'}/${mediaId}` });
    if (idMal) linksArr.push({ label: 'MAL', url: `https://myanimelist.net/${category === 'anime' ? 'anime' : 'manga'}/${idMal}` });

    const cover = (media.coverImage ?? {}) as Record<string, unknown>;
    const coverUrl = String(cover.large || cover.extraLarge || cover.medium || '');

    out.push({
      title: title.trim(),
      category,
      year,
      season,
      status: mapAnilistStatus(String(e.status ?? '')),
      total_count: totalCount,
      current_count: (e.progress as number | null | undefined) ?? null,
      rating: null,
      my_rating: myRating,
      synopsis: stripHtml(String(media.description ?? '')),
      tags: tags.slice(0, 10).join(','),
      notes: String(e.notes ?? ''),
      cover_path: '',
      cover_url: coverUrl,
      links: JSON.stringify(linksArr),
      source: 'anilist',
      start_date: formatAnilistDate(startedAt),
      end_date: formatAnilistDate(completedAt),
      anilist_id: mediaId,
      mal_id: idMal,
      conflict: false,
      selected: true,
    });
  }
  return out;
}

function mapKitsuStatus(v: string): Status {
  const s = v.toLowerCase();
  if (s.includes('plan')) return 'planned';
  if (s.includes('hold')) return 'on_hold';
  if (s.includes('drop')) return 'dropped';
  if (s.includes('repeat')) return 'watching';
  if (s.includes('watch') || s.includes('read')) return 'watching';
  if (s.includes('complete')) return 'completed';
  return 'planned';
}

function parseFlexDate(v: string): string | null {
  const m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(v.trim());
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

/** 解析 Kitsu 导出的 CSV（按表头自适应列名）。 */
export function parseKitsuCsv(csvText: string): ImportRow[] {
  let text = csvText;
  if (text.includes('\t') && text.split('\t').length > text.split(',').length) {
    text = text.replace(/\t/g, ',');
  }
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const cTitle = col('title', 'name');
  const cType = col('type');
  const cStatus = col('status');
  const cProgress = col('progress');
  const cScore = col('score', 'rating');
  const cNotes = col('notes', 'comment');
  const cStarted = col('started', 'start date', 'start');
  const cFinished = col('finished', 'finish date', 'completed', 'end date');
  const cEpisodes = col('episodes', 'total episodes');
  const cVolumes = col('volumes', 'total volumes');
  if (cTitle < 0) return [];

  const out: ImportRow[] = [];
  for (const r of rows.slice(1)) {
    if (!r.some((cell) => cell.trim() !== '')) continue;
    const get = (idx: number) => (idx >= 0 && idx < r.length ? r[idx].trim() : '');
    const title = get(cTitle);
    if (!title) continue;
    const typeRaw = get(cType).toLowerCase();
    const category: Category = typeRaw.includes('manga') ? 'manga' : 'anime';
    const total = category === 'anime' ? intOrNull(get(cEpisodes)) : (intOrNull(get(cVolumes)) ?? intOrNull(get(cEpisodes)));
    const scoreRaw = numOrNull(get(cScore));
    const myRating = scoreRaw != null ? Math.round((scoreRaw <= 5 ? scoreRaw * 2 : scoreRaw) * 10) / 10 : null;
    out.push({
      title,
      category,
      year: null,
      season: null,
      status: mapKitsuStatus(get(cStatus)),
      total_count: total,
      current_count: intOrNull(get(cProgress)),
      rating: null,
      my_rating: myRating,
      synopsis: '',
      tags: '',
      notes: get(cNotes),
      cover_path: '',
      cover_url: '',
      links: '',
      source: 'kitsu',
      start_date: parseFlexDate(get(cStarted)),
      end_date: parseFlexDate(get(cFinished)),
      conflict: false,
      selected: true,
    });
  }
  return out;
}