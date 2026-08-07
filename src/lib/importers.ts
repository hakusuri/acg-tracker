import type { ImportRow, Season, Status } from '../types';

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
      links: '',
      source: 'bangumi',
      conflict: false,
      selected: true,
    });
  }
  return out;
}