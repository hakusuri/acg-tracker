import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { BackupInfo, BangumiItem, UpdateCheck, VndbItem } from '../types';

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
export const deleteBackground = (path: string, dataDir: string) => invoke<void>('delete_background', { path, dataDir });
export const deleteCoverFile = (path: string, dataDir: string) => invoke<void>('delete_cover_file', { path, dataDir });

export const saveCover = (sourcePath: string, dataDir: string) =>
  invoke<string>('save_cover', { sourcePath, dataDir });

export const getDataDir = () => invoke<string>('get_data_dir');
export const openDataDir = (dataDir: string) => invoke<void>('open_data_dir', { dataDir });
export const backupDatabase = (keep: number, dataDir: string) => invoke<string>('backup_database', { keep, dataDir });
export const listBackups = (dataDir: string) => invoke<BackupInfo[]>('list_backups', { dataDir });
export const restoreBackup = (backupPath: string, dataDir: string) => invoke<void>('restore_backup', { backupPath, dataDir });
export const deleteAllCovers = (dataDir: string) => invoke<number>('delete_all_covers', { dataDir });

export const allowAssetDir = (dir: string) => invoke<void>('allow_asset_dir', { dir });
export const migrateLegacyData = () => invoke<void>('migrate_legacy_data');
export const pathExists = (path: string) => invoke<boolean>('path_exists', { path });
export const checkUpdate = (currentVersion: string, feedUrl: string) => invoke<UpdateCheck>('check_update', { currentVersion, feedUrl });
export const getBootstrapDataDir = () => invoke<string>('get_bootstrap_data_dir');
export const setBootstrapDataDir = (path: string) => invoke<void>('set_bootstrap_data_dir', { path });
export const ensureDataDir = (dir: string) => invoke<void>('ensure_data_dir', { dir });
export const migrateDataDir = (newDir: string) => invoke<string>('migrate_data_dir', { newDir });

export const toAssetUrl = (path: string) => convertFileSrc(path);
export const openExternal = (url: string) => openUrl(url);