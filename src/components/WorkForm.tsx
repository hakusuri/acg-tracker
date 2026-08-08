import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import GlassModal from './GlassModal';
import { deleteCoverFile, saveCover, toAssetUrl } from '../lib/api';
import { CATEGORIES, CATEGORY_LABELS, SEASONS, SEASON_LABELS, STATUSES, STATUS_LABELS } from '../lib/constants';
import { insertWork, updateWork } from '../lib/db';
import { useSettings } from '../lib/settings';
import type { Category, LinkItem, Season, Status, Work, WorkInput } from '../types';

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
}

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
      }
      setForm(base);
    }
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, work, prefill]);

  const set = <K extends keyof WorkInput>(key: K, value: WorkInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const setInt = (key: 'year' | 'total_count' | 'current_count') => (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    set(key, v === '' ? null : parseInt(v, 10));
  };

  const setRating = (key: 'rating' | 'my_rating') => (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    const n = v === '' ? null : Math.min(10, Math.max(0, parseFloat(v)));
    set(key, Number.isNaN(n as number) ? null : n);
  };

  const clearCover = async () => {
    const path = form.cover_path;
    set('cover_path', '');
    // 本地缓存封面：同步删除文件（在线地址 cover_url 保留）
    if (path && !/^https?:\/\//i.test(path)) {
      try {
        await deleteCoverFile(path, settings.dataDir);
      } catch {
        // 删除失败不阻塞清除
      }
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
    } catch (e) {
      setError(`封面保存失败：${String(e)}`);
    } finally {
      setCoverBusy(false);
    }
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
        tags: form.tags.trim(),
        cover_url: form.cover_url || (/^https?:\/\//i.test(form.cover_path) ? form.cover_path : ''),
        links: JSON.stringify(parseLinks(form.links)),
      };
      let id = work?.id ?? 0;
      if (work) {
        await updateWork(work.id, payload);
      } else {
        id = await insertWork(payload);
      }
      onSaved(id);
    } catch (e) {
      setError(`保存失败：${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const isAnime = form.category === 'anime';
  const coverUrl = form.cover_path && !/^https?:\/\//i.test(form.cover_path) ? toAssetUrl(form.cover_path) : form.cover_path;
  const progressHint: Record<string, string> = {
    anime: '已看集数 / 总集数',
    manga: '已读卷数 / 总卷数',
    light_novel: '已读卷数 / 总卷数',
    galgame: '已完成路线 / 总路线数',
  };

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
              <option key={s} value={s}>{SEASON_LABELS[s]}</option>
            ))}
          </select>
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
                value={/^https?:\/\//i.test(form.cover_path) ? form.cover_path : ''}
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