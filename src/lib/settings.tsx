import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { allowAssetDir } from './api';
import { getSetting, setSetting } from './db';
import type { Category, Status } from '../types';

export type ThemeMode = 'auto' | 'light' | 'dark';
export type Density = 'comfortable' | 'compact';
export type ViewMode = 'grid' | 'list';
export type CloseBehavior = 'exit' | 'tray';
export type ProxyMode = 'auto' | 'direct' | 'custom';
export type SortKey = 'created_desc' | 'created_asc' | 'year_desc' | 'year_asc' | 'rating_desc' | 'title';

export interface AppSettings {
  dataDir: string;
  backgroundImage: string;
  theme: ThemeMode;
  density: Density;
  viewMode: ViewMode;
  closeBehavior: CloseBehavior;
  defaultCategory: Category;
  defaultStatus: Status;
  defaultSort: SortKey;
  searchLimit: number;
  downloadCovers: boolean;
  proxyMode: ProxyMode;
  proxyUrl: string;
  bangumiApiBase: string;
  vndbApiBase: string;
  autoBackup: boolean;
  backupCount: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  dataDir: '',
  backgroundImage: '',
  theme: 'auto',
  density: 'comfortable',
  viewMode: 'grid',
  closeBehavior: 'exit',
  defaultCategory: 'anime',
  defaultStatus: 'planned',
  defaultSort: 'created_desc',
  searchLimit: 30,
  downloadCovers: true,
  proxyMode: 'auto',
  proxyUrl: '',
  bangumiApiBase: 'https://api.bgm.tv',
  vndbApiBase: 'https://api.vndb.org',
  autoBackup: true,
  backupCount: 3,
};

const SETTING_KEYS: Record<keyof AppSettings, string> = {
  dataDir: 'data_dir',
  backgroundImage: 'background_image',
  theme: 'theme',
  density: 'density',
  viewMode: 'view_mode',
  closeBehavior: 'close_behavior',
  defaultCategory: 'default_category',
  defaultStatus: 'default_status',
  defaultSort: 'default_sort',
  searchLimit: 'search_limit',
  downloadCovers: 'download_covers',
  proxyMode: 'proxy_mode',
  proxyUrl: 'proxy_url',
  bangumiApiBase: 'bangumi_api_base',
  vndbApiBase: 'vndb_api_base',
  autoBackup: 'auto_backup',
  backupCount: 'backup_count',
};

const THEMES: ThemeMode[] = ['auto', 'light', 'dark'];
const DENSITIES: Density[] = ['comfortable', 'compact'];
const VIEW_MODES: ViewMode[] = ['grid', 'list'];
const CLOSE_BEHAVIORS: CloseBehavior[] = ['exit', 'tray'];
const PROXY_MODES: ProxyMode[] = ['auto', 'direct', 'custom'];
const SORTS: SortKey[] = ['created_desc', 'created_asc', 'year_desc', 'year_asc', 'rating_desc', 'title'];
const CATEGORIES: Category[] = ['anime', 'manga', 'light_novel', 'galgame'];
const STATUSES: Status[] = ['planned', 'watching', 'completed', 'on_hold', 'dropped'];

function pick<T extends string>(value: string | null, allowed: T[], fallback: T): T {
  return value != null && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

function num(value: string | null, min: number, max: number, fallback: number): number {
  const n = value != null ? Number(value) : Number.NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function bool(value: string | null, fallback: boolean): boolean {
  return value == null ? fallback : value === 'true';
}

async function loadSettings(): Promise<AppSettings> {
  const read = (key: string) => getSetting(key);
  const [
    theme, density, viewMode, closeBehavior, defaultCategory, defaultStatus, defaultSort, searchLimit,
    downloadCovers, proxyMode, proxyUrl, bangumiApiBase, vndbApiBase, autoBackup, backupCount,
    backgroundImage,
  ] = await Promise.all([
    read(SETTING_KEYS.theme),
    read(SETTING_KEYS.density),
    read(SETTING_KEYS.viewMode),
    read(SETTING_KEYS.closeBehavior),
    read(SETTING_KEYS.defaultCategory),
    read(SETTING_KEYS.defaultStatus),
    read(SETTING_KEYS.defaultSort),
    read(SETTING_KEYS.searchLimit),
    read(SETTING_KEYS.downloadCovers),
    read(SETTING_KEYS.proxyMode),
    read(SETTING_KEYS.proxyUrl),
    read(SETTING_KEYS.bangumiApiBase),
    read(SETTING_KEYS.vndbApiBase),
    read(SETTING_KEYS.autoBackup),
    read(SETTING_KEYS.backupCount),
    read(SETTING_KEYS.backgroundImage),
  ]);
  const bootstrapDataDir = await invoke<string>('get_bootstrap_data_dir');
  return {
    dataDir: bootstrapDataDir.trim(),
    backgroundImage: backgroundImage ?? DEFAULT_SETTINGS.backgroundImage,
    theme: pick(theme, THEMES, DEFAULT_SETTINGS.theme),
    density: pick(density, DENSITIES, DEFAULT_SETTINGS.density),
    viewMode: pick(viewMode, VIEW_MODES, DEFAULT_SETTINGS.viewMode),
    closeBehavior: pick(closeBehavior, CLOSE_BEHAVIORS, DEFAULT_SETTINGS.closeBehavior),
    defaultCategory: pick(defaultCategory, CATEGORIES, DEFAULT_SETTINGS.defaultCategory),
    defaultStatus: pick(defaultStatus, STATUSES, DEFAULT_SETTINGS.defaultStatus),
    defaultSort: pick(defaultSort, SORTS, DEFAULT_SETTINGS.defaultSort),
    searchLimit: num(searchLimit, 10, 50, DEFAULT_SETTINGS.searchLimit),
    downloadCovers: bool(downloadCovers, DEFAULT_SETTINGS.downloadCovers),
    proxyMode: pick(proxyMode, PROXY_MODES, DEFAULT_SETTINGS.proxyMode),
    proxyUrl: proxyUrl ?? DEFAULT_SETTINGS.proxyUrl,
    bangumiApiBase: bangumiApiBase || DEFAULT_SETTINGS.bangumiApiBase,
    vndbApiBase: vndbApiBase || DEFAULT_SETTINGS.vndbApiBase,
    autoBackup: bool(autoBackup, DEFAULT_SETTINGS.autoBackup),
    backupCount: num(backupCount, 0, 20, DEFAULT_SETTINGS.backupCount),
  };
}

export async function saveSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
  const keyName = SETTING_KEYS[key];
  if (!keyName) return;
  await setSetting(keyName, String(value));
}

interface SettingsContextValue {
  settings: AppSettings;
  loaded: boolean;
  update: (patch: Partial<AppSettings>) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  update: async () => {},
});

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await loadSettings();
      if (!cancelled) {
        setSettings(s);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = async (patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    for (const entry of Object.entries(patch) as Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>) {
      if (entry[0] === 'dataDir') continue;
      await saveSetting(entry[0], entry[1]);
    }
  };

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', settings.theme);
    root.setAttribute('data-density', settings.density);
  }, [settings.theme, settings.density]);

  useEffect(() => {
    // 始终把当前数据目录加入资源白名单（自定义目录或默认的程序目录/data）
    void allowAssetDir(settings.dataDir).catch(() => {
      // 白名单添加失败不阻塞使用
    });
  }, [settings.dataDir]);

  return <SettingsContext.Provider value={{ settings, loaded, update }}>{children}</SettingsContext.Provider>;
}