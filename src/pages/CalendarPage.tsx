import { useCallback, useEffect, useMemo, useState } from 'react';
import WorkForm from '../components/WorkForm';
import type { WorkFormPrefill } from '../components/WorkForm';
import { downloadCover, fetchBangumiCalendar, fetchBangumiSubject } from '../lib/api';
import type { ApiRequestConfig } from '../lib/api';
import { CATEGORY_LABELS } from '../lib/constants';
import { listWorks, onWorksChanged } from '../lib/db';
import { seasonFromDate } from '../lib/importers';
import { useSettings } from '../lib/settings';
import type { CalendarDay, CalendarItem, Category, Work } from '../types';

type ApiCategory = 'all' | Category;

const API_CATEGORIES: Array<{ key: ApiCategory; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'anime', label: '番剧' },
  { key: 'manga', label: '漫画' },
  { key: 'light_novel', label: '轻小说' },
  { key: 'galgame', label: 'Galgame' },
];

function btypeCategory(btype: number): Category {
  if (btype === 1) return 'manga';
  if (btype === 4) return 'galgame';
  return 'anime';
}

export default function CalendarPage() {
  const { settings } = useSettings();
  const [days, setDays] = useState<CalendarDay[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState<ApiCategory>('all');
  const [search, setSearch] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [works, setWorks] = useState<Work[]>([]);
  const [prefill, setPrefill] = useState<WorkFormPrefill | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const cfg = useMemo<ApiRequestConfig>(
    () => ({
      limit: settings.searchLimit,
      apiBase: settings.bangumiApiBase,
      proxyMode: settings.proxyMode,
      proxyUrl: settings.proxyUrl,
    }),
    [settings.searchLimit, settings.bangumiApiBase, settings.proxyMode, settings.proxyUrl],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [d, w] = await Promise.all([fetchBangumiCalendar(cfg), listWorks()]);
      setDays(d);
      setWorks(w);
      if (d.length === 0) setError('未获取到日历数据，请检查网络或代理设置');
    } catch (e) {
      setError(`日历加载失败：${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [cfg]);

  useEffect(() => {
    void load();
    return onWorksChanged(() => {
      void listWorks().then(setWorks).catch(() => undefined);
    });
  }, [load]);

  const myIds = useMemo(() => new Set(works.filter((w) => w.bangumi_id != null).map((w) => w.bangumi_id as number)), [works]);

  const shownDays = useMemo(() => {
    if (!days) return [];
    const kw = search.trim().toLowerCase();
    return days.map((d) => ({
      ...d,
      items: d.items.filter((it) => {
        if (category !== 'all' && btypeCategory(it.btype) !== category) return false;
        if (kw && !(it.nameCn || it.name).toLowerCase().includes(kw)) return false;
        if (onlyMine && !myIds.has(it.id)) return false;
        return true;
      }),
    }));
  }, [days, category, search, onlyMine, myIds]);

  const totalItems = shownDays.reduce((sum, d) => sum + d.items.length, 0);
  const myCount = works.filter((w) => w.bangumi_id != null && myIds.has(w.bangumi_id)).length;

  const addItem = async (item: CalendarItem) => {
    setBusy(true);
    setError('');
    try {
      const full = await fetchBangumiSubject(item.id, cfg);
      const btypeCat = btypeCategory(full.btype);
      const cat: Category =
        category === 'light_novel'
          ? 'light_novel'
          : category === 'manga'
            ? 'manga'
            : category === 'anime'
              ? 'anime'
              : category === 'galgame'
                ? 'galgame'
                : btypeCat;
      const year = full.date ? parseInt(full.date.slice(0, 4), 10) || null : null;
      let cover = full.image ?? '';
      if (cover && settings.downloadCovers) {
        try {
          cover = await downloadCover(cover, { proxyMode: settings.proxyMode, proxyUrl: settings.proxyUrl, dataDir: settings.dataDir });
        } catch {
          // 下载失败保留在线地址
        }
      }
      const totalCount =
        cat === 'anime' ? (full.totalEpisodes ?? full.eps ?? null) : (full.volumes ?? full.eps ?? null);
      setPrefill({
        title: full.nameCn || full.name,
        category: cat,
        year,
        season: cat === 'anime' ? seasonFromDate(full.date ?? '') : null,
        synopsis: full.summary,
        cover_path: cover,
        cover_url: full.image ?? '',
        rating: full.score,
        total_count: totalCount && totalCount > 0 ? totalCount : null,
        tags: full.tags.slice(0, 10).join(','),
        links: JSON.stringify([{ label: 'Bangumi', url: `https://bgm.tv/subject/${full.id}` }]),
        source: 'bangumi',
        bangumi_id: full.id,
        start_date: full.date ?? null,
      });
      setQuickOpen(true);
    } catch (e) {
      setError(`获取条目信息失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const todayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>追番日历</h1>
          <p className="page-sub">
            Bangumi 本周放送安排 {days ? `· 共 ${totalItems} 部` : ''}
            {myCount > 0 ? ` · 已收藏 ${myCount} 部` : ''}
          </p>
        </div>
        <button className="btn ghost" onClick={() => void load()} disabled={loading}>
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>

      <div className="filter-bar glass">
        <div className="filter-group">
          {API_CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`chip ${category === c.key ? 'active' : ''}`}
              onClick={() => setCategory(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="filter-group">
          <input
            className="input input-sm"
            placeholder="搜索标题…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="check-label">
            <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
            只看我的收藏
          </label>
        </div>
      </div>

      {error && <div className="msg msg-error">{error}</div>}

      {loading ? (
        <div className="loading">正在加载日历…</div>
      ) : shownDays.length === 0 ? (
        <div className="empty glass">
          <div className="empty-icon">📅</div>
          <h3>暂无日历数据</h3>
          <p>请检查网络连接或在设置中配置代理后重试</p>
        </div>
      ) : totalItems === 0 ? (
        <div className="empty glass">
          <div className="empty-icon">🔍</div>
          <h3>没有符合条件的条目</h3>
          <p>试试调整类别、搜索词或关闭「只看我的收藏」</p>
        </div>
      ) : (
        <div className="calendar-grid">
          {shownDays.map((d, idx) => (
            <div key={d.weekday} className={`cal-col glass ${idx === todayIdx ? 'cal-today' : ''}`}>
              <div className="cal-day-head">
                <span className="cal-day-label">周{d.cn || d.en || d.weekday}</span>
                {idx === todayIdx && <span className="cal-day-today">今天</span>}
                <span className="cal-day-count">{d.items.length}</span>
              </div>
              <div className="cal-items">
                {d.items.length === 0 ? (
                  <div className="cal-empty">暂无</div>
                ) : (
                  d.items.map((it) => {
                    const mine = myIds.has(it.id);
                    const cat = btypeCategory(it.btype);
                    return (
                      <div className="cal-item" key={it.id}>
                        {it.image ? (
                          <img
                            className="cal-thumb"
                            src={it.image}
                            alt=""
                            loading="lazy"
                            onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                          />
                        ) : (
                          <div className="cal-thumb cal-thumb-empty">{CATEGORY_LABELS[cat]}</div>
                        )}
                        <div className="cal-info">
                          <div className="cal-title" title={it.nameCn || it.name}>{it.nameCn || it.name}</div>
                          <div className="cal-sub">
                            <span>{it.date ? it.date.slice(5) : ''}</span>
                            {it.eps != null && <span>{it.eps} 集</span>}
                            {it.score != null && <span>★{it.score}</span>}
                          </div>
                        </div>
                        {mine ? (
                          <span className="cal-mine">已收藏</span>
                        ) : (
                          <button
                            type="button"
                            className="btn ghost btn-sm"
                            onClick={() => void addItem(it)}
                            disabled={busy}
                          >
                            添加
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <WorkForm
        open={quickOpen}
        prefill={prefill ?? undefined}
        onClose={() => setQuickOpen(false)}
        onSaved={() => {
          setQuickOpen(false);
          void load();
        }}
      />
    </div>
  );
}