export type Category = 'anime' | 'manga' | 'light_novel' | 'galgame';
export type Status = 'planned' | 'watching' | 'completed' | 'on_hold' | 'dropped';
export type Season = 'winter' | 'spring' | 'summer' | 'autumn';
export type ApiCategory = 'all' | Category;

export interface WorkFormPrefill {
  title?: string;
  category?: Category;
  year?: number | null;
  season?: Season | null;
  synopsis?: string;
  cover_path?: string;
  cover_url?: string;
  rating?: number | null;
  total_count?: number | null;
  tags?: string;
  links?: string;
  source?: string;
  start_date?: string | null;
  end_date?: string | null;
  game_path?: string;
  bangumi_id?: number | null;
  vndb_id?: string;
  mal_id?: number | null;
  anilist_id?: number | null;
}

export interface Work {
  id: number;
  title: string;
  category: Category;
  year: number | null;
  season: Season | null;
  status: Status;
  total_count: number | null;
  current_count: number | null;
  rating: number | null;
  my_rating: number | null;
  synopsis: string;
  tags: string;
  notes: string;
  cover_path: string;
  cover_url?: string;
  links: string;
  source: string;
  start_date?: string | null;
  end_date?: string | null;
  playtime_minutes?: number;
  game_path?: string;
  bangumi_id?: number | null;
  vndb_id?: string;
  mal_id?: number | null;
  anilist_id?: number | null;
  created_at: string;
  updated_at: string;
}

export interface WorkInput {
  title: string;
  category: Category;
  year?: number | null;
  season?: Season | null;
  status: Status;
  total_count?: number | null;
  current_count?: number | null;
  rating?: number | null;
  my_rating?: number | null;
  synopsis?: string;
  tags?: string;
  notes?: string;
  cover_path?: string;
  cover_url?: string;
  links?: string;
  source?: string;
  start_date?: string | null;
  end_date?: string | null;
  playtime_minutes?: number;
  game_path?: string;
  bangumi_id?: number | null;
  vndb_id?: string;
  mal_id?: number | null;
  anilist_id?: number | null;
}

export interface LinkItem {
  label: string;
  url: string;
}

export interface BangumiItem {
  id: number;
  name: string;
  nameCn: string;
  summary: string;
  date: string | null;
  image: string | null;
  score: number | null;
  eps: number | null;
  volumes: number | null;
  totalEpisodes: number | null;
  tags: string[];
  btype: number;
}

export interface VndbItem {
  id: string;
  title: string;
  released: string | null;
  image: string | null;
  rating: number | null;
  description: string | null;
  tags: string[];
}

export interface CalendarItem {
  id: number;
  name: string;
  nameCn: string;
  date: string | null;
  image: string | null;
  score: number | null;
  eps: number | null;
  btype: number;
  coverPath?: string;
}

export interface CalendarCacheData {
  fetchedAt: string;
  days: CalendarDay[];
}

export interface CalendarDay {
  weekday: number;
  en: string;
  cn: string;
  ja: string;
  items: CalendarItem[];
}

export interface ActivityEntry {
  id: number;
  work_id: number | null;
  action: string;
  detail: string;
  created_at: string;
}

export interface PlaySession {
  id: number;
  work_id: number;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
}

export interface BackupInfo {
  name: string;
  path: string;
  size: number;
  modified: string;
}

export interface UpdateCheck {
  latestVersion: string;
  htmlUrl: string;
  publishedAt: string;
  isNewer: boolean;
}

export interface ImportRow {
  title: string;
  category: Category;
  year: number | null;
  season: Season | null;
  status: Status;
  total_count: number | null;
  current_count: number | null;
  rating: number | null;
  my_rating: number | null;
  synopsis: string;
  tags: string;
  notes: string;
  cover_path: string;
  cover_url?: string;
  links: string;
  source: string;
  start_date?: string | null;
  end_date?: string | null;
  bangumi_id?: number | null;
  vndb_id?: string;
  mal_id?: number | null;
  anilist_id?: number | null;
  conflict: boolean;
  selected: boolean;
}