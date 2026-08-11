import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import GlassModal from './GlassModal';
import { deleteCoverFile, saveCover, toAssetUrl } from '../lib/api';
import { CATEGORIES, CATEGORY_LABELS, SEASONS, SEASON_LABELS, STATUSES, STATUS_LABELS } from '../lib/constants';
import { insertWork, updateWork, upsertBySourceId } from '../lib/db';
import { useSettings } from '../lib/settings';
import type { Category, LinkItem, Season, Status, Work, WorkFormPrefill, WorkInput } from '../types';
export type { WorkFormPrefill };


interface Props {
  open: boolean;
  work?: Work | null;
  prefill?: WorkFormPrefill;
  onClose: () => void;
  onSaved: (id: number) => void;
}

function emptyForm(defaults: { category: Category; status: Status }): WorkInput {
  return {
    title: '',
    category: defaults.category,
    year: null,
    season: null,
    status: defaults.status,
    total_count: null,
    current_count: null,
    rating: null,
    my_rating: null,
    synopsis: '',
    tags: '',
    notes: '',
    cover_path: '',
    cover_url: '',
    links: '',
    source: 'manual',
    start_date: null,
    end_date: null,
    game_path: '',
    bangumi_id: null,
    vndb_id: '',
    mal_id: null,
    anilist_id: null,
  };
}

function parseLinks(text: string): LinkItem[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const comma = l.indexOf(',');
      if (comma > 0) return { label: l.slice(0, comma).trim(), url: l.slice(comma + 1).trim() };
      return { label: '链接', url: l };
    })
    .filter((l) => /^https?:\/\//i.test(l.url));
}

function formatLinks(raw: string): string {
  if (!raw) return '';
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return '';
    return arr
      .filter((l: LinkItem) => l && l.url)
      .map((l: LinkItem) => `${l.label || '链接'}, ${l.url}`)
      .join('\n');
  } catch {
    return raw;
  }
}

export default function WorkForm({ open, work, prefill, onClose, onSaved }: Props) {
  const { settings } = useSettings();
  const [form, setForm] = useState<WorkInput>(() => emptyForm({ category: settings.defaultCategory, status: settings.defaultStatus }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [pendingDeletePaths, setPendingDeletePaths] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    if (work) {
      setForm({
        title: work.title,
        category: work.category,
        year: work.year,
        season: work.season,
        status: work.status,
        total_count: work.total_count,
        current_count: work.current_count,
        rating: work.rating,
        my_rating: work.my_rating,
        synopsis: work.synopsis,
        tags: work.tags,
        notes: work.notes,
        cover_path: work.cover_path,
        cover_url: work.cover_url ?? (/^https?:\/\//i.test(work.cover_path) ? work.cover_path : ''),
        links: formatLinks(work.links),
        source: work.source,
        start_date: work.start_date ?? null,
        end_date: work.end_date ?? null,
        game_path: work.game_path ?? '',
        bangumi_id: work.bangumi_id ?? null,
        vndb_id: work.vndb_id ?? '',
        mal_id: work.mal_id ?? null,
        anilist_id: work.anilist_id ?? null,
      });
    } else {
      const base = emptyForm({ category: settings.defaultCategory, status: settings.defaultStatus });
      if (prefill) {
        base.title = prefill.title ?? '';
        if (prefill.category) base.category = prefill.category;
        base.year = prefill.year ?? null;
        base.season = prefill.season ?? null;
        base.synopsis = prefill.synopsis ?? '';
        base.cover_path = prefill.cover_path ?? '';
        base.cover_url = prefill.cover_url ?? (/^https?:\/\//i.test(prefill.cover_path ?? '') ? prefill.cover_path : '');
        base.rating = prefill.rating ?? null;
        base.total_count = prefill.total_count ?? null;
        base.tags = prefill.tags ?? '';
        base.links = formatLinks(prefill.links ?? '');
        base.source = prefill.source ?? 'manual';
        base.start_date = prefill.start_date ?? null;
        base.end_date = prefill.end_date ?? null;
        base.game_path = prefill.game_path ?? '';
        base.bangumi_id = prefill.bangumi_id ?? null;
        base.vndb_id = prefill.vndb_id ?? '';
        base.mal_id = prefill.mal_id ?? null;
        base.anilist_id = prefill.anilist_id ?? null;
      }
      setForm(base);
    }
    setError('');
    setPendingDeletePaths([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, work, prefill]);

  const set = <K extends keyof WorkInput>(key: K, value: WorkInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const setInt = (key: 'year' | 'total_count' | 'current_count') => (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    set(key, v === '' ? null : parseInt(v, 10));
  };

  const setDate = (key: 'start_date' | 'end_date') => (e: ChangeEvent<HTMLInputElement>) => {
    set(key, e.target.value || null);
  };

  const setRating = (key: 'rating' | 'my_rating') => (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    const n = v === '' ? null : Math.min(10, Math.max(0, parseFloat(v)));
    set(key, Number.isNaN(n as number) ? null : n);
  };

  const clearCover = () => {
    const path = form.cover_path;
    set('cover_path', '');
    // 仅记录待删除的本地文件，保存时才真正删除；取消则保留
    if (path && !/^https?:\/\//i.test(path)) {
      setPendingDeletePaths((list) => (list.includes(path) ? list : [...list, path]));
    }
  };

  const pickCover = async () => {
    const file = await openDialog({
      multiple: false,
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'] }],
    });
    if (typeof file !== 'string') return;
    setCoverBusy(true);
    setError('');
    try {
      const saved = await saveCover(file, settings.dataDir);
      set('cover_path', saved);
      set('cover_url', '');
      setPendingDeletePaths((list) => list.filter((p) => p !== saved));
    } catch (e) {
      setError(`封面保存失败：${String(e)}`);
    } finally {
      setCoverBusy(false);
    }
  };

  const pickGamePath = async () => {
    const file = await openDialog({
      multiple: false,
      filters: [
        { name: '程序', extensions: ['exe', 'bat', 'cmd', 'lnk'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (typeof file !== 'string') return;
    set('game_path', file);
  };

  const save = async () => {
    const title = form.title.trim();
    if (!title) {
      setError('标题不能为空');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload: WorkInput = {
        ...form,
        title,
        season: form.category === 'anime' ? form.season : null,
        tags: (form.tags ?? '').trim(),
        cover_url: form.cover_url || (/^https?:\/\//i.test(form.cover_path ?? '') ? form.cover_path : ''),
        links: JSON.stringify(parseLinks(form.links ?? '')),
      };
      let id = work?.id ?? 0;
      if (work) {
        await updateWork(work.id, payload);
      } else if (payload.bangumi_id || payload.vndb_id || payload.mal_id || payload.anilist_id) {
        const res = await upsertBySourceId(payload);
        id = res.id;
      } else {
        id = await insertWork(payload);
      }
      // 保存成功后再删除被清除的本地封面文件（取消则文件保留）
      for (const p of pendingDeletePaths) {
        if (p === payload.cover_path) continue;
        try {
          await deleteCoverFile(p, settings.dataDir);
        } catch {
          // 单个删除失败忽略
        }
      }
      onSaved(id);
    } catch (e) {
      setError(`保存失败：${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const isAnime = form.category === 'anime';
  const isGalgame = form.category === 'galgame';
  const coverUrl =
    form.cover_path && !/^https?:\/\//i.test(form.cover_path ?? '')
      ? toAssetUrl(form.cover_path)
      : (form.cover_path || (/^https?:\/\//i.test(form.cover_url ?? '') ? form.cover_url ?? '' : ''));
  const progressHint: Record<string, string> = {
    anime: '已看集数 / 总集数',
    manga: '已读卷数 / 总卷数',
    light_novel: '已读卷数 / 总卷数',
    galgame: '已完成路线 / 总路线数',
  };
  const sourceIds = [
    form.bangumi_id ? `Bangumi: ${form.bangumi_id}` : '',
    form.vndb_id ? `VNDB: ${form.vndb_id}` : '',
    form.mal_id ? `MAL: ${form.mal_id}` : '',
    form.anilist_id ? `AniList: ${form.anilist_id}` : '',
  ].filter(Boolean);

  return (
    <GlassModal open={open} onClose={onClose} title={work ? '编辑作品' : '添加作品'} wide>
      <div className="form-grid">
        <div className="field full">
          <label>标题 *</label>
          <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="作品名称" />
        </div>

        <div className="field">
          <label>类别</label>
          <select
            className="select"
            value={form.category}
            onChange={(e) => {
              const category = e.target.value as Category;
              setForm((f) => ({ ...f, category, season: category === 'anime' ? f.season : null }));
            }}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>状态</label>
          <select className="select" value={form.status} onChange={(e) => set('status', e.target.value as Status)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>年份</label>
          <input className="input" type="number" min={1900} max={2100} value={form.year ?? ''} onChange={setInt('year')} placeholder="如 2024" />
        </div>

        <div className="field">
          <label>季度（仅番剧）</label>
          <select
            className="select"
            value={form.season ?? ''}
            disabled={!isAnime}
            onChange={(e) => set('season', (e.target.value || null) as Season | null)}
          >
            <option value="">未知</option>
            {SEASONS.map((s) => (
              <option key={s} value={s}>{SEASON_LABELS[s]}季</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>开始日期</label>
          <input className="input" type="date" value={form.start_date ?? ''} onChange={setDate('start_date')} />
        </div>

        <div className="field">
          <label>结束日期</label>
          <input className="input" type="date" value={form.end_date ?? ''} onChange={setDate('end_date')} />
        </div>

        <div className="field">
          <label>{progressHint[form.category].split(' / ')[1]}</label>
          <input className="input" type="number" min={0} value={form.total_count ?? ''} onChange={setInt('total_count')} placeholder="如 24" />
        </div>

        <div className="field">
          <label>{progressHint[form.category].split(' / ')[0]}</label>
          <input className="input" type="number" min={0} value={form.current_count ?? ''} onChange={setInt('current_count')} placeholder="如 12" />
        </div>

        <div className="field">
          <label>作品评分（0-10）</label>
          <input className="input" type="number" min={0} max={10} step={0.5} value={form.rating ?? ''} onChange={setRating('rating')} placeholder="如 8.5" />
        </div>

        <div className="field">
          <label>我的评分（0-10）</label>
          <input className="input" type="number" min={0} max={10} step={0.5} value={form.my_rating ?? ''} onChange={setRating('my_rating')} placeholder="可稍后填写" />
        </div>

        {isGalgame && (
          <div className="field full">
            <label>游戏路径</label>
            <div className="game-path-picker">
              <input
                className="input"
                value={form.game_path ?? ''}
                onChange={(e) => set('game_path', e.target.value)}
                placeholder="如 D:\Games\mygame\Game.exe"
              />
              <button className="btn ghost" type="button" onClick={() => void pickGamePath()}>选择文件</button>
            </div>
          </div>
        )}

        {sourceIds.length > 0 && (
          <div className="field full">
            <label>来源 ID（只读）</label>
            <div className="source-id-row">{sourceIds.join(' · ')}</div>
          </div>
        )}

        <div className="field full">
          <label>封面</label>
          <div className="cover-picker">
            {coverUrl ? (
              <img className="cover-picker-img" src={coverUrl} alt="封面预览" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
            ) : (
              <div className="cover-picker-img cover-picker-empty">无封面</div>
            )}
            <div className="cover-picker-actions">
              <button className="btn ghost" type="button" onClick={pickCover} disabled={coverBusy}>
                {coverBusy ? '保存中…' : '选择本地图片'}
              </button>
              <input
                className="input"
                value={
                  /^https?:\/\//i.test(form.cover_path ?? '')
                    ? form.cover_path ?? ''
                    : /^https?:\/\//i.test(form.cover_url ?? '')
                      ? form.cover_url ?? ''
                      : ''
                }
                onChange={(e) => {
                  const v = e.target.value.trim();
                  set('cover_path', v);
                  set('cover_url', v);
                }}
                placeholder="或粘贴图片 URL"
              />
              {form.cover_path && (
                <button className="btn ghost" type="button" onClick={() => void clearCover()}>清除</button>
              )}
              {form.cover_path && !/^https?:\/\//i.test(form.cover_path ?? '') && (
                <div className="cover-path-info">
                  <span className="cover-path-label">本地缓存</span>
                  <span className="cover-path-text" title={form.cover_path}>{form.cover_path}</span>
                </div>
              )}
              {form.cover_url && form.cover_url !== form.cover_path && (
                <div className="cover-path-info">
                  <span className="cover-path-label">在线地址</span>
                  <span className="cover-path-text" title={form.cover_url}>{form.cover_url}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="field full">
          <label>简介</label>
          <textarea className="textarea" rows={4} value={form.synopsis} onChange={(e) => set('synopsis', e.target.value)} placeholder="作品简介" />
        </div>

        <div className="field full">
          <label>标签</label>
          <input className="input" value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="用逗号分隔，如：科幻, 悬疑" />
        </div>

        <div className="field full">
          <label>笔记</label>
          <textarea className="textarea" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="个人感想、备注…" />
        </div>

        <div className="field full">
          <label>外部链接（每行一条：名称, https://…）</label>
          <textarea
            className="textarea"
            rows={3}
            value={form.links}
            onChange={(e) => set('links', e.target.value)}
            placeholder={'Bangumi, https://bgm.tv/subject/1\nVNDB, https://vndb.org/v1'}
          />
        </div>
      </div>

      {error && <div className="msg msg-error">{error}</div>}

      <div className="modal-foot">
        <button className="btn ghost" type="button" onClick={onClose} disabled={saving}>取消</button>
        <button className="btn primary" type="button" onClick={save} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </GlassModal>
  );
}