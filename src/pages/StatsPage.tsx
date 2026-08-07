import { useEffect, useMemo, useState } from 'react';
import { BarChart, DonutChart } from '../components/Charts';
import { CATEGORIES, CATEGORY_COLORS, CATEGORY_LABELS, SEASON_LABELS, STATUSES, STATUS_COLORS, STATUS_LABELS } from '../lib/constants';
import { listWorks, onWorksChanged } from '../lib/db';
import type { Work } from '../types';

export default function StatsPage() {
  const [works, setWorks] = useState<Work[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        setWorks(await listWorks());
      } catch (e) {
        console.error('加载失败', e);
      } finally {
        setLoading(false);
      }
    })();
    return onWorksChanged(() => {
      void (async () => {
        setWorks(await listWorks());
      })();
    });
  }, []);

  const stats = useMemo(() => {
    const byCategory = CATEGORIES.map((c) => ({
      label: CATEGORY_LABELS[c],
      value: works.filter((w) => w.category === c).length,
      color: CATEGORY_COLORS[c],
    }));
    const byStatus = STATUSES.map((s) => ({
      label: STATUS_LABELS[s],
      value: works.filter((w) => w.status === s).length,
      color: STATUS_COLORS[s],
    }));
    const yearMap = new Map<number, number>();
    for (const w of works) {
      if (w.year != null) yearMap.set(w.year, (yearMap.get(w.year) ?? 0) + 1);
    }
    const byYear = Array.from(yearMap.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([label, value]) => ({ label: String(label), value, color: '#7c9cff' }));
    const seasonMap = new Map<string, number>();
    for (const w of works) {
      if (w.category === 'anime' && w.year != null && w.season) {
        const key = `${w.year} ${SEASON_LABELS[w.season]}`;
        seasonMap.set(key, (seasonMap.get(key) ?? 0) + 1);
      }
    }
    const bySeason = Array.from(seasonMap.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([label, value]) => ({ label, value, color: '#a78bfa' }));
    const rated = works.filter((w) => w.my_rating != null || w.rating != null);
    const avg =
      rated.length > 0
        ? rated.reduce((sum, w) => sum + (w.my_rating ?? w.rating ?? 0), 0) / rated.length
        : null;
    return { byCategory, byStatus, byYear, bySeason, total: works.length, avg };
  }, [works]);

  if (loading) return <div className="loading">正在加载…</div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>统计信息</h1>
          <p className="page-sub">基于作品库的简单数据分析</p>
        </div>
      </div>

      <div className="stats-summary">
        <div className="stat-card glass">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">作品总数</div>
        </div>
        {CATEGORIES.map((c) => (
          <div className="stat-card glass" key={c}>
            <div className="stat-value" style={{ color: CATEGORY_COLORS[c] }}>
              {stats.byCategory.find((x) => x.label === CATEGORY_LABELS[c])?.value ?? 0}
            </div>
            <div className="stat-label">{CATEGORY_LABELS[c]}</div>
          </div>
        ))}
        <div className="stat-card glass">
          <div className="stat-value">{stats.avg != null ? stats.avg.toFixed(1) : '—'}</div>
          <div className="stat-label">平均评分</div>
        </div>
      </div>

      <div className="stats-grid">
        <section className="glass stat-panel">
          <h2>类别分布</h2>
          <BarChart data={stats.byCategory} />
        </section>
        <section className="glass stat-panel">
          <h2>状态分布</h2>
          <DonutChart data={stats.byStatus} />
        </section>
        <section className="glass stat-panel">
          <h2>按年份</h2>
          <BarChart data={stats.byYear} />
        </section>
        <section className="glass stat-panel">
          <h2>番剧季度（年份 × 季度）</h2>
          <BarChart data={stats.bySeason} />
        </section>
      </div>
    </div>
  );
}