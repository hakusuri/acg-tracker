import type { Category, Season, Status } from '../types';

export const CATEGORIES: Category[] = ['anime', 'manga', 'light_novel', 'galgame'];

export const CATEGORY_LABELS: Record<Category, string> = {
  anime: '番剧',
  manga: '漫画',
  light_novel: '轻小说',
  galgame: 'Galgame',
};

export const CATEGORY_COLORS: Record<Category, string> = {
  anime: '#6f9bff',
  manga: '#4fd1a5',
  light_novel: '#f6b45c',
  galgame: '#f176a6',
};

export const STATUSES: Status[] = ['planned', 'watching', 'completed', 'on_hold', 'dropped'];

export const STATUS_LABELS: Record<Status, string> = {
  planned: '计划',
  watching: '在看',
  completed: '已完结',
  on_hold: '搁置',
  dropped: '弃坑',
};

export const STATUS_COLORS: Record<Status, string> = {
  planned: '#94a3b8',
  watching: '#38bdf8',
  completed: '#34d399',
  on_hold: '#fbbf24',
  dropped: '#f87171',
};

export const SEASONS: Season[] = ['winter', 'spring', 'summer', 'autumn'];

export const SEASON_LABELS: Record<Season, string> = {
  winter: '冬',
  spring: '春',
  summer: '夏',
  autumn: '秋',
};

export const SOURCE_LABELS: Record<string, string> = {
  manual: '手动',
  mal: 'MAL',
  bangumi: 'Bangumi',
  vndb: 'VNDB',
};