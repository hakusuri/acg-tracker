import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CoverImage from '../components/CoverImage';
import EmptyState from '../components/EmptyState';
import GlassModal from '../components/GlassModal';
import WorkForm from '../components/WorkForm';
import { openExternal } from '../lib/api';
import { CATEGORY_COLORS, CATEGORY_LABELS, SEASON_LABELS, SOURCE_LABELS, STATUS_COLORS, STATUS_LABELS } from '../lib/constants';
import { deleteWork, getWork, onWorksChanged } from '../lib/db';
import type { LinkItem, Work } from '../types';

function parseLinks(raw: string): LinkItem[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((l): l is LinkItem => !!l && !!l.url) : [];
  } catch {
    return [];
  }
}

function progressText(w: Work): string {
  const unit = w.category === 'anime' ? '集' : w.category === 'galgame' ? '路线' : '卷';
  const total = w.total_count != null ? `${w.total_count} ${unit}` : '未知';
  const cur = w.current_count != null ? `${w.current_count} ${unit}` : '—';
  return `${cur} / ${total}`;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function DetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const workId = Number(id);
  const [work, setWork] = useState<Work | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setWork(await getWork(workId));
    } catch (e) {
      console.error('加载失败', e);
    } finally {
      setLoading(false);
    }
  }, [workId]);

  useEffect(() => {
    void refresh();
    return onWorksChanged(() => void refresh());
  }, [refresh]);

  const remove = async () => {
    await deleteWork(workId);
    navigate('/');
  };

  if (loading) return <div className="loading">正在加载…</div>;

  if (!work) {
    return (
      <div className="page">
        <EmptyState icon="🫥" title="作品不存在或已被删除">
          <button className="btn primary" onClick={() => navigate('/')}>返回首页</button>
        </EmptyState>
      </div>
    );
  }

  const tags = work.tags
    .split(/[,，、]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const links = parseLinks(work.links);
  const categoryColor = CATEGORY_COLORS[work.category];

  return (
    <div className="page">
      <button className="btn ghost back-btn" onClick={() => navigate(-1)}>← 返回</button>
      <div className="detail-card glass">
        <div className="detail-cover">
          <CoverImage src={work.cover_path} category={work.category} title={work.title} className="cover-img" />
        </div>
        <div className="detail-main">
          <div className="detail-head">
            <h1>{work.title}</h1>
            <div className="detail-actions">
              <button className="btn ghost" onClick={() => setEditOpen(true)}>编辑</button>
              <button className="btn danger" onClick={() => setConfirmOpen(true)}>删除</button>
            </div>
          </div>

          <div className="badge-row">
            <span className="chip chip-static" style={{ color: categoryColor, borderColor: categoryColor }}>
              {CATEGORY_LABELS[work.category]}
            </span>
            <span className="chip chip-static" style={{ background: STATUS_COLORS[work.status], color: '#fff', borderColor: 'transparent' }}>
              {STATUS_LABELS[work.status]}
            </span>
            <span className="chip chip-static">{SOURCE_LABELS[work.source] ?? work.source}</span>
          </div>

          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">年份</span>
              <strong>{work.year ?? '—'}</strong>
            </div>
            <div className="info-item">
              <span className="info-label">季度</span>
              <strong>{work.category === 'anime' && work.season ? SEASON_LABELS[work.season] : '—'}</strong>
            </div>
            <div className="info-item">
              <span className="info-label">作品评分</span>
              <strong>{work.rating != null ? `★ ${work.rating}` : '—'}</strong>
            </div>
            <div className="info-item">
              <span className="info-label">我的评分</span>
              <strong>{work.my_rating != null ? `★ ${work.my_rating}` : '—'}</strong>
            </div>
            <div className="info-item">
              <span className="info-label">进度</span>
              <strong>{progressText(work)}</strong>
            </div>
            <div className="info-item">
              <span className="info-label">添加时间</span>
              <strong>{formatDate(work.created_at)}</strong>
            </div>
          </div>

          <section className="detail-section">
            <h2>简介</h2>
            <p className="detail-text">{work.synopsis || '暂无简介'}</p>
          </section>

          {tags.length > 0 && (
            <section className="detail-section">
              <h2>标签</h2>
              <div className="tag-row">
                {tags.map((t) => (
                  <span className="tag-chip" key={t}>{t}</span>
                ))}
              </div>
            </section>
          )}

          {work.notes && (
            <section className="detail-section">
              <h2>笔记</h2>
              <p className="detail-text">{work.notes}</p>
            </section>
          )}

          {links.length > 0 && (
            <section className="detail-section">
              <h2>相关链接</h2>
              <div className="tag-row">
                {links.map((l, i) => (
                  <button key={`${l.url}-${i}`} className="link-btn" onClick={() => void openExternal(l.url)}>
                    ↗ {l.label || '链接'}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      <WorkForm
        open={editOpen}
        work={work}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          void refresh();
        }}
      />

      <GlassModal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="删除作品">
        <p className="confirm-text">确定要删除「{work.title}」吗？此操作不可恢复。</p>
        <div className="modal-foot">
          <button className="btn ghost" onClick={() => setConfirmOpen(false)}>取消</button>
          <button className="btn danger" onClick={() => void remove()}>确认删除</button>
        </div>
      </GlassModal>
    </div>
  );
}