import { useEffect, useMemo, useState } from 'react';
import EmptyState from '../components/EmptyState';
import { listActivity, onWorksChanged } from '../lib/db';
import type { ActivityEntry } from '../types';

const ACTION_LABELS: Record<string, string> = {
  add: '添加作品',
  update: '编辑作品',
  progress: '进度更新',
  status: '状态变更',
  complete: '标记完结',
  play: '游玩计时',
  delete: '删除作品',
  import: '导入 / 合并',
};

const ACTION_ICONS: Record<string, string> = {
  add: '➕',
  update: '✏️',
  progress: '▶️',
  status: '🔄',
  complete: '✅',
  play: '⏱️',
  delete: '🗑️',
  import: '📥',
};

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '未知日期';
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function timeStr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function TimelinePage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    void (async () => {
      try {
        setEntries(await listActivity(500));
      } catch (e) {
        console.error('加载动态失败', e);
      } finally {
        setLoading(false);
      }
    })();
    return onWorksChanged(() => {
      void listActivity(500).then(setEntries).catch(() => undefined);
    });
  }, []);

  const actions = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) set.add(e.action);
    return Array.from(set);
  }, [entries]);

  const shown = useMemo(
    () => (filter === 'all' ? entries : entries.filter((e) => e.action === filter)),
    [entries, filter],
  );

  const groups = useMemo(() => {
    const map = new Map<string, ActivityEntry[]>();
    for (const e of shown) {
      const key = dayKey(e.created_at);
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [shown]);

  if (loading) return <div className="loading">正在加载…</div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>动态</h1>
          <p className="page-sub">记录添加、进度、状态与游玩计时等操作历史</p>
        </div>
      </div>

      {actions.length > 0 && (
        <div className="filter-bar glass">
          <div className="filter-group">
            <button type="button" className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
              全部
            </button>
            {actions.map((a) => (
              <button key={a} type="button" className={`chip ${filter === a ? 'active' : ''}`} onClick={() => setFilter(a)}>
                {ACTION_ICONS[a] ?? ''} {ACTION_LABELS[a] ?? a}
              </button>
            ))}
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <EmptyState icon="🗒️" title="还没有任何动态" desc="添加作品、更新进度或开始计时后，这里会显示操作记录" />
      ) : shown.length === 0 ? (
        <EmptyState icon="🔍" title="该分类下暂无动态" desc="试试切换其他分类" />
      ) : (
        <div className="timeline">
          {groups.map(([day, items]) => (
            <div className="timeline-day" key={day}>
              <div className="timeline-day-label">{day}</div>
              <div className="activity-list">
                {items.map((e) => (
                  <div className="activity-item glass" key={e.id}>
                    <span className="activity-icon">{ACTION_ICONS[e.action] ?? '•'}</span>
                    <div className="activity-body">
                      <div className="activity-head">
                        <span className="activity-action">{ACTION_LABELS[e.action] ?? e.action}</span>
                        <span className="activity-time">{timeStr(e.created_at)}</span>
                      </div>
                      {e.detail && <div className="activity-detail">{e.detail}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}