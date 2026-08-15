import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CoverImage from '../components/CoverImage';
import EmptyState from '../components/EmptyState';
import GlassModal from '../components/GlassModal';
import WorkForm from '../components/WorkForm';
import { launchGame, openExternal } from '../lib/api';
import { useAutoTimerState } from '../lib/autoTimer';
import { CATEGORY_COLORS, CATEGORY_LABELS, SEASON_LABELS, SOURCE_LABELS, STATUS_COLORS, STATUS_LABELS } from '../lib/constants';
import { deleteWork, formatMinutes, getWork, listActivityByWork, listPlaySessions, onWorksChanged } from '../lib/db';
import type { ActivityEntry, LinkItem, PlaySession, Work } from '../types';

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

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function sourceIdLinks(w: Work): LinkItem[] {
  const out: LinkItem[] = [];
  if (w.bangumi_id != null) out.push({ label: 'Bangumi', url: `https://bgm.tv/subject/${w.bangumi_id}` });
  if (w.vndb_id) out.push({ label: 'VNDB', url: `https://vndb.org/${w.vndb_id}` });
  const mediaType = w.category === 'anime' ? 'anime' : 'manga';
  if (w.mal_id != null) out.push({ label: 'MAL', url: `https://myanimelist.net/${mediaType}/${w.mal_id}` });
  if (w.anilist_id != null) out.push({ label: 'AniList', url: `https://anilist.co/${mediaType}/${w.anilist_id}` });
  return out;
}

export default function DetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const workId = Number(id);
  const [work, setWork] = useState<Work | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sessions, setSessions] = useState<PlaySession[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [launchMsg, setLaunchMsg] = useState('');
  const autoState = useAutoTimerState();
  const [nowTs, setNowTs] = useState(Date.now());

  const autoStart = work ? (autoState.timers[work.id] ?? null) : null;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const w = await getWork(workId);
      setWork(w);
      setSessions(await listPlaySessions(workId, 8));
      setActivity(await listActivityByWork(workId, 5));
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

  // 自动计时进行中时每秒刷新一次已计时长
  useEffect(() => {
    if (!autoStart) return;
    setNowTs(Date.now());
    const iv = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(iv);
  }, [autoStart]);

  const remove = async () => {
    await deleteWork(workId);
    navigate('/');
  };

  const launch = async () => {
    if (!work?.game_path) return;
    setLaunchMsg('');
    try {
      await launchGame(work.game_path);
    } catch (e) {
      setLaunchMsg(`启动失败：${String(e)}`);
    }
  };

  if (loading) return <div className="loading">正在加载…</div>;

  if (!work) {
    return (
      <div className="page">
        <EmptyState icon="🚫" title="作品不存在或已被删除">
          <button className="btn primary" onClick={() => navigate('/')}>返回首页</button>
        </EmptyState>
      </div>
    );
  }

  const tags = (work.tags ?? '')
    .split(/[,，、]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const links = parseLinks(work.links);
  const idLinks = sourceIdLinks(work);
  const categoryColor = CATEGORY_COLORS[work.category];
  const playtime = work.playtime_minutes ?? 0;

  return (
    <div className="page">
      <button className="btn ghost back-btn" onClick={() => navigate(-1)}>← 返回</button>
      <div className="detail-card glass">
        <div className="detail-cover">
          <CoverImage src={work.cover_path} fallbackUrl={work.cover_url} category={work.category} title={work.title} className="cover-img" />
        </div>
        <div className="detail-main">
          <div className="detail-head">
            <h1>{work.title}</h1>
            <div className="detail-actions">
              {work.category === 'galgame' && work.game_path && (
                <button className="btn primary" onClick={() => void launch()}>▶ 启动游戏</button>
              )}
              <button className="btn ghost" onClick={() => setEditOpen(true)}>编辑</button>
              <button className="btn danger" onClick={() => setConfirmOpen(true)}>删除</button>
            </div>
          </div>

          {launchMsg && <div className="msg msg-error">{launchMsg}</div>}

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
              <span className="info-label">开始日期</span>
              <strong>{formatDate(work.start_date)}</strong>
            </div>
            <div className="info-item">
              <span className="info-label">结束日期</span>
              <strong>{formatDate(work.end_date)}</strong>
            </div>
            {(work.category === 'galgame' || playtime > 0) && (
              <div className="info-item">
                <span className="info-label">累计时长</span>
                <strong>{playtime > 0 ? formatMinutes(playtime) : '—'}</strong>
              </div>
            )}
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

          {idLinks.length > 0 && (
            <section className="detail-section">
              <h2>来源 ID</h2>
              <div className="tag-row">
                {idLinks.map((l, i) => (
                  <button key={`${l.url}-${i}`} className="link-btn" onClick={() => void openExternal(l.url)}>
                    {l.label} · {l.url.split('/').pop()}
                  </button>
                ))}
              </div>
            </section>
          )}

          {work.category === 'galgame' && (
            <section className="detail-section">
              <h2>游玩</h2>
              {work.game_path ? (
                <div className="game-path-row">
                  <span className="game-path-text" title={work.game_path}>{work.game_path}</span>
                </div>
              ) : (
                <p className="detail-text">尚未设置游戏路径，可在「编辑」中为 Galgame 指定可执行文件以启用自动计时。</p>
              )}
              <div className="timer-box">
                {autoStart ? (
                  <>
                    <span className="timer-dot running" />
                    <div>
                      <div className="timer-display">{fmtElapsed(nowTs - new Date(autoStart).getTime())}</div>
                      <div className="timer-hint">检测到游戏运行中，正在自动计时；关闭游戏后自动结算</div>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="timer-dot idle" />
                    <div>
                      <div className="timer-hint">未检测到游戏运行</div>
                      <div className="timer-hint dim">启动游戏后将自动开始计时，关闭后自动结算并写入累计时长</div>
                    </div>
                  </>
                )}
              </div>
              {sessions.length > 0 && (
                <div className="session-list">
                  <div className="session-list-title">最近游玩记录</div>
                  {sessions.map((s) => (
                    <div className="session-item" key={s.id}>
                      <span>{formatDate(s.started_at)}</span>
                      <span>{s.duration_seconds != null ? formatMinutes(Math.round(s.duration_seconds / 60)) : '—'}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {activity.length > 0 && (
            <section className="detail-section">
              <h2>最近动态</h2>
              <div className="activity-mini">
                {activity.map((a) => (
                  <div className="activity-mini-item" key={a.id}>
                    <span className="activity-mini-time">{formatDate(a.created_at)}</span>
                    <span>{a.detail}</span>
                  </div>
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
        <p className="confirm-text">确定要删除《{work.title}》吗？此操作不可恢复。</p>
        <div className="modal-foot">
          <button className="btn ghost" onClick={() => setConfirmOpen(false)}>取消</button>
          <button className="btn danger" onClick={() => void remove()}>确认删除</button>
        </div>
      </GlassModal>
    </div>
  );
}