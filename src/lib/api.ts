import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { BangumiItem, VndbItem } from '../types';

export interface ApiRequestConfig {
  limit: number;
  apiBase: string;
  proxyMode: string;
  proxyUrl: string;
}

export interface CoverDownloadConfig {
  proxyMode: string;
  proxyUrl: string;
  dataDir: string;
}

export const searchBangumi = (keyword: string, types: number[], cfg: ApiRequestConfig) =>
  invoke<BangumiItem[]>('search_bangumi', {
    keyword,
    types,
    limit: cfg.limit,
    apiBase: cfg.apiBase,
    proxyMode: cfg.proxyMode,
    proxyUrl: cfg.proxyUrl,
  });

export const searchVndb = (keyword: string, cfg: ApiRequestConfig) =>
  invoke<VndbItem[]>('search_vndb', {
    keyword,
    limit: cfg.limit,
    apiBase: cfg.apiBase,
    proxyMode: cfg.proxyMode,
    proxyUrl: cfg.proxyUrl,
  });

export const downloadCover = (url: string, cfg: CoverDownloadConfig) =>
  invoke<string>('download_cover', {
    url,
    proxyMode: cfg.proxyMode,
    proxyUrl: cfg.proxyUrl,
    dataDir: cfg.dataDir,
  });

export const saveBackground = (sourcePath: string, dataDir: string) => invoke<string>('save_background', { sourcePath, dataDir });

export const saveCover = (sourcePath: string, dataDir: string) =>
  invoke<string>('save_cover', { sourcePath, dataDir });

export const getDataDir = () => invoke<string>('get_data_dir');
export const openDataDir = (dataDir: string) => invoke<void>('open_data_dir', { dataDir });
export const backupDatabase = (keep: number, dataDir: string) => invoke<string>('backup_database', { keep, dataDir });

export const allowAssetDir = (dir: string) => invoke<void>('allow_asset_dir', { dir });
export const getBootstrapDataDir = () => invoke<string>('get_bootstrap_data_dir');
export const setBootstrapDataDir = (path: string) => invoke<void>('set_bootstrap_data_dir', { path });
export const ensureDataDir = (dir: string) => invoke<void>('ensure_data_dir', { dir });
export const migrateDataDir = (newDir: string) => invoke<string>('migrate_data_dir', { newDir });

export const toAssetUrl = (path: string) => convertFileSrc(path);
export const openExternal = (url: string) => openUrl(url);