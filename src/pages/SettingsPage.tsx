import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import GlassModal from '../components/GlassModal';
import { backupDatabase, deleteBackground, getDataDir, migrateDataDir, openDataDir, saveBackground, setBootstrapDataDir, toAssetUrl } from '../lib/api';
import { CATEGORIES, CATEGORY_LABELS, STATUSES, STATUS_LABELS } from '../lib/constants';
import { clearWorks, getSetting, insertWork, listWorks, reloadDatabase, setSetting } from '../lib/db';
import { normalizeTitle } from '../lib/importers';
import { useSettings } from '../lib/settings';
import type { AppSettings, Density, ProxyMode, SortKey, ThemeMode } from '../lib/settings';
import type { Work } from '../types';
import pkg from '../../package.json';

const SORT_LABELS: Record<SortKey, string> = {
  created_desc: '最新添加',
  created_asc: '最早添加',
  year_desc: '年份新→旧',
  year_asc: '年份旧→新',
  rating_desc: '评分高→低',
  title: '标题排序',
};

const THEME_LABELS: Record<ThemeMode, string> = { auto: '跟随系统', light: '浅色', dark: '深色' };
const DENSITY_LABELS: Record<Density, string> = { comfortable: '舒适', compact: '紧凑' };
const PROXY_LABELS: Record<ProxyMode, string> = { auto: '跟随系统', direct: '直连', custom: '自定义' };

function SettingRow({ label, desc, children }: { label: string; desc?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-info">
        <div className="setting-label">{label}</div>
        {desc && <div className="setting-desc">{desc}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`toggle ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      <span className="toggle-knob" />
    </button>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return '尚未备份';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false });
}

export default function SettingsPage() {
  const { settings, update } = useSettings();
  const [dataDir, setDataDir] = useState('');
  const [totalWorks, setTotalWorks] = useState(0);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [dir, works, lb] = await Promise.all([getDataDir(), listWorks(), getSetting('last_backup_at')]);
      setDataDir(dir);
      setTotalWorks(works.length);
      setLastBackup(lb);
    } catch (e) {
      console.error('加载设置页信息失败', e);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const patch = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    void update({ [key]: value });
  };

  const exportData = async () => {
    setBusy(true);
    setMessage('');
    try {
      const works = await listWorks();
      const payload = { app: 'acg-tracker', version: 1, exportedAt: new Date().toISOString(), works };
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const path = await save({
        defaultPath: `acg-tracker-backup-${stamp}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (typeof path === 'string') {
        await writeTextFile(path, JSON.stringify(payload, null, 2));
        setMessage(`已导出 ${works.length} 条作品到 ${path}`);
      }
    } catch (e) {
      setMessage(`导出失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const importData = async () => {
    setBusy(true);
    setMessage('');
    try {
      const path = await open({ multiple: false, filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (typeof path !== 'string') return;
      const text = await readTextFile(path);
      const data = JSON.parse(text) as { works?: Work[] };
      if (!Array.isArray(data.works)) {
        setMessage('文件格式不正确：缺少 works 数组');
        return;
      }
      const existing = await listWorks();
      const normalized = new Set(existing.map((w) => `${normalizeTitle(w.title)}|${w.year ?? ''}`));
      let imported = 0;
      let skipped = 0;
      for (const w of data.works) {
        if (!w || typeof w.title !== 'string' || !w.title.trim()) continue;
        const key = `${normalizeTitle(w.title)}|${w.year ?? ''}`;
        if (normalized.has(key)) {
          skipped++;
          continue;
        }
        normalized.add(key);
        await insertWork({
          title: w.title.trim(),
          category: w.category ?? 'anime',
          year: w.year ?? null,
          season: w.category === 'anime' ? (w.season ?? null) : null,
          status: w.status ?? 'planned',
          total_count: w.total_count ?? null,
          current_count: w.current_count ?? null,
          rating: w.rating ?? null,
          my_rating: w.my_rating ?? null,
          synopsis: w.synopsis ?? '',
          tags: w.tags ?? '',
          notes: w.notes ?? '',
          cover_path: w.cover_path ?? '',
          links: w.links ?? '',
          source: w.source ?? 'manual',
        });
        imported++;
      }
      setMessage(`导入完成：新增 ${imported} 条，跳过重复 ${skipped} 条`);
      await refresh();
    } catch (e) {
      setMessage(`导入失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const doClear = async () => {
    setConfirmClear(false);
    setBusy(true);
    try {
      await clearWorks();
      setMessage('已清空全部作品数据');
      await refresh();
    } catch (e) {
      setMessage(`清空失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const pickBackground = async () => {
    const file = await open({
      multiple: false,
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'] }],
    });
    if (typeof file !== 'string') return;
    setBusy(true);
    setMessage('');
    try {
      const saved = await saveBackground(file, settings.dataDir);
      await update({ backgroundImage: saved });
      setMessage('背景图片已更新');
    } catch (e) {
      setMessage(`背景图片设置失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const clearBackground = async () => {
    setBusy(true);
    setMessage('');
    try {
      if (settings.backgroundImage) {
        await deleteBackground(settings.backgroundImage, settings.dataDir);
      }
    } catch (e) {
      console.error('删除背景文件失败', e);
    }
    await update({ backgroundImage: '' });
    setMessage('已清除背景图片（本地文件已删除）');
    setBusy(false);
  };

  const pickDataDir = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== 'string' || !dir.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      await migrateDataDir(dir);
      await setBootstrapDataDir(dir);
      await reloadDatabase();
      await update({ dataDir: dir });
      await refresh();
      setMessage(`数据目录已切换到：${dir}`);
    } catch (e) {
      setMessage(`切换数据目录失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const resetDataDir = async () => {
    setBusy(true);
    setMessage('');
    try {
      await setBootstrapDataDir('');
      await reloadDatabase();
      await update({ dataDir: '' });
      await refresh();
      setMessage('已恢复默认数据目录（原自定义目录中的文件仍保留）');
    } catch (e) {
      setMessage(`恢复默认目录失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const doBackup = async () => {
    setBusy(true);
    setMessage('');
    try {
      const path = await backupDatabase(Math.max(1, settings.backupCount || 1), settings.dataDir);
      const now = new Date().toISOString();
      await setSetting('last_backup_at', now);
      setLastBackup(now);
      setMessage(`备份完成：${path}`);
    } catch (e) {
      setMessage(`备份失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>设置</h1>
          <p className="page-sub">应用外观、默认行为、网络与数据管理</p>
        </div>
      </div>

      {message && <div className="msg">{message}</div>}

      <div className="settings-grid">
        <section className="glass settings-section">
          <h2>外观</h2>
          <SettingRow label="主题" desc="深色/浅色或跟随系统">
            <select className="select select-sm" value={settings.theme} onChange={(e) => patch('theme', e.target.value as ThemeMode)}>
              {(Object.keys(THEME_LABELS) as ThemeMode[]).map((k) => (
                <option key={k} value={k}>{THEME_LABELS[k]}</option>
              ))}
            </select>
          </SettingRow>
          <SettingRow label="卡片密度" desc="首页作品卡片的显示密度">
            <select className="select select-sm" value={settings.density} onChange={(e) => patch('density', e.target.value as Density)}>
              {(Object.keys(DENSITY_LABELS) as Density[]).map((k) => (
                <option key={k} value={k}>{DENSITY_LABELS[k]}</option>
              ))}
            </select>
          </SettingRow>
          <SettingRow label="背景图片" desc="自定义应用背景（建议深色系图片，保证文字可读）">
            <div className="setting-btns">
              <button className="btn ghost" type="button" onClick={() => void pickBackground()} disabled={busy}>
                选择图片
              </button>
              {settings.backgroundImage && (
                <button className="btn ghost" type="button" onClick={() => void clearBackground()} disabled={busy}>
                  清除
                </button>
              )}
            </div>
          </SettingRow>
          {settings.backgroundImage && (
            <div className="bg-preview-row">
              <img
                className="bg-preview"
                src={/^https?:\/\//i.test(settings.backgroundImage) ? settings.backgroundImage : toAssetUrl(settings.backgroundImage)}
                alt="背景预览"
                onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
              />
            </div>
          )}
        </section>

        <section className="glass settings-section">
          <h2>默认行为</h2>
          <SettingRow label="默认类别" desc="添加作品时预选的类别">
            <select className="select select-sm" value={settings.defaultCategory} onChange={(e) => patch('defaultCategory', e.target.value as AppSettings['defaultCategory'])}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </SettingRow>
          <SettingRow label="默认状态" desc="新作品默认的观看/阅读状态">
            <select className="select select-sm" value={settings.defaultStatus} onChange={(e) => patch('defaultStatus', e.target.value as AppSettings['defaultStatus'])}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </SettingRow>
          <SettingRow label="首页默认排序" desc="打开首页时的初始排序方式">
            <select className="select select-sm" value={settings.defaultSort} onChange={(e) => patch('defaultSort', e.target.value as SortKey)}>
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <option key={k} value={k}>{SORT_LABELS[k]}</option>
              ))}
            </select>
          </SettingRow>
        </section>

        <section className="glass settings-section">
          <h2>导入</h2>
          <SettingRow label="API 搜索数量" desc="每次搜索最多返回的结果数（10-50）">
            <input
              className="input input-sm"
              type="number"
              min={10}
              max={50}
              value={settings.searchLimit}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isNaN(n)) patch('searchLimit', Math.min(50, Math.max(10, n)));
              }}
            />
          </SettingRow>
          <SettingRow label="自动下载封面" desc="API 导入时把封面保存到本地（更稳定）">
            <Toggle checked={settings.downloadCovers} onChange={(v) => patch('downloadCovers', v)} />
          </SettingRow>
        </section>

        <section className="glass settings-section">
          <h2>网络</h2>
          <SettingRow label="代理模式" desc="auto 使用系统代理，失败自动回退直连">
            <select className="select select-sm" value={settings.proxyMode} onChange={(e) => patch('proxyMode', e.target.value as ProxyMode)}>
              {(Object.keys(PROXY_LABELS) as ProxyMode[]).map((k) => (
                <option key={k} value={k}>{PROXY_LABELS[k]}</option>
              ))}
            </select>
          </SettingRow>
          {settings.proxyMode === 'custom' && (
            <SettingRow label="代理地址" desc="例如 http://127.0.0.1:7890">
              <input className="input input-sm" value={settings.proxyUrl} placeholder="http://127.0.0.1:7890" onChange={(e) => patch('proxyUrl', e.target.value)} />
            </SettingRow>
          )}
          <SettingRow label="Bangumi API 地址" desc="网络受限时可填镜像地址">
            <input className="input input-sm" value={settings.bangumiApiBase} onChange={(e) => patch('bangumiApiBase', e.target.value)} />
          </SettingRow>
          <SettingRow label="VNDB API 地址" desc="网络受限时可填镜像地址">
            <input className="input input-sm" value={settings.vndbApiBase} onChange={(e) => patch('vndbApiBase', e.target.value)} />
          </SettingRow>
        </section>

        <section className="glass settings-section">
          <h2>数据管理</h2>
          <SettingRow label="自动备份" desc="启动应用时自动备份数据库">
            <Toggle checked={settings.autoBackup} onChange={(v) => patch('autoBackup', v)} />
          </SettingRow>
          <SettingRow label="保留备份数量" desc="自动/手动备份最多保留的份数">
            <input
              className="input input-sm"
              type="number"
              min={1}
              max={20}
              value={settings.backupCount}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isNaN(n)) patch('backupCount', Math.min(20, Math.max(1, n)));
              }}
            />
          </SettingRow>
          <SettingRow label="数据目录" desc={settings.dataDir || dataDir || '加载中…'}>
            <div className="setting-btns">
              <button className="btn ghost" type="button" onClick={() => void pickDataDir()} disabled={busy}>
                选择目录
              </button>
              <button className="btn ghost" type="button" onClick={() => void openDataDir(settings.dataDir)} disabled={!dataDir}>
                打开
              </button>
              {settings.dataDir && (
                <button className="btn ghost" type="button" onClick={() => void resetDataDir()} disabled={busy}>
                  恢复默认
                </button>
              )}
            </div>
          </SettingRow>
          <SettingRow label="目录说明" desc="数据库（acg.db）、封面（covers）、备份（backups）都会存放在该目录；切换后自动迁移已有数据。">
            <span className="setting-static">{settings.dataDir ? '自定义' : '默认'}</span>
          </SettingRow>
          <SettingRow label="备份" desc={`上次备份：${formatTime(lastBackup)}`}>
            <div className="setting-btns">
              <button className="btn ghost" type="button" onClick={() => void doBackup()} disabled={busy}>
                {busy ? '处理中…' : '立即备份'}
              </button>
            </div>
          </SettingRow>
          <SettingRow label="导出数据" desc="将全部作品导出为 JSON 备份文件">
            <button className="btn ghost" type="button" onClick={() => void exportData()} disabled={busy}>
              {busy ? '处理中…' : '导出 JSON'}
            </button>
          </SettingRow>
          <SettingRow label="导入数据" desc="从 JSON 备份恢复/合并（自动跳过重复）">
            <button className="btn ghost" type="button" onClick={() => void importData()} disabled={busy}>
              {busy ? '处理中…' : '导入 JSON'}
            </button>
          </SettingRow>
          <SettingRow label="清空数据" desc="删除全部作品记录（不可恢复）">
            <button className="btn danger" type="button" onClick={() => setConfirmClear(true)} disabled={busy}>
              清空全部数据
            </button>
          </SettingRow>
        </section>

        <section className="glass settings-section">
          <h2>关于</h2>
          <SettingRow label="版本" desc="ACG 记录 - 个人 ACG 作品管理">
            <span className="setting-static">v{pkg.version}</span>
          </SettingRow>
          <SettingRow label="作品数量" desc="当前库中的作品总数">
            <span className="setting-static">{totalWorks} 部</span>
          </SettingRow>
          <SettingRow label="技术栈" desc="Tauri 2 · React 18 · TypeScript · SQLite">
            <span className="setting-static">本地单机</span>
          </SettingRow>
        </section>
      </div>

      <GlassModal open={confirmClear} onClose={() => setConfirmClear(false)} title="清空全部数据">
        <p className="confirm-text">确定要删除全部作品记录吗？此操作不可恢复，建议先导出备份。</p>
        <div className="modal-foot">
          <button className="btn ghost" type="button" onClick={() => setConfirmClear(false)}>取消</button>
          <button className="btn danger" type="button" onClick={() => void doClear()}>确认清空</button>
        </div>
      </GlassModal>
    </div>
  );
}