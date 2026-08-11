import { useCallback, useEffect, useMemo, useState } from 'react';
import CoverImage from '../components/CoverImage';
import WorkForm from '../components/WorkForm';
import type { WorkFormPrefill } from '../components/WorkForm';
import { deleteCalendarCache, downloadCalendarCover, downloadCover, fetchBangumiCalendar, fetchBangumiSubject, readCalendarCache, writeCalendarCache } from '../lib/api';
import type { ApiRequestConfig } from '../lib/api';
import { listWorks, onWorksChanged } from '../lib/db';
import { buildBangumiPrefill } from '../lib/prefills';
import { useSettings } from '../lib/settings';
import type { CalendarCacheData, CalendarDay, CalendarItem, Category, Work } from '../types';

const WEEK_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function weekdayLabel(d: CalendarDay): string {
  const idx = d.weekday >= 1 && d.weekday <= 7 ? d.weekday - 1 : -1;
  if (idx >= 0) return WEEK_LABELS[idx];
  return d.en || `周${d.weekday}`;
}

function formatCacheTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function btypeCategory(btype: number): Category {
  if (btype === 1) return 'manga';
  if (btype === 4) return 'galgame';
  return 'anime';
}

export default function CalendarPage() {
  const { settings } = useSettings();
  const [days, setDays] = useState<CalendarDay[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [cacheTime, setCacheTime] = useState<string | null>(null);
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

  const fetchFresh = useCallback(
    async (save: boolean) => {
      setLoading(true);
      setError('');
      try {
        const fetched = await fetchBangumiCalendar(cfg);
        // 拉取时一并下载封面到日历本地缓存（与作品封面缓存分离）
        const withCovers = await Promise.all(
          fetched.map(async (day) => ({
            ...day,
            items: await Promise.all(
              day.items.map(async (it) => {
                if (!it.image) return it;
                try {
                  const local = await downloadCalendarCover(it.image, {
                    proxyMode: settings.proxyMode,
                    proxyUrl: settings.proxyUrl,
                    dataDir: settings.dataDir,
                  });
                  return { ...it, coverPath: local };
                } catch {
                  return it;
                }
              }),
            ),
          })),
        );
        const now = new Date().toISOString();
        setDays(withCovers);
        setCacheTime(now);
        if (save) {
          try {
            await writeCalendarCache(settings.dataDir, JSON.stringify({ fetchedAt: now, days: withCovers } satisfies CalendarCacheData));
          } catch {
            // 缓存写入失败不阻塞展示
          }
        }
      } catch (e) {
        setError(`日历加载失败：${String(e)}`);
      } finally {
        setLoading(false);
      }
    },
    [cfg, settings.dataDir, settings.proxyMode, settings.proxyUrl],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [cached, w] = await Promise.all([readCalendarCache(settings.dataDir), listWorks()]);
      setWorks(w);
      if (cached) {
        const data = JSON.parse(cached) as CalendarCacheData;
        if (Array.isArray(data.days)) {
          setDays(data.days);
          setCacheTime(data.fetchedAt ?? null);
          setLoading(false);
          return;
        }
      }
    } catch {
      // 缓存读取失败则重新拉取
    }
    await fetchFresh(true);
  }, [settings.dataDir, fetchFresh]);

  useEffect(() => {
    void load();
    return onWorksChanged(() => {
      void listWorks().then(setWorks).catch(() => undefined);
    });
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    setError('');
    try {
      await deleteCalendarCache(settings.dataDir);
    } catch {
      // 删除失败继续拉取
    }
    await fetchFresh(true);
    setRefreshing(false);
  };

  const myIds = useMemo(() => new Set(works.filter((w) => w.bangumi_id != null).map((w) => w.bangumi_id as number)), [works]);

  const shownDays = useMemo(() => {
    if (!days) return [];
    const kw = search.trim().toLowerCase();
    return days.map((d) => ({
      ...d,
      items: d.items.filter((it) => {
        if (kw && !(it.nameCn || it.name).toLowerCase().includes(kw)) return false;
        if (onlyMine && !myIds.has(it.id)) return false;
        return true;
      }),
    }));
  }, [days, search, onlyMine, myIds]);

  const totalItems = shownDays.reduce((sum, d) => sum + d.items.length, 0);
  const myCount = works.filter((w) => w.bangumi_id != null && myIds.has(w.bangumi_id)).length;

  const addItem = async (item: CalendarItem) => {
    setBusy(true);
    setError('');
    try {
      const full = await fetchBangumiSubject(item.id, cfg);
      // 与 API 搜索页共用同一套预填逻辑，保证添加行为一致
      setPrefill(
        await buildBangumiPrefill(full, {
          forceCategory: 'all',
          downloadCovers: settings.downloadCovers,
          download: (url) =>
            downloadCover(url, {
              proxyMode: settings.proxyMode,
              proxyUrl: settings.proxyUrl,
              dataDir: settings.dataDir,
            }),
        }),
      );
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
            Bangumi 本周放送（番剧）{days ? `· 共 ${totalItems} 部` : ''}
            {myCount > 0 ? ` · 已收藏 ${myCount} 部` : ''}
            {cacheTime ? ` · 缓存于 ${formatCacheTime(cacheTime)}` : ''}
          </p>
        </div>
        <button className="btn ghost" onClick={() => void refresh()} disabled={loading || refreshing}>
          {refreshing ? '刷新中…' : '刷新（清除缓存）'}
        </button>
      </div>

      <div className="filter-bar glass">
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
      ) : !days || days.length === 0 ? (
        <div className="empty glass">
          <div className="empty-icon">📅</div>
          <h3>暂无日历数据</h3>
          <p>请检查网络连接或在设置中配置代理后，点击「刷新（清除缓存）」重试</p>
        </div>
      ) : totalItems === 0 ? (
        <div className="empty glass">
          <div className="empty-icon">🔍</div>
          <h3>没有符合条件的条目</h3>
          <p>试试调整搜索词或关闭「只看我的收藏」</p>
        </div>
      ) : (
        <div className="calendar-grid">
          {shownDays.map((d, idx) => (
            <div key={d.weekday} className={`cal-col glass ${idx === todayIdx ? 'cal-today' : ''}`}>
              <div className="cal-day-head">
                <span className="cal-day-label">{weekdayLabel(d)}</span>
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
                        <CoverImage
                          src={it.coverPath ?? ''}
                          fallbackUrl={it.image ?? undefined}
                          category={cat}
                          title={it.nameCn || it.name}
                          className="cal-thumb"
                        />
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
          void listWorks().then(setWorks).catch(() => undefined);
        }}
      />
    </div>
  );
}