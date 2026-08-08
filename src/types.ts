export type Category = 'anime' | 'manga' | 'light_novel' | 'galgame';
export type Status = 'planned' | 'watching' | 'completed' | 'on_hold' | 'dropped';
export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

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
  created_at: string;
  updated_at: string;
}

export interface WorkInput {
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
  links: string;
  source: string;
  conflict: boolean;
  selected: boolean;
}