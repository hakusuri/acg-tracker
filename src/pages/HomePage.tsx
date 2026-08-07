import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CoverImage from '../components/CoverImage';
import EmptyState from '../components/EmptyState';
import { CATEGORIES, CATEGORY_COLORS, CATEGORY_LABELS, SEASONS, SEASON_LABELS, STATUS_COLORS, STATUS_LABELS } from '../lib/constants';
import { listWorks, onWorksChanged } from '../lib/db';
import { requestAddWork } from '../lib/events';
import { seedSampleData } from '../lib/seed';
import { useSettings } from '../lib/settings';
import type { SortKey } from '../lib/settings';
import type { Category, Season, Work } from '../types';

type CategoryFilter = Category | 'all';
type SeasonFilter = Season | 'all';

export default function HomePage() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [works, setWorks] = useState<Work[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [year, setYear] = useState<number | 'all'>('all');
  const [season, setSeason] = useState<SeasonFilter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>(settings.defaultSort);
  const [seedBusy, setSeedBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setWorks(await listWorks());
    } catch (e) {
      console.error('加载失败', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onWorksChanged(() => void refresh());
  }, [refresh]);

  const years = useMemo(
    () => Array.from(new Set(works.map((w) => w.year).filter((y): y is number => y != null))).sort((a, b) => b - a),
    [works],
  );

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const list = works.filter((w) => {
      if (category !== 'all' && w.category !== category) return false;
      if (year !== 'all' && w.year !== year) return false;
      if (season !== 'all' && (w.category !== 'anime' || w.season !== season)) return false;
      if (kw && !w.title.toLowerCase().includes(kw)) return false;
      return true;
    });
    list.sort((a, b) => {
      switch (sort) {
        case 'created_asc':
          return a.created_at.localeCompare(b.created_at);
        case 'year_desc':
          return (b.year ?? -1) - (a.year ?? -1);
        case 'year_asc':
          return (a.year ?? -1) - (b.year ?? -1);
        case 'rating_desc':
          return (b.my_rating ?? b.rating ?? -1) - (a.my_rating ?? a.rating ?? -1);
        case 'title':
          return a.title.localeCompare(b.title, 'zh-CN');
        default:
          return b.created_at.localeCompare(a.created_at);
      }
    });
    return list;
  }, [works, category, year, season, search, sort]);

  const showSeasonFilter = category === 'all' || category === 'anime';

  const seed = async () => {
    setSeedBusy(true);
    try {
      await seedSampleData();
    } finally {
      setSeedBusy(false);
    }
  };

  if (loading) return <div className="loading">正在加载…</div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>我的作品库</h1>
          <p className="page-sub">共 {works.length} 部作品，当前显示 {filtered.length} 部</p>
        </div>
        <button className="btn primary" onClick={requestAddWork}>＋ 添加作品</button>
      </div>

      <div className="filter-bar glass">
        <div className="filter-group">
          {(['all', ...CATEGORIES] as CategoryFilter[]).map((c) => (
            <button
              key={c}
              type="button"
              className={`chip ${category === c ? 'active' : ''}`}
              onClick={() => setCategory(c)}
            >
              {c === 'all' ? '全部' : CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
        <div className="filter-group">
          <select
            className="select select-sm"
            value={year}
            onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            <option value="all">全部年份</option>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          {showSeasonFilter && (
            <select
              className="select select-sm"
              value={season}
              onChange={(e) => setSeason(e.target.value as SeasonFilter)}
            >
              <option value="all">全部季度</option>
              {SEASONS.map((s) => (
                <option key={s} value={s}>{SEASON_LABELS[s]}季</option>
              ))}
            </select>
          )}
          <input
            className="input input-sm"
            placeholder="搜索标题…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="select select-sm" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="created_desc">最新添加</option>
            <option value="created_asc">最早添加</option>
            <option value="year_desc">年份新→旧</option>
            <option value="year_asc">年份旧→新</option>
            <option value="rating_desc">评分高→低</option>
            <option value="title">标题排序</option>
          </select>
        </div>
      </div>

      {works.length === 0 ? (
        <EmptyState icon="🎬" title="还没有任何作品" desc="点击「添加作品」录入第一部，或载入示例数据快速体验">
          <button className="btn primary" onClick={requestAddWork}>添加第一部作品</button>
          <button className="btn ghost" onClick={seed} disabled={seedBusy}>
            {seedBusy ? '载入中…' : '载入示例数据'}
          </button>
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState icon="🔍" title="没有符合条件的作品" desc="试试调整筛选条件或搜索关键词">
          <button
            className="btn ghost"
            onClick={() => {
              setCategory('all');
              setYear('all');
              setSeason('all');
              setSearch('');
            }}
          >
            清除筛选
          </button>
        </EmptyState>
      ) : (
        <div className="work-grid">
          {filtered.map((w) => (
            <button key={w.id} type="button" className="work-card glass" onClick={() => navigate(`/work/${w.id}`)}>
              <div className="work-cover">
                <CoverImage src={w.cover_path} category={w.category} title={w.title} className="cover-img" />
                <span className="status-pill" style={{ background: STATUS_COLORS[w.status] }}>
                  {STATUS_LABELS[w.status]}
                </span>
                <span className="cat-badge" style={{ background: CATEGORY_COLORS[w.category] }}>
                  {CATEGORY_LABELS[w.category]}
                </span>
              </div>
              <div className="work-meta">
                <h3 className="work-title">{w.title}</h3>
                <div className="work-sub">
                  <span>
                    {w.year ?? '未知年份'}
                    {w.category === 'anime' && w.season ? ` ${SEASON_LABELS[w.season]}` : ''}
                  </span>
                  <span className="work-rating">{(w.my_rating ?? w.rating) != null ? `★ ${w.my_rating ?? w.rating}` : ''}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}