import { seasonFromDate } from './importers';
import type { ApiCategory, BangumiItem, Category, VndbItem, WorkFormPrefill } from '../types';

export interface PrefillBuildOpts {
  /** 是否下载封面到本地 */
  downloadCovers: boolean;
  /** 封面下载函数（由调用方注入真实实现，便于测试） */
  download: (url: string) => Promise<string>;
  /** 强制类别：与 API 搜索页的类别筛选保持一致；不传则按 Bangumi 类型映射 */
  forceCategory?: ApiCategory;
}

/**
 * 把 Bangumi 条目映射为作品表单预填数据（纯函数，不含网络/下载）。
 * 日历页与 API 搜索页共用此逻辑，保证两个入口的预填一致。
 */
export function mapBangumiPrefill(item: BangumiItem, forceCategory?: ApiCategory): WorkFormPrefill {
  const btypeCat: Category = item.btype === 1 ? 'manga' : item.btype === 4 ? 'galgame' : 'anime';
  const category: Category =
    forceCategory === 'light_novel'
      ? 'light_novel'
      : forceCategory === 'manga'
        ? 'manga'
        : forceCategory === 'anime'
          ? 'anime'
          : forceCategory === 'galgame'
            ? 'galgame'
            : btypeCat;
  const year = item.date ? parseInt(item.date.slice(0, 4), 10) || null : null;
  const totalCount =
    category === 'anime'
      ? (item.totalEpisodes ?? item.eps ?? null)
      : (item.volumes ?? item.eps ?? null);
  return {
    title: item.nameCn || item.name,
    category,
    year,
    season: category === 'anime' ? seasonFromDate(item.date ?? '') : null,
    synopsis: item.summary,
    cover_path: '',
    cover_url: item.image ?? '',
    rating: item.score,
    total_count: totalCount && totalCount > 0 ? totalCount : null,
    tags: item.tags.slice(0, 10).join(','),
    links: JSON.stringify([{ label: 'Bangumi', url: `https://bgm.tv/subject/${item.id}` }]),
    source: 'bangumi',
    bangumi_id: item.id,
    start_date: item.date ?? null,
  };
}

export async function buildBangumiPrefill(item: BangumiItem, opts: PrefillBuildOpts): Promise<WorkFormPrefill> {
  const prefill = mapBangumiPrefill(item, opts.forceCategory);
  const remote = item.image ?? '';
  // 在线地址始终保存在 cover_url；仅勾选自动下载封面时才把本地路径填入 cover_path
  if (remote && opts.downloadCovers) {
    try {
      prefill.cover_path = await opts.download(remote);
    } catch {
      // 下载失败时保留在线地址
    }
  }
  return prefill;
}

/** 把 VNDB 条目映射为作品表单预填数据（纯函数）。 */
export function mapVndbPrefill(item: VndbItem): WorkFormPrefill {
  const year = item.released ? parseInt(item.released.slice(0, 4), 10) || null : null;
  return {
    title: item.title,
    category: 'galgame',
    year,
    season: null,
    synopsis: item.description ?? '',
    cover_path: '',
    cover_url: item.image ?? '',
    rating: item.rating != null ? Math.round((item.rating / 10) * 10) / 10 : null,
    tags: item.tags.slice(0, 8).join(','),
    links: JSON.stringify([{ label: 'VNDB', url: `https://vndb.org/${item.id}` }]),
    source: 'vndb',
    vndb_id: item.id,
  };
}

export async function buildVndbPrefill(item: VndbItem, opts: PrefillBuildOpts): Promise<WorkFormPrefill> {
  const prefill = mapVndbPrefill(item);
  const remote = item.image ?? '';
  if (remote && opts.downloadCovers) {
    try {
      prefill.cover_path = await opts.download(remote);
    } catch {
      // 下载失败时保留在线地址
    }
  }
  return prefill;
}